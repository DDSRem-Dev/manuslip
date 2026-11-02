import type { Nodes, Parents } from 'mdast'
import type { State } from 'mdast-util-to-hast'
import type { PackedCapture } from '../../core/src/packing-capture'
import type { PackedWorkspace } from '../../core/src/packing-workspace'
import type { ProjectionLimits } from './fragment-projection-context'
import type { RenderOptions } from './index'
import type { PackedProjectionStateCost } from './packed-projection-state'

const quantum = 65536

/** Transient, capture-owned construction/serialization reservation. A single resizable
 * reader slot admits rounded byte growth. Changing phases releases construction scratch only
 * after the completed HAST has been measured; the next phase covers that HAST too.
 */
export class ProjectionWorkspace {
  #capture: PackedCapture | undefined
  readonly #retained: number
  readonly #staging: number
  #reservation: PackedWorkspace | undefined
  #bytes = 0
  #planned = 0
  #nodeUnits = 0
  #closed = false
  #admit: ((bytes: number) => void) | undefined
  constructor(capture: PackedCapture, limits: ProjectionLimits, admit?: (bytes: number) => void) {
    this.#capture = capture
    this.#retained = limits.retained
    this.#staging = limits.staging
    this.#admit = admit
    this.#reservation = capture.reserveWorkspace(0, 0)
    try {
      this.set(32768 + (limits.depth + 16) * 1024)
    } catch (error) {
      this.close()
      throw error
    }
  }
  get bytes(): number {
    return this.#bytes
  }
  add(bytes: number): void {
    this.set(this.#planned + bytes)
  }
  set(bytes: number): void {
    this.#capture?.identity
    if (this.#closed || !Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error('Invalid projection workspace')
    const slots = Math.ceil(bytes / quantum)
    const reservation = slots * quantum
    if (reservation + (slots + 16) * 512 > this.#retained || reservation > this.#staging)
      throw new Error('Packed projection output exceeds workspace limit')
    // No callback can revoke the private reservation between the guard and this reuse.
    // Callback-driven admissions keep their original binding and complete resize path.
    if (reservation === this.#bytes && !this.#admit) {
      this.#planned = bytes
      return
    }
    this.#admit?.(reservation)
    if (!this.#reservation) throw new Error('Projection workspace closed')
    this.#reservation.resize(reservation, reservation)
    this.#bytes = reservation
    this.#planned = bytes
  }
  node(state: State, node: Nodes, parent: Parents | undefined): void {
    this.#node(state, node, parent)
  }
  /** Share a lexical quota across adjacent nodes. Short admissions keep the native
   * path; only a quota boundary allocates a suspended scanner. No handler may run
   * until its complete original construction cost has been admitted.
   */
  nodeSteps(state: State, node: Nodes, parent: Parents | undefined): Generator<void> | void {
    const value =
      node.type !== 'html' && 'value' in node && typeof node.value === 'string' ? node.value : ''
    const lang = node.type === 'code' ? (node.lang ?? '') : ''
    const units = value.length + lang.length
    if (this.#nodeUnits + units < 4096) {
      this.#nodeUnits += units
      this.node(state, node, parent)
      return
    }
    return this.#scanNode(state, node, parent, value, lang)
  }
  *#scanNode(
    state: State,
    node: Nodes,
    parent: Parents | undefined,
    value: string,
    lang: string,
  ): Generator<void> {
    let bytes = 0
    for (let field = 0; field < 2; field++) {
      const text = field ? lang : value
      for (let from = 0; from < text.length; ) {
        if (this.#closed) throw new Error('Projection workspace closed')
        this.#capture?.identity
        const end = Math.min(from + 4096 - this.#nodeUnits, text.length)
        for (let index = from; index < end; index++) {
          if (field) {
            if (/\s/.test(text[index] ?? '')) bytes += 128
          } else {
            const code = text.charCodeAt(index)
            if (code === 10 || code === 13) bytes += 128
          }
        }
        this.#nodeUnits += end - from
        from = end
        if (this.#nodeUnits === 4096) {
          this.#nodeUnits = 0
          yield
        }
      }
    }
    this.#node(state, node, parent, bytes)
  }
  #node(state: State, node: Nodes, parent: Parents | undefined, scanned?: number): void {
    let bytes = 4096 + ('children' in node ? node.children.length * 256 : 0)
    if ('value' in node && typeof node.value === 'string') {
      // trimLines, inline-code replacement and code's final newline can coexist with
      // their input. Raw HTML borrows its existing string. Count line fragments before
      // the pinned handler constructs its temporary arrays.
      if (node.type !== 'html') {
        bytes += node.value.length * 4
        if (scanned === undefined)
          for (let index = 0; index < node.value.length; index++) {
            const code = node.value.charCodeAt(index)
            if (code === 10 || code === 13) bytes += 128
          }
      }
    }
    if (node.type === 'code' && node.lang) {
      bytes += node.lang.length * 8
      if (scanned === undefined)
        for (let index = 0; index < node.lang.length; index++)
          if (/\s/.test(node.lang[index] ?? '')) bytes += 128
    }
    if (node.type === 'link' || node.type === 'image') {
      bytes += node.url.length * 1024 + (node.title?.length ?? 0) * 2
      if (node.type === 'image') bytes += (node.alt?.length ?? 0) * 2
    }
    if (node.type === 'linkReference' || node.type === 'imageReference') {
      // Admit the uppercase lookup key before constructing it, including unresolved refs.
      this.add(node.identifier.length * 32)
      const definition = state.definitionById.get(node.identifier.toUpperCase())
      bytes +=
        (node.label?.length ?? 0) * 4 +
        (definition?.url.length ?? 0) * 1024 +
        (definition?.title?.length ?? 0) * 2
      if (node.type === 'imageReference') bytes += (node.alt?.length ?? 0) * 4
    }
    if (node.type === 'footnoteReference') bytes += node.identifier.length * 4096
    // tableRow creates/pads cells directly rather than dispatching a tableCell handler.
    if (node.type === 'tableRow')
      bytes +=
        (parent?.type === 'table' ? (parent.align?.length ?? 0) : node.children.length) * 2048
    this.add(bytes + (scanned ?? 0))
  }
  footer(state: State, cost: PackedProjectionStateCost, options: RenderOptions): void {
    if (!state.footnoteOrder.length) return
    // Footer scaffolding/backlinks are allocated outside public `state.one`. Every body
    // and possible note call was counted by state admission, including cyclic note calls.
    // Note bodies themselves still charge through node(), exactly as ordinary blocks do.
    this.add(
      16384 +
        state.footnoteById.size * 4096 +
        cost.references * (2048 + options.footnoteBackLabel.length * 4) +
        cost.identifierUnits * 4096 +
        options.footnotesLabel.length * 4,
    )
  }
  close(): void {
    this.#closed = true
    this.#capture = undefined
    this.#admit = undefined
    const reservation = this.#reservation
    this.#reservation = undefined
    this.#bytes = 0
    reservation?.release()
  }
}
