import type { PackedHold } from '../../../../../../packages/core/src/packing-hold'
import { packedWireVersion } from '../../../../../../packages/core/src/packing-wire'
import { wireRecord } from '../../../../../../packages/core/src/packing-wire-values'
import {
  type PackedCorrelation,
  packedChannelKind,
  packedCorrelation,
  sameCorrelation,
} from './packed-channel'
import { PackedProducerHost } from './packed-producer-host'
import { absoluteNow } from './protocol'
import type { SliceRuntime } from './sliced-work'

interface Channel {
  post(value: unknown, transfer: ArrayBuffer[]): void
}
/** Correlated Worker protocol. Old ACKs/cancels cannot revoke a newer request. The
 * application service owns watchdog/restart policy; invalid protocol input throws.
 */
export class PackedWorkerEndpoint {
  readonly #host: PackedProducerHost
  readonly #hold: PackedHold
  #channel: Channel | undefined
  #current: PackedCorrelation | undefined
  #pending: PackedCorrelation | undefined
  #starting = false
  #startupFailure: { error: unknown } | undefined
  constructor(channel: Channel, runtime?: SliceRuntime) {
    this.#channel = channel
    this.#host = new PackedProducerHost(
      {
        post: (output, transfer) => {
          if (output.kind === 'offer') this.#channel?.post(output.message, transfer)
        },
        failed: (error) => {
          if (this.#starting) this.#startupFailure = { error }
          else this.#failed(error)
        },
      },
      runtime,
    )
    try {
      this.#hold = this.#host.retain({ resources: () => [{ key: this, bytes: 4096 }] })
    } catch (error) {
      this.#host.dispose()
      throw error
    }
  }
  get stats() {
    return this.#host.stats
  }
  #failed(error: unknown): void {
    const current = this.#current
    this.#current = undefined
    if (!current) return
    this.#sendFailure(current, error)
  }
  #sendFailure(current: PackedCorrelation, error: unknown): void {
    const capacity =
      error instanceof Error &&
      !error.message.startsWith('Invalid ') &&
      /limit|scope|capacity/.test(error.message)
    this.#channel?.post(
      {
        protocol: packedWireVersion,
        kind: 'semantic-error',
        ...current,
        code: capacity ? 'semantic-limit' : 'semantic-parse',
        sentAt: absoluteNow(),
      },
      [],
    )
  }
  receive(value: unknown): void {
    this.#receive(value, false)
  }
  /** Actual Worker entry. A candidate has its own correlation until its source passes. */
  receiveCooperative(value: unknown): void {
    this.#receive(value, true)
  }
  #receive(value: unknown, cooperative: boolean): void {
    if (!this.#channel) throw new Error('Packed worker endpoint disposed')
    switch (packedChannelKind(value)) {
      case 'prepare': {
        const command = wireRecord(value, ['kind', 'input', 'exchange'])
        const exchange = wireRecord(command.exchange, [
          'protocol',
          'kind',
          'sequence',
          'identity',
          'requestToken',
          'base',
        ])
        const next = packedCorrelation({
          sequence: exchange.sequence,
          requestToken: exchange.requestToken,
        })
        if (cooperative) {
          try {
            this.#host.prepareCooperative(command.input, command.exchange, {
              queued: () => {
                this.#pending = next
              },
              activated: () => {
                if (sameCorrelation(this.#pending, next)) this.#pending = undefined
                this.#current = next
              },
              cancelled: () => {
                if (sameCorrelation(this.#pending, next)) this.#pending = undefined
              },
              failed: (error) => {
                if (sameCorrelation(this.#pending, next)) this.#pending = undefined
                if (sameCorrelation(this.#current, next)) this.#current = undefined
                this.#sendFailure(next, error)
              },
            })
          } catch (error) {
            this.#sendFailure(next, error)
          }
          return
        }
        this.#starting = true
        try {
          this.#host.prepare(command.input, command.exchange)
          this.#current = next
          if (this.#startupFailure) this.#failed(this.#startupFailure.error)
        } finally {
          this.#starting = false
          this.#startupFailure = undefined
        }
        return
      }
      case 'ack': {
        const command = wireRecord(value, ['kind', 'acknowledgement'])
        const ack = wireRecord(command.acknowledgement, [
          'protocol',
          'kind',
          'sequence',
          'result',
          'requestToken',
          'resultToken',
        ])
        const key = packedCorrelation({ sequence: ack.sequence, requestToken: ack.requestToken })
        if (!sameCorrelation(this.#current, key)) return
        this.#host.acknowledge(command.acknowledgement)
        this.#current = undefined
        // Optional idle work is revoked by the next valid prepare/cancel/disposal.
        this.#host.cache()
        return
      }
      case 'cancel': {
        const command = wireRecord(value, ['kind', 'sequence', 'requestToken'])
        const key = packedCorrelation({
          sequence: command.sequence,
          requestToken: command.requestToken,
        })
        if (sameCorrelation(this.#pending, key)) {
          this.#host.cancelSource()
          return
        }
        if (!sameCorrelation(this.#current, key)) return
        this.#current = undefined
        this.#host.cancelOffer()
        return
      }
      default:
        throw new Error('Invalid packed worker operation')
    }
  }
  dispose(): void {
    if (!this.#channel) return
    this.#channel = undefined
    this.#current = undefined
    this.#pending = undefined
    try {
      this.#hold.release()
    } finally {
      this.#host.dispose()
    }
  }
}
