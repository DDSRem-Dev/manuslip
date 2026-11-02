import { semanticLimits } from '@manuslip/core'
import type { RenderOptions } from '@manuslip/renderer'
import {
  describeDocumentFragment,
  documentFragmentOperations,
} from '../../../../../../packages/core/src/document-metadata'
import { reparseMarkdownFragment } from '../../../../../../packages/core/src/markdown-fragment'
import { packValueSteps } from '../../../../../../packages/core/src/packing'
import { PackedArena } from '../../../../../../packages/core/src/packing-arena'
import type { PackedHold } from '../../../../../../packages/core/src/packing-hold'
import type { PackedOperation } from '../../../../../../packages/core/src/packing-revision'
import type {
  PackedSession,
  PackedSessionLimits,
} from '../../../../../../packages/core/src/packing-session'
import type { PackedSource } from '../../../../../../packages/core/src/packing-source'
import { PackedWork } from '../../../../../../packages/core/src/packing-work'
import {
  type SemanticDependencies,
  UnsupportedSemanticDependencies,
} from '../../../../../../packages/core/src/semantic-dependencies'
import {
  projectionFragmentOperations,
  projectMarkdownFragment,
} from '../../../../../../packages/renderer/src/projection-fragment'

import {
  buildProducerDependencies,
  type ProducerDependencies,
} from './packed-producer-dependencies'
export type FragmentPhase = 'dependencies' | 'fragment' | 'metadata' | 'projection' | 'encode'
export interface FragmentEncoding {
  readonly payload: ArrayBuffer
  readonly operations: readonly PackedOperation[]
  readonly serializeMs: number
  readonly dependencies: ProducerDependencies
}

/** Derive one exact contiguous edit from immutable complete sources. No editor-provided
 * change, numeric revision or source hash can substitute for checking both source strings.
 * Large changes fall back before allocating an insertion string or invoking the parser.
 */
function* change(before: string, after: string) {
  let from = 0
  const shared = Math.min(before.length, after.length)
  while (from < shared && before.charCodeAt(from) === after.charCodeAt(from)) {
    from++
    if (from % 4096 === 0) yield
  }
  let to = before.length
  let end = after.length
  while (to > from && end > from && before.charCodeAt(to - 1) === after.charCodeAt(end - 1)) {
    to--
    end--
    if ((before.length - to) % 4096 === 0) yield
  }
  if (to - from + end - from > 64 * 1024) return undefined
  return { from, to, insert: after.slice(from, end) }
}

/** Borrow only the acknowledged current capture. Native fragment/metadata/projection
 * builders remain atomic; their weights are development admission, not physical bounds.
 * A completed result transfers one admitted dependency index to the pending publication.
 * All other captures, native patches and indexing scratch end before session preparation.
 */
export function encodeProducerFragment(
  owner: PackedSession,
  sessionLimits: PackedSessionLimits,
  base: PackedSource,
  source: PackedSource,
  options: RenderOptions,
  cached: ProducerDependencies | undefined,
  phase: (value: FragmentPhase) => void,
  activeTime?: () => number,
): PackedWork<FragmentEncoding | undefined> {
  const capture = owner.capture()
  const holds: PackedHold[] = []
  const limits = { ...sessionLimits, nodes: 800000, depth: 64 }
  let workspace: ReturnType<typeof capture.reserveWorkspace> | undefined
  let nextDependencies: ProducerDependencies | undefined
  let completed = false
  return new PackedWork(
    (function* () {
      if (capture.sourceResource !== base)
        throw new Error('Packed fragment base ownership mismatch')
      const edit = yield* change(base.text, source.text)
      if (!edit) return undefined
      phase('dependencies')
      let dependencies: SemanticDependencies
      try {
        if (cached?.index.sourceResource === base) dependencies = cached.index
        else {
          const built = yield* buildProducerDependencies(owner, sessionLimits, capture)
          if (!built) throw new Error('Incomplete producer dependencies')
          holds.push(built.hold)
          dependencies = built.index
        }
      } catch (error) {
        if (error instanceof UnsupportedSemanticDependencies) return undefined
        throw error
      }
      yield
      phase('fragment')
      const started = performance.now()
      const fragment = reparseMarkdownFragment(
        {
          capture,
          dependencies,
          baseSource: base.text,
          source,
          change: edit,
          root: ['document', 'root'],
          syntax: 'manuslip',
        },
        { ...limits, bytes: 64 * 1024, nodes: 8192 },
      )
      if (fragment.kind === 'full') return undefined
      const parseMs = performance.now() - started
      holds.push(owner.retain(fragment))
      yield
      phase('metadata')
      const metadata = describeDocumentFragment(
        { capture, dependencies, fragment, document: ['document'], parseMs },
        limits,
      )
      holds.push(owner.retain(metadata))
      yield
      phase('projection')
      const projected = projectMarkdownFragment(
        {
          capture,
          dependencies,
          fragment,
          root: ['document', 'root'],
          projection: ['projection'],
          layout: ['layout'],
          options,
        },
        limits,
      )
      holds.push(owner.retain(projected))
      // Advance provenance now, but publish its ownership only with the exact result ACK.
      const index = dependencies.advance(fragment, limits)
      nextDependencies = { index, hold: owner.retain(index) }
      yield
      phase('encode')
      const encodingStarted = activeTime?.() ?? performance.now()
      const payload = yield* packValueSteps(
        {
          children: fragment.children,
          position: fragment.position,
          blocks: metadata.blocks.values,
          outline: metadata.outline.values,
          counts: metadata.counts,
          sourceHash: source.identity.sourceHash,
          parserVersion: source.identity.parserVersion,
          timings: metadata.timings,
          ...projected.fields,
        },
        semanticLimits.messageBytes - 1024,
        { working: 32 * 1024 * 1024, nodes: 800000, depth: 512 },
      )
      if (!payload) throw new Error('Incomplete packed fragment encoding')
      // Charge the outgoing original plus the copy/index before constructing the copy.
      // The arena is used only for attested record IDs, never exposed to a consumer.
      workspace = capture.reserveWorkspace(payload.byteLength * 2 + 256, 0)
      const arena = yield* PackedArena.openSteps(payload.slice(0), limits, (retained, staging) => {
        workspace?.resize(payload.byteLength + retained, staging)
      })
      if (!arena) throw new Error('Incomplete packed fragment index')
      const operations = [
        ...documentFragmentOperations(fragment, metadata, arena, ['document']),
        ...projectionFragmentOperations(fragment, projected, arena),
      ]
      completed = true
      return {
        payload,
        operations,
        serializeMs: (activeTime?.() ?? performance.now()) - encodingStarted,
        dependencies: nextDependencies,
      }
    })(),
    () => {
      if (!completed) nextDependencies?.hold.release()
      workspace?.release()
      for (const hold of holds) hold.release()
      capture.release()
    },
  )
}
