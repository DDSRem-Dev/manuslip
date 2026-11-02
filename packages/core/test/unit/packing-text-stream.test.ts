import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { PackedReadScope, PackedTextSteps } from '../../src/packing-capture'
import { PackedSession } from '../../src/packing-session'
import type { PackedIdentity } from '../../src/packing-source'
import { packedStringChunkUnits } from '../../src/packing-string'
import { PackedText } from '../../src/packing-text'
import { packedTextStepCost, streamPackedText } from '../../src/packing-text-stream'
import {
  equalPackedChunks,
  equalPackedText,
  validationStreamLimits,
} from '../../src/packing-validation-read'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 16 * MiB, staging: 8 * MiB, captures: 8, readers: 64 }
const identity = (source: string, revision = 0): PackedIdentity => ({
  generation: 1,
  documentId: 'stream-test',
  revision,
  sourceHash: sourceHash(source),
  parserVersion: 'parser',
  rendererVersion: 'renderer',
  options: 'options',
})
function publish(owner: PackedSession, value: unknown) {
  const source = 'source'
  const id = identity(source)
  owner.commit(owner.prepareFull(owner.begin(id, source), id, packValue(value, limits.bytes)))
}
function edit(
  owner: PackedSession,
  insert: string,
  start: number,
  remove: number,
  path: (string | number)[] = ['html'],
) {
  const capture = owner.capture()
  const base = capture.identity
  const before = capture.sourceResource.text
  capture.release()
  const source = `${before}x`
  const result = identity(source, base.revision + 1)
  // A scalar-only arena has record zero as root.
  owner.commit(
    owner.prepareDelta(owner.begin(result, source), {
      base,
      baseSource: before,
      result,
      payload: packValue(insert, limits.bytes),
      operations: [{ kind: 'text', path, start, remove, record: 0 }],
    }),
  )
}
function collect(steps: Iterable<string | undefined>) {
  const chunks: string[] = []
  for (const chunk of steps) {
    if (chunk === undefined) continue
    expect(chunk.length).toBeGreaterThan(0)
    expect(chunk.length).toBeLessThanOrEqual(packedStringChunkUnits)
    chunks.push(chunk)
  }
  return chunks.join('')
}

