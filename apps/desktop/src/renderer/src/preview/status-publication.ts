export const previewStatusLimits = {
  consumers: 16,
  publications: 8,
  metadataBytes: 8 * 1024,
} as const
export interface StatusResource {
  release(): void
}
export interface StatusReservation extends StatusResource {
  publish(): number
}
export interface StatusConsumer extends StatusResource {
  acknowledge(version: number): void
}

/** Store publication owns the current packed status; committed UI consumers acknowledge
 * replacements independently. Keep superseded ownership until every consumer advances or
 * unmounts. Render attempts acquire nothing, so abandoned renders cannot leak reservations.
 */
export class PreviewStatusPublication {
  #version = 0
  #closed = false
  #pending: StatusReservation | undefined
  readonly #resources = new Map<number, StatusResource>()
  readonly #consumers = new Map<object, number>()

  get stats() {
    return Object.freeze({
      version: this.#version,
      publications: this.#resources.size,
      consumers: this.#consumers.size,
      pending: this.#pending !== undefined,
      closed: this.#closed,
    })
  }

  prepare(acquire: () => StatusResource | undefined): StatusReservation {
    if (this.#closed) throw new Error('Preview status closed')
    this.#pending?.release()
    if (this.#resources.size >= previewStatusLimits.publications) throw new Error('semantic-limit')
    if (this.#version >= Number.MAX_SAFE_INTEGER) throw new Error('semantic-limit')
    let resource = acquire()
    let owner: PreviewStatusPublication | undefined = this
    const ticket: StatusReservation = {
      publish() {
        const publication = owner
        if (!publication || publication.#pending !== ticket || publication.#closed)
          throw new Error('Superseded preview status')
        owner = undefined
        publication.#pending = undefined
        const version = ++publication.#version
        if (resource) publication.#resources.set(version, resource)
        resource = undefined
        publication.#collect()
        return version
      },
      release() {
        if (owner && owner.#pending === ticket) owner.#pending = undefined
        owner = undefined
        const previous = resource
        resource = undefined
        previous?.release()
      },
    }
    this.#pending = ticket
    return ticket
  }

  /** Native/empty status also advances acknowledgement, without adding a packed resource.
   * It remains available when packed publication admission fails.
   */
  replace(): number {
    if (this.#closed) return this.#version
    this.#pending?.release()
    if (this.#version >= Number.MAX_SAFE_INTEGER) throw new Error('semantic-limit')
    this.#version++
    this.#collect()
    return this.#version
  }

  subscribe(): StatusConsumer {
    if (this.#closed) return { acknowledge() {}, release() {} }
    if (this.#consumers.size >= previewStatusLimits.consumers) throw new Error('semantic-limit')
    const key = {}
    this.#consumers.set(key, 0)
    let owner: PreviewStatusPublication | undefined = this
    return {
      acknowledge(version) {
        const publication = owner
        const previous = publication ? publication.#consumers.get(key) : undefined
        if (previous === undefined) return
        if (
          !publication ||
          !Number.isSafeInteger(version) ||
          version < 0 ||
          version > publication.#version
        )
          throw new Error('Invalid preview status acknowledgement')
        if (version > previous) publication.#consumers.set(key, version)
        publication.#collect()
      },
      release() {
        const publication = owner
        owner = undefined
        if (publication) {
          publication.#consumers.delete(key)
          publication.#collect()
        }
      },
    }
  }

  close(): number {
    if (this.#closed) return this.#version
    this.replace()
    this.#closed = true
    return this.#version
  }

  #collect(): void {
    let oldest = this.#version
    for (const version of this.#consumers.values()) oldest = Math.min(oldest, version)
    for (const [version, resource] of this.#resources)
      if (version < oldest) {
        this.#resources.delete(version)
        resource.release()
      }
  }
}
