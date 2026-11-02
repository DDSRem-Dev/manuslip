import { expect, it, vi } from 'vitest'
import type { SemanticFailureReason } from '../../../../../src/renderer/src/semantics/metrics'
import {
  type PackedChannelPort,
  PackedSemanticPort,
} from '../../../../../src/renderer/src/semantics/packed-port'
import { PackedSemanticReceiver } from '../../../../../src/renderer/src/semantics/packed-receiver'

const MiB = 1024 * 1024
const makeReceiver = () =>
  new PackedSemanticReceiver(
    { bytes: 8 * MiB, retained: 64 * MiB, staging: 8 * MiB, captures: 8, readers: 160 },
    { retained: 32 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 },
  )

it.each([
  ['message', false],
  ['message', true],
  ['failure', false],
  ['failure', true],
] as const)(
  'releases a failed %s registration even when channel termination throws: %s',
  (stage, cleanupThrows) => {
    const receiver = makeReceiver()
    const before = receiver.stats
    const original = new Error('Listener registration failed')
    let message: ((value: unknown) => void) | undefined
    let failure: ((reason?: SemanticFailureReason) => void) | undefined
    const terminate = vi.fn(() => {
      // A channel may retain callbacks that were registered before the failure.
      message?.({ kind: 'late-message' })
      failure?.('worker-error')
      if (cleanupThrows) throw new Error('Termination failed')
    })
    const channel: PackedChannelPort = {
      onMessage(listener) {
        message = listener
        if (stage === 'message') throw original
      },
      onFailure(listener) {
        failure = listener
        if (stage === 'failure') throw original
      },
      post: vi.fn(),
      terminate,
    }
    try {
      expect(() => new PackedSemanticPort(channel, receiver)).toThrow(original)
      expect(terminate).toHaveBeenCalledTimes(1)
      expect(receiver.stats).toEqual(before)
      message?.({ kind: 'late-message' })
      failure?.('message-error')
      expect(terminate).toHaveBeenCalledTimes(1)
      expect(receiver.stats).toEqual(before)
      expect(channel.post).not.toHaveBeenCalled()
    } finally {
      receiver.dispose()
      expect(receiver.stats.retainedBytes).toBe(0)
    }
  },
)

it('releases the reservation when runtime setup fails before registering listeners', () => {
  const receiver = makeReceiver()
  const before = receiver.stats
  const original = new Error('Clock binding failed')
  const channel: PackedChannelPort = {
    onMessage: vi.fn(),
    onFailure: vi.fn(),
    post: vi.fn(),
    terminate: vi.fn(),
  }
  try {
    expect(
      () =>
        new PackedSemanticPort(channel, receiver, {
          get now(): () => number {
            throw original
          },
          defer: vi.fn(),
        }),
    ).toThrow(original)
    expect(channel.terminate).toHaveBeenCalledTimes(1)
    expect(channel.onMessage).not.toHaveBeenCalled()
    expect(channel.onFailure).not.toHaveBeenCalled()
    expect(receiver.stats).toEqual(before)
  } finally {
    receiver.dispose()
    expect(receiver.stats.retainedBytes).toBe(0)
  }
})

it('rejects a channel that fails synchronously during setup instead of returning a closed port', () => {
  const receiver = makeReceiver()
  const before = receiver.stats
  const channel: PackedChannelPort = {
    onMessage: vi.fn(),
    onFailure: (listener) => listener('worker-error'),
    post: vi.fn(),
    terminate: vi.fn(),
  }
  try {
    expect(() => new PackedSemanticPort(channel, receiver)).toThrow(
      'Packed semantic port closed during setup',
    )
    expect(channel.terminate).toHaveBeenCalledTimes(1)
    expect(channel.post).not.toHaveBeenCalled()
    expect(receiver.stats).toEqual(before)
  } finally {
    receiver.dispose()
    expect(receiver.stats.retainedBytes).toBe(0)
  }
})

it('terminates the channel when the initial reservation cannot be admitted', () => {
  const receiver = makeReceiver()
  const before = receiver.stats
  const original = new Error('Packed session exceeds retained limit')
  const retain = vi.spyOn(receiver, 'retain').mockImplementation(() => {
    throw original
  })
  const channel: PackedChannelPort = {
    onMessage: vi.fn(),
    onFailure: vi.fn(),
    post: vi.fn(),
    terminate: vi.fn(),
  }
  try {
    expect(() => new PackedSemanticPort(channel, receiver)).toThrow(original)
    expect(channel.terminate).toHaveBeenCalledTimes(1)
    expect(channel.onMessage).not.toHaveBeenCalled()
    expect(channel.onFailure).not.toHaveBeenCalled()
    expect(receiver.stats).toEqual(before)
  } finally {
    retain.mockRestore()
    receiver.dispose()
    expect(receiver.stats.retainedBytes).toBe(0)
  }
})
