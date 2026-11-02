import type { Root as HastRoot } from 'hast'
import type { Nodes, Parents } from 'mdast'
import type { State } from 'mdast-util-to-hast'
import type { PackedCapture } from '../../core/src/packing-capture'
import type { ProjectionLimits } from './fragment-projection-context'
import type { RenderOptions } from './index'
import type { PackedProjectionStateCost } from './packed-projection-state'
import { describeProjectionNode } from './projection-engine'
import type { ProjectionConversion } from './projection-sequence'
import {
  type ProjectionDescriptions,
  planProjectionSerialization,
} from './projection-serialization-plan'
import { ProjectionWorkspace } from './projection-workspace'
import type { ReadingSequenceAdmission } from './reading-sequence'

function finish<T>(work: Generator<void, T>): T {
  for (;;) {
    const next = work.next()
    if (next.done) return next.value
  }
}

/** A single source/translation frame. Never drop either HAST when moving to policy or
 * serialization: the two language copies coexist until their complete row is consumed.
 * Pinned native handlers/serializers are synchronous; planner visits still enforce logical
 * node/depth limits. The enclosing packed stream yields between complete native frames.
 */
export class ReadingWorkspace implements ReadingSequenceAdmission {
  readonly #workspace: ProjectionWorkspace
  readonly #baseBytes: number
  #hastBytes = 0
  #lastNodes = 0
  constructor(
    capture: PackedCapture,
    private readonly options: RenderOptions,
    private readonly limits: ProjectionLimits,
    private readonly state: PackedProjectionStateCost,
    admit: (bytes: number) => void,
  ) {
    this.#workspace = new ProjectionWorkspace(capture, limits, admit)
    this.#baseBytes = this.#workspace.bytes
  }
  get bytes(): number {
    return this.#workspace.bytes
  }
  node(state: State, node: Nodes, parent: Parents | undefined): void {
    this.#workspace.node(state, node, parent)
  }
  footer(state: State): void {
    this.#workspace.footer(state, this.state, this.options)
  }
  converted(converted: ProjectionConversion): void {
    const plan = finish(
      planProjectionSerialization(converted.hast, new Map(), this.options, this.limits),
    )
    // Native handler stacks, temporary joins and substituted mdast no longer exist.
    // Keep the measured HAST from every completed language conversion while admitting
    // the next conversion. Never replace the source HAST charge with just the target.
    this.#hastBytes += plan.hastBytes
    this.#workspace.set(this.#baseBytes + this.#hastBytes)
  }
  project(converted: ProjectionConversion): void {
    const descriptions: ProjectionDescriptions = new Map()
    let visited = 0
    const describe = (node: Nodes, depth: number): void => {
      if (++visited > this.limits.nodes || depth > this.limits.depth)
        throw new Error('Reading description traversal limit')
      this.#workspace.add(1024 + (node.type === 'code' ? (node.lang?.length ?? 0) * 4 : 0))
      const value = describeProjectionNode(node)
      if (value) descriptions.set(value.key, value.description)
      if ('children' in node)
        for (let index = node.children.length - 1; index >= 0; index--) {
          const child = node.children[index]
          if (child) describe(child, depth + 1)
        }
    }
    for (let index = converted.root.children.length - 1; index >= 0; index--) {
      const node = converted.root.children[index]
      if (node) describe(node, 1)
    }
    const plan = finish(
      planProjectionSerialization(converted.hast, descriptions, this.options, this.limits),
    )
    this.#workspace.add(plan.bytes)
    this.#lastNodes = plan.nodes
  }
  decorate(tree: HastRoot): void {
    this.#workspace.add(8192 + tree.children.length * 4096 + this.#lastNodes * 512)
  }
  serialize(tree: HastRoot): void {
    const plan = finish(planProjectionSerialization(tree, new Map(), this.options, this.limits))
    this.#workspace.add(plan.bytes)
  }
  close(): void {
    this.#workspace.close()
  }
}