describe('bounded revocable packed text streams', () => {
  it.each(
    (['chunks', 'text'] as const).flatMap((helper) => [
      { helper, primary: false, undefinedError: false },
      { helper, primary: false, undefinedError: true },
      { helper, primary: true, undefinedError: false },
      { helper, primary: true, undefinedError: true },
    ]),
  )(
    'closes both comparison decoders after a close throws: $helper/$primary/$undefinedError',
    ({ helper, primary, undefinedError }) => {
      const owner = new PackedSession(limits)
      publish(owner, { left: '界😀 words '.repeat(10000), right: '界😀 words '.repeat(10000) })
      const capture = owner.capture()
      const before = owner.stats
      const streams: PackedTextSteps[] = []
      const closed: PackedTextSteps[] = []
      const textSteps = PackedReadScope.prototype.textSteps
      const opened = vi.spyOn(PackedReadScope.prototype, 'textSteps').mockImplementation(function (
        this: PackedReadScope,
        path,
        budget,
      ) {
        const stream = textSteps.call(this, path, budget)
        streams.push(stream)
        return stream
      })
      const work =
        helper === 'chunks'
          ? equalPackedChunks(
              capture.reader.textSteps(['left'], validationStreamLimits),
              capture.reader.textSteps(['right'], validationStreamLimits),
            )
          : equalPackedText(capture.reader, ['left'], ['right'], limits)
      const original = undefinedError ? undefined : new Error('Comparison read failed')
      const failure = primary ? new Error('First close failed') : original
      let close: ReturnType<typeof vi.spyOn> | undefined
      let read: ReturnType<typeof vi.spyOn> | undefined
      try {
        expect(work.next().done).toBe(false)
        expect(work.next().done).toBe(false)
        expect(streams).toHaveLength(2)
        expect(owner.stats.readers).toBe(2)
        const realReturn = PackedTextSteps.prototype.return
        close = vi.spyOn(PackedTextSteps.prototype, 'return').mockImplementation(function (
          this: PackedTextSteps,
        ) {
          const result = realReturn.call(this)
          if (streams.includes(this)) {
            closed.push(this)
            if (this === streams[0]) throw failure
            throw new Error('Second close failed')
          }
          return result
        })
        if (primary) {
          const realNext = PackedTextSteps.prototype.next
          read = vi.spyOn(PackedTextSteps.prototype, 'next').mockImplementation(function (
            this: PackedTextSteps,
          ) {
            if (this === streams[0]) throw original
            return realNext.call(this)
          })
        }
        let threw = false
        let caught: unknown
        try {
          if (primary) {
            // The comparison can still consume its admitted current chunks before reading again.
            while (!work.next().done) {}
          } else work.return(undefined)
        } catch (error) {
          threw = true
          caught = error
        }
        expect(threw).toBe(true)
        expect(caught).toBe(original)
        expect(closed).toHaveLength(2)
        expect(closed[0]).toBe(streams[0])
        expect(closed[1]).toBe(streams[1])
        expect(owner.stats).toEqual(before)
        read?.mockRestore()
        close.mockRestore()
        for (const stream of streams)
          expect(stream.next()).toEqual({ done: true, value: undefined })
        expect(work.next()).toEqual({ done: true, value: undefined })
      } finally {
        read?.mockRestore()
        close?.mockRestore()
        opened.mockRestore()
        work.return(undefined)
        capture.release()
        owner.dispose()
      }
      expect(owner.stats.retainedBytes).toBe(0)
    },
  )
  it.each([false, true])(
    'preserves second decoder setup failure and closes the first once, including undefined: %s',
    (undefinedError) => {
      const owner = new PackedSession(limits)
      publish(owner, { left: 'word '.repeat(10000), right: 'word '.repeat(10000) })
      const capture = owner.capture()
      const before = owner.stats
      const original = undefinedError ? undefined : new Error('Second decoder setup failed')
      const textSteps = PackedReadScope.prototype.textSteps
      let first: PackedTextSteps | undefined
      const opened = vi.spyOn(PackedReadScope.prototype, 'textSteps').mockImplementation(function (
        this: PackedReadScope,
        path,
        budget,
      ) {
        if (path[0] === 'right') throw original
        first = textSteps.call(this, path, budget)
        return first
      })
      const realReturn = PackedTextSteps.prototype.return
      let closes = 0
      const close = vi.spyOn(PackedTextSteps.prototype, 'return').mockImplementation(function (
        this: PackedTextSteps,
      ) {
        const result = realReturn.call(this)
        if (this === first) {
          closes++
          throw new Error('First decoder close failed')
        }
        return result
      })
      const work = equalPackedText(capture.reader, ['left'], ['right'], limits)
      try {
        let threw = false
        let caught: unknown
        try {
          work.next()
        } catch (error) {
          threw = true
          caught = error
        }
        expect(threw).toBe(true)
        expect(caught).toBe(original)
        expect(closes).toBe(1)
        expect(owner.stats).toEqual(before)
        close.mockRestore()
        expect(first?.next()).toEqual({ done: true, value: undefined })
        expect(work.next()).toEqual({ done: true, value: undefined })
      } finally {
        close.mockRestore()
        opened.mockRestore()
        work.return(undefined)
        capture.release()
        owner.dispose()
      }
      expect(owner.stats.retainedBytes).toBe(0)
    },
  )
  it.each([
    '',
    'short',
    '😀界\ud800\udfff\n"\\\0'.repeat(2000),
    Array.from({ length: 65536 }, (_, unit) => String.fromCharCode(unit)).join(''),
  ])('preserves every UTF-16 code unit through capture streaming: fixture %i', (text) => {
    const owner = new PackedSession(limits)
    try {
      publish(owner, { html: text })
      const capture = owner.capture()
      expect(capture.reader.textStepCost(['html'])).toEqual(packedTextStepCost)
      const before = owner.stats.retainedBytes
      const stream = capture.reader.textSteps(['html'], packedTextStepCostToLimits())
      expect(owner.stats.readers).toBe(1)
      expect(owner.stats.retainedBytes - before).toBe(
        512 + packedTextStepCost.retained + packedTextStepCost.workspace,
      )
      expect(collect(stream)).toBe(text)
      expect(owner.stats).toMatchObject({ readers: 0, retainedBytes: before })
      capture.release()
    } finally {
      owner.dispose()
    }
    expect(owner.stats.retainedBytes).toBe(0)
  })
  it('streams a long history with a bounded decoder cache, without whole scalar decoding or joining', () => {
    const owner = new PackedSession(limits)
    const original = `${'a'.repeat(30000)}😀${'b'.repeat(30000)}界${'c'.repeat(30000)}`
    publish(owner, { html: original, unrelated: 'z'.repeat(2 * MiB) })
    const old = owner.capture()
    let expected = original
    for (let index = 0; index < 20; index++) {
      const start = 100 + index * 3000
      edit(owner, `${index}😀`, start, 2)
      expected = `${expected.slice(0, start)}${index}😀${expected.slice(start + 2)}`
    }
    const capture = owner.capture()
    const scalar = vi.spyOn(PackedArena.prototype, 'scalar').mockImplementation(() => {
      throw new Error('Whole scalar read')
    })
    const joined = vi.spyOn(PackedText.prototype, 'scalar').mockImplementation(() => {
      throw new Error('Whole text join')
    })
    const implementation = PackedArena.prototype.stringSteps
    let active = 0
    let peak = 0
    const streamSpy = vi.spyOn(PackedArena.prototype, 'stringSteps').mockImplementation(function* (
      this: PackedArena,
      id,
      workspace,
    ) {
      active++
      peak = Math.max(peak, active)
      try {
        yield* implementation.call(this, id, workspace)
      } finally {
        active--
      }
    })
    try {
      expect(collect(capture.reader.textSteps(['html'], packedTextStepCostToLimits()))).toBe(
        expected,
      )
      expect(streamSpy).toHaveBeenCalledTimes(21)
      expect(peak).toBeLessThanOrEqual(4)
      expect(active).toBe(0)
      expect(scalar).not.toHaveBeenCalled()
      expect(joined).not.toHaveBeenCalled()
      expect(owner.stats.readers).toBe(0)
    } finally {
      scalar.mockRestore()
      joined.mockRestore()
      streamSpy.mockRestore()
      owner.dispose()
    }
    expect(() => old.reader.kind()).toThrow('released')
  })
  it('matches native text through randomized code-unit edits and preserves original captures', () => {
    const owner = new PackedSession(limits)
    let text = 'Start 😀 界\n"\\\ud800 end'
    publish(owner, { html: text })
    const original = owner.capture()
    const before = text
    const inserts = ['', 'x', '😀', '\ud800', '\udfff', '\n"\\', '界']
    let seed = 20261024
    try {
      for (let index = 0; index < 150; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        const start = seed % (text.length + 1)
        const remove = Math.min(index % 4, text.length - start)
        const insert = inserts[index % inserts.length] ?? ''
        edit(owner, insert, start, remove)
        text = text.slice(0, start) + insert + text.slice(start + remove)
        const capture = owner.capture()
        expect(collect(capture.reader.textSteps(['html'], packedTextStepCostToLimits()))).toBe(text)
        capture.release()
      }
      expect(collect(original.reader.textSteps(['html'], packedTextStepCostToLimits()))).toBe(
        before,
      )
    } finally {
      owner.dispose()
    }
  })
  it('bounds backward/evicted-record rescans and progress through a discarded long prefix', () => {
    const arenas = Array.from({ length: 8 }, (_, index) =>
      PackedArena.open(packValue(`${index}${'a'.repeat(100000)}😀`, limits.bytes), limits),
    )
    const pieces = [0, 1, 2, 3, 4, 5, 6, 7, 0, 0, 7, 6, 5, 4, 3, 2, 1, 0].map(
      (index, occurrence) => {
        const arena = arenas[index]
        if (!arena) throw new Error('fixture')
        return { arena, id: arena.root, from: occurrence === 8 ? 99999 : occurrence % 3, length: 4 }
      },
    )
    const expected = pieces
      .map((piece) =>
        `${arenas.indexOf(piece.arena)}${'a'.repeat(100000)}😀`.slice(
          piece.from,
          piece.from + piece.length,
        ),
      )
      .join('')
    const implementation = PackedArena.prototype.stringSteps
    let active = 0
    let peak = 0
    let reads = 0
    const spy = vi.spyOn(PackedArena.prototype, 'stringSteps').mockImplementation(function* (
      this: PackedArena,
      id,
      workspace,
    ) {
      active++
      peak = Math.max(peak, active)
      try {
        for (const chunk of implementation.call(this, id, workspace)) {
          reads++
          yield chunk
        }
      } finally {
        active--
      }
    })
    try {
      const work = streamPackedText(pieces)
      let text = ''
      let progress = 0
      while (true) {
        const before = reads
        const step = work.next()
        expect(reads - before).toBeLessThanOrEqual(1)
        if (step.done) break
        if (step.value === undefined) progress++
        else text += step.value
      }
      expect(text).toBe(expected)
      expect(progress).toBeGreaterThan(20)
      expect(active).toBe(0)
      expect(peak).toBeLessThanOrEqual(4)
    } finally {
      spy.mockRestore()
    }
  })
  it('closes started and unstarted reader scopes on return/throw and capture/session disposal', () => {
    for (const action of ['return', 'throw', 'capture', 'session'] as const) {
      for (const started of [false, true]) {
        const owner = new PackedSession(limits)
        publish(owner, { html: 'x'.repeat(100000) })
        const capture = owner.capture()
        const stream = capture.reader.textSteps(['html'], packedTextStepCostToLimits())
        if (started) expect(stream.next().done).toBe(false)
        expect(owner.stats.readers).toBe(1)
        if (action === 'return') stream.return()
        else if (action === 'throw') expect(() => stream.throw(new Error('Stop'))).toThrow('Stop')
        else if (action === 'capture') capture.release()
        else owner.dispose()
        expect(owner.stats.readers).toBe(0)
        expect(stream.next()).toEqual({ done: true, value: undefined })
        stream.return()
        owner.dispose()
        expect(owner.stats.retainedBytes).toBe(0)
      }
    }
  })
  it('owns its opened scope across parent advancement and session invalidation/eviction', () => {
    const owner = new PackedSession(limits)
    try {
      publish(owner, ['a'.repeat(10000), 'b'])
      const capture = owner.capture()
      const parent = capture.reader.elements()
      const item = parent.next()
      if (item.done) throw new Error('fixture')
      const stream = item.value.textSteps([], packedTextStepCostToLimits())
      parent.next()
      expect(() => item.value.textSteps([], packedTextStepCostToLimits())).toThrow('expired')
      parent.return()
      owner.invalidate()
      owner.evict()
      expect(collect(stream)).toBe('a'.repeat(10000))
      expect(owner.stats.readers).toBe(0)
      capture.release()
    } finally {
      owner.dispose()
    }
  })
  it('preflights caller output/workspace and session staging/retained/readers before decoding', () => {
    const make = (overrides = {}) => {
      const owner = new PackedSession({ ...limits, ...overrides })
      publish(owner, { html: 'long'.repeat(5000) })
      return { owner, capture: owner.capture() }
    }
    const probe = make()
    const stream = probe.capture.reader.textSteps(['html'], packedTextStepCostToLimits())
    const boundary = probe.owner.stats.retainedBytes
    stream.return()
    probe.owner.dispose()
    const spy = vi.spyOn(PackedArena.prototype, 'stringSteps')
    try {
      for (const overrides of [
        { retained: boundary - 1 },
        { staging: packedTextStepCost.workspace - 1 },
        { readers: 0 },
      ]) {
        const { owner, capture } = make(overrides)
        const before = owner.stats
        expect(() => capture.reader.textSteps(['html'], packedTextStepCostToLimits())).toThrow()
        expect(owner.stats).toEqual(before)
        owner.dispose()
      }
      const { owner, capture } = make({
        retained: boundary,
        staging: packedTextStepCost.workspace,
        readers: 1,
      })
      const before = owner.stats
      const cost = packedTextStepCostToLimits()
      for (const invalid of [-1, NaN, Infinity, 0.5])
        for (const key of ['retained', 'staging'])
          expect(() => capture.reader.textSteps(['html'], { ...cost, [key]: invalid })).toThrow(
            'limits',
          )
      expect(() =>
        capture.reader.textSteps(['html'], { ...cost, retained: cost.retained - 1 }),
      ).toThrow('retained')
      expect(() =>
        capture.reader.textSteps(['html'], { ...cost, staging: cost.staging - 1 }),
      ).toThrow('staging')
      expect(owner.stats).toEqual(before)
      expect(spy).not.toHaveBeenCalled()
      const exact = capture.reader.textSteps(['html'], cost)
      expect(owner.stats.retainedBytes).toBe(boundary)
      expect(() => capture.reader.textSteps(['html'], cost)).toThrow('limit')
      expect(owner.stats.readers).toBe(1)
      expect(collect(exact)).toBe('long'.repeat(5000))
      expect(owner.stats).toEqual(before)
      owner.dispose()
    } finally {
      spy.mockRestore()
    }
  })
  it('shares the staging cap with other open streams and subsequent binary preparation', () => {
    const owner = new PackedSession({ ...limits, staging: packedTextStepCost.workspace })
    try {
      publish(owner, { html: 'a'.repeat(10000) })
      const old = owner.capture()
      const stream = old.reader.textSteps(['html'], packedTextStepCostToLimits())
      expect(owner.stats).toMatchObject({
        readers: 1,
        readerStagingBytes: packedTextStepCost.workspace,
      })
      const before = owner.stats
      expect(() => old.reader.textSteps(['html'], packedTextStepCostToLimits())).toThrow(
        'staging limit',
      )
      expect(owner.stats).toEqual(before)
      const next = identity('next', 1)
      const request = owner.begin(next, 'next')
      expect(() =>
        owner.prepareFull(request, next, packValue({ html: 'b'.repeat(10000) }, limits.bytes)),
      ).toThrow('staging')
      expect(owner.stats.current).toEqual(identity('source'))
      expect(owner.stats.readerStagingBytes).toBe(packedTextStepCost.workspace)
      expect(collect(stream)).toBe('a'.repeat(10000))
      expect(owner.stats).toMatchObject({ readers: 0, readerStagingBytes: 0 })
      owner.commit(owner.prepareFull(request, next, packValue({ html: 'new' }, limits.bytes)))
      old.release()
    } finally {
      owner.dispose()
    }
    expect(owner.stats).toMatchObject({ retainedBytes: 0, readerStagingBytes: 0 })
  })
  it.each([null, false, 1, [], {}])(
    'rejects a non-string stream without leaking a reader: %j',
    (value) => {
      const owner = new PackedSession(limits)
      try {
        publish(owner, { html: value })
        const capture = owner.capture()
        expect(() => capture.reader.textSteps(['html'], packedTextStepCostToLimits())).toThrow(
          'not a string',
        )
        expect(owner.stats.readers).toBe(0)
        capture.release()
      } finally {
        owner.dispose()
      }
    },
  )
})
function packedTextStepCostToLimits() {
  return { retained: packedTextStepCost.retained, staging: packedTextStepCost.workspace }
}
