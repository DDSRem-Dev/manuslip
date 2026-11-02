import { describe, expect, it, vi } from 'vitest'
import { sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { PackedSession } from '../../src/packing-session'
import { offsetNode, PackedView, rangeNode } from '../../src/packing-view'

const MiB = 1024 * 1024
function fixture(changed = {}) {
  const owner = new PackedSession({
    bytes: MiB,
    retained: 4 * MiB,
    staging: MiB,
    captures: 4,
    readers: 8,
    ...changed,
  })
  const text = 'source'
  const identity = {
    generation: 1,
    revision: 0,
    documentId: 'capture',
    sourceHash: sourceHash(text),
    parserVersion: 'test',
    rendererVersion: 'test',
    options: 'test',
  }
  owner.commit(
    owner.prepareFull(
      owner.begin(identity, text),
      identity,
      packValue(
        { values: [{ text: 'x'.repeat(100000) }, { number: 3, boolean: true, null: null }] },
        MiB,
      ),
    ),
  )
  return { owner, capture: owner.capture() }
}
describe('guarded packed child scopes and validator workspaces', () => {
  it.each(['return', 'release', 'dispose', 'complete', 'throw'] as const)(
    'runs work cleanup exactly once during %s, including before the first advance',
    (action) => {
      for (const advance of [false, true]) {
        const { owner, capture } = fixture()
        const before = owner.stats
        const closed = vi.fn()
        const finalized = vi.fn()
        const failure = new Error('Work failed')
        const work = capture.work(
          (function* () {
            try {
              yield
              if (action === 'throw') throw failure
              return 42
            } finally {
              finalized()
            }
          })(),
          closed,
        )
        try {
          if (advance) expect(work.next().done).toBe(false)
          if (action === 'return') work.return()
          if (action === 'release') capture.release()
          if (action === 'dispose') owner.dispose()
          if (action === 'complete' || action === 'throw') {
            if (!advance) expect(work.next().done).toBe(false)
            if (action === 'throw') expect(() => work.next()).toThrow(failure)
            else expect(work.next()).toEqual({ done: true, value: 42 })
          }
          expect(closed).toHaveBeenCalledTimes(1)
          expect(finalized).toHaveBeenCalledTimes(
            Number(advance || action === 'complete' || action === 'throw'),
          )
          expect(owner.stats.readers).toBe(0)
          if (action !== 'release' && action !== 'dispose') expect(owner.stats).toEqual(before)
          expect(work.next().done).toBe(true)
          work.return()
          expect(closed).toHaveBeenCalledTimes(1)
        } finally {
          work.return()
          owner.dispose()
        }
      }
    },
  )

  it.each([false, true])('closes work if optional cleanup throws after advance=%s', (advance) => {
    const { owner, capture } = fixture()
    const before = owner.stats
    const failure = new Error('Cleanup failed')
    const finalized = vi.fn()
    const work = capture.work(
      (function* () {
        try {
          yield
        } finally {
          finalized()
        }
      })(),
      () => {
        throw failure
      },
    )
    try {
      if (advance) work.next()
      expect(() => work.return()).toThrow(failure)
      expect(finalized).toHaveBeenCalledTimes(Number(advance))
      expect(owner.stats).toEqual(before)
      expect(work.next().done).toBe(true)
      work.return()
    } finally {
      owner.dispose()
    }
  })

  it('reports the complete revision charge without retaining a new capture', () => {
    const { owner, capture } = fixture()
    const before = owner.stats
    try {
      expect(capture.retainedBytes).toBeGreaterThan(100000)
      expect(capture.retainedBytes).toBeLessThanOrEqual(before.retainedBytes)
      expect(owner.stats).toEqual(before)
      capture.release()
      expect(() => capture.retainedBytes).toThrow('released')
    } finally {
      owner.dispose()
    }
  })

  it.each(['release', 'dispose'] as const)(
    'finishes all revocation after an inspector cleanup throws during %s',
    (action) => {
      const { owner, capture } = fixture()
      const other = owner.capture()
      owner.evict()
      const failure = new Error('Inspector cleanup failed')
      const rejectCleanup = () => {
        throw failure
      }
      const workspace = capture.reserveWorkspace(1024, 512)
      const output = capture.own({ result: true }, 512)
      const work = capture.work(
        (function* () {
          try {
            yield
          } finally {
            rejectCleanup()
          }
        })(),
      )
      const queued = capture.work(
        (function* () {
          yield
          throw new Error('Revoked queued work started')
        })(),
      )
      work.next()
      try {
        expect(() => (action === 'release' ? capture.release() : owner.dispose())).toThrow(failure)
        expect(work.next().done).toBe(true)
        expect(queued.next().done).toBe(true)
        expect(() => workspace.resize(0, 0)).toThrow('released')
        expect(owner.stats.readerStagingBytes).toBe(0)
        expect(owner.stats.readers).toBe(0)
        if (action === 'release') {
          expect(other.identity.documentId).toBe('capture')
          expect(output.value.result).toBe(true)
          other.release()
          output.release()
          expect(owner.stats.retainedBytes).toBe(256)
        } else {
          expect(() => other.identity).toThrow('released')
          expect(() => output.value).toThrow('released')
          expect(owner.stats.retainedBytes).toBe(0)
        }
      } finally {
        capture.release()
        other.release()
        output.release()
        owner.dispose()
      }
    },
  )

  it.each(['commit', 'discard', 'invalidate', 'evict', 'dispose'] as const)(
    'closes every prepared inspection when its cleanup throws during %s',
    (action) => {
      const { owner, capture } = fixture()
      const identity = capture.identity
      const before = owner.stats
      const ticket = owner.prepareFull(
        owner.begin({ ...identity, revision: 1 }, 'source'),
        { ...identity, revision: 1 },
        packValue({ pending: true }, MiB),
      )
      const inspection = owner.capturePrepared(ticket)
      const second = inspection.retain()
      const failure = new Error('Prepared inspection cleanup failed')
      const rejectCleanup = () => {
        throw failure
      }
      const work = inspection.work(
        (function* () {
          try {
            yield
          } finally {
            rejectCleanup()
          }
        })(),
      )
      const queued = second.work(
        (function* () {
          yield
        })(),
      )
      work.next()
      try {
        expect(() =>
          action === 'discard' || action === 'commit' ? owner[action](ticket) : owner[action](),
        ).toThrow(failure)
        expect(work.next().done).toBe(true)
        expect(queued.next().done).toBe(true)
        expect(() => inspection.identity).toThrow('released')
        expect(() => second.identity).toThrow('released')
        expect(owner.stats).toMatchObject({ prepared: null, readers: 0, readerStagingBytes: 0 })
        if (action === 'commit' || action === 'discard' || action === 'invalidate') {
          owner.invalidate()
          expect(owner.stats).toEqual(before)
          expect(capture.identity).toEqual(identity)
        } else if (action === 'evict') {
          expect(capture.identity).toEqual(identity)
          capture.release()
          expect(owner.stats.retainedBytes).toBe(256)
        } else expect(owner.stats.retainedBytes).toBe(0)
      } finally {
        capture.release()
        owner.dispose()
      }
    },
  )

  it.each(['release', 'advance', 'return'] as const)(
    'guards every atomic path query after %s',
    (action) => {
      const { owner, capture } = fixture()
      try {
        const items = capture.reader.elements(['values'])
        const first = items.next()
        if (first.done) throw new Error('fixture')
        const scope = first.value.at([]).at([])
        const queries = [
          () => scope.assertOpen(),
          () => scope.kind(['text']),
          () => scope.textLength(['text']),
          () => scope.scalarType(['text']),
          () => scope.scalarCost(['text']),
          () => scope.scalar(['text'], { retained: MiB, staging: MiB }),
          () => scope.textStepCost(['text']),
          () => scope.cachedText(['text']),
          () => scope.recordKey(['text']),
          () => scope.keyCount(),
          () => scope.keys([], { retained: MiB, staging: MiB }),
          () => scope.matchesKeys([], ['text'], [], { retained: MiB, staging: MiB }),
        ]
        for (const query of queries) query()
        if (action === 'release') capture.release()
        else if (action === 'advance') items.next()
        else items.return()
        for (const query of queries) expect(query).toThrow('expired')
        expect(() => scope.length(['missing'])).toThrow('expired')
        expect(() => scope.position(['missing'], { retained: 0, staging: 0 })).toThrow('expired')
        items.return()
        expect(owner.stats.readers).toBe(0)
      } finally {
        owner.dispose()
      }
    },
  )

  it('copies composed paths, keeps sibling scopes independent and guards long empty chains', () => {
    const { owner, capture } = fixture()
    try {
      const prefix: (string | number)[] = ['values']
      const values = capture.reader.at(prefix)
      const suffix = [1]
      const object = values.at(suffix)
      const number = object.at(['number'])
      prefix[0] = 'missing'
      suffix[0] = 0
      expect(values.length()).toBe(2)
      expect(object.keys([], { retained: 4096, staging: 0 })).toEqual(['number', 'boolean', 'null'])
      expect(object.hasField('number')).toBe(true)
      expect(number.scalar([], { retained: 16, staging: 0 })).toBe(3)
      expect(object.scalar(['boolean'], { retained: 16, staging: 0 })).toBe(true)
      let deep = number
      for (let index = 0; index < 2000; index++) deep = deep.at([])
      expect(deep.scalarType()).toBe('number')
      expect(deep.scalar([], { retained: 16, staging: 0 })).toBe(3)
      expect(() => object.at(['missing'])).toThrow('path')
      expect(number.scalarType()).toBe('number')
      capture.release()
      for (const scope of [values, object, number, deep])
        expect(() => scope.kind()).toThrow('released')
    } finally {
      owner.dispose()
    }
  })

  it('independently owns streams opened from composed child scopes across item expiry', () => {
    const { owner, capture } = fixture()
    try {
      const values = capture.reader.at(['values']).at([])
      const items = values.elements()
      const first = items.next()
      if (first.done) throw new Error('fixture')
      const selected = first.value.at(['text']).at([])
      const stream = selected.textSteps([], { retained: MiB, staging: MiB })
      items.next()
      expect(() => selected.textLength()).toThrow('expired')
      expect([...stream].filter((value) => value !== undefined).join('')).toBe('x'.repeat(100000))
      items.return()
      expect(owner.stats.readers).toBe(0)
      const iterator = capture.reader.at([]).at([]).elements(['values'])
      const child = iterator.next()
      if (child.done) throw new Error('fixture')
      const pending = child.value.at(['text']).textSteps([], { retained: MiB, staging: MiB })
      capture.release()
      expect(pending.next().done).toBe(true)
      expect(iterator.next().done).toBe(true)
      expect(owner.stats.readers).toBe(0)
      expect(owner.stats.readerStagingBytes).toBe(0)
    } finally {
      owner.dispose()
    }
  })

  it('resizes one workspace atomically at exact retained and staging capacities', () => {
    const { owner, capture } = fixture({ readers: 1 })
    const before = owner.stats
    const retained = 4 * MiB - before.retainedBytes - 512
    const workspace = capture.reserveWorkspace(retained, MiB)
    try {
      expect(owner.stats.retainedBytes).toBe(4 * MiB)
      expect(owner.stats.readerStagingBytes).toBe(MiB)
      expect(owner.stats.readers).toBe(1)
      const full = owner.stats
      expect(() => workspace.resize(retained + 1, MiB)).toThrow('scope')
      expect(owner.stats).toEqual(full)
      // Even shrinking one side must not change the charge when the other side fails.
      expect(() => workspace.resize(0, MiB + 1)).toThrow('staging')
      expect(owner.stats).toEqual(full)
      expect(() => workspace.resize(retained + 1, 0)).toThrow('scope')
      expect(owner.stats).toEqual(full)
      expect(() => capture.workspace(0, 0)).toThrow('scope')
      workspace.resize(100, 200)
      expect(owner.stats.retainedBytes).toBe(before.retainedBytes + 512 + 100)
      expect(owner.stats.readerStagingBytes).toBe(200)
      expect(owner.stats.readers).toBe(1)
      workspace.resize(retained, MiB)
      expect(owner.stats).toEqual(full)
      workspace.resize(0, 0)
      expect(owner.stats.retainedBytes).toBe(before.retainedBytes + 512)
      workspace.release()
      expect(owner.stats).toEqual(before)
      expect(() => workspace.resize(0, 0)).toThrow('released')
      workspace.release()
      expect(owner.stats).toEqual(before)
    } finally {
      owner.dispose()
    }
  })
  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid workspace totals %s without changing accounting',
    (invalid) => {
      const { owner, capture } = fixture()
      const before = owner.stats
      try {
        expect(() => capture.reserveWorkspace(invalid, 0)).toThrow('Invalid')
        expect(() => capture.reserveWorkspace(0, invalid)).toThrow('Invalid')
        expect(owner.stats).toEqual(before)
        const workspace = capture.reserveWorkspace(100, 200)
        const reserved = owner.stats
        expect(() => workspace.resize(invalid, 0)).toThrow('Invalid')
        expect(() => workspace.resize(0, invalid)).toThrow('Invalid')
        expect(owner.stats).toEqual(reserved)
        workspace.release()
        expect(owner.stats).toEqual(before)
      } finally {
        owner.dispose()
      }
    },
  )
  it.each(['release', 'dispose'] as const)('revokes a resizable workspace on %s', (action) => {
    const { owner, capture } = fixture()
    const workspace = capture.reserveWorkspace(10000, 20000)
    workspace.resize(30000, 40000)
    if (action === 'release') capture.release()
    else owner.dispose()
    expect(owner.stats.readers).toBe(0)
    expect(owner.stats.readerStagingBytes).toBe(0)
    const after = owner.stats
    expect(() => workspace.resize(1, 1)).toThrow('released')
    workspace.release()
    expect(owner.stats).toEqual(after)
    owner.dispose()
    expect(owner.stats.retainedBytes).toBe(0)
  })
  it('reads scalar tags and key counts without decoding a long value', () => {
    const context = fixture()
    const scalar = vi.spyOn(PackedArena.prototype, 'scalar')
    try {
      const object = context.capture.reader.at(['values', 1])
      expect(object.keyCount()).toBe(3)
      expect(object.hasField('null')).toBe(true)
      expect(object.hasField('missing')).toBe(false)
      expect(object.hasField('toString')).toBe(false)
      expect(object.scalarType(['number'])).toBe('number')
      expect(object.scalarType(['boolean'])).toBe('boolean')
      expect(object.scalarType(['null'])).toBe('null')
      expect(context.capture.reader.scalarType(['values', 0, 'text'])).toBe('string')
      expect(scalar).not.toHaveBeenCalled()
      expect(() => object.scalarType()).toThrow()
      expect(() => object.keyCount(['number'])).toThrow()
      expect(() => object.at(['number']).hasField('field')).toThrow()
    } finally {
      scalar.mockRestore()
      context.owner.dispose()
    }
  })
  it('checks own fields through lazy transforms and overlays without enumerating keys', () => {
    const arena = PackedArena.open(
      packValue({ from: 1, to: 2, ['__proto__']: null, constructor: false }, MiB),
      { bytes: MiB, retained: 4 * MiB, staging: MiB },
    )
    const raw = { arena, id: arena.root }
    const shifted = new PackedView(offsetNode(rangeNode(raw, 3), 4))
    const overlay = new PackedView({ fields: [['own', raw]] })
    const keys = vi.spyOn(PackedArena.prototype, 'keys')
    const fields = vi.spyOn(PackedArena.prototype, 'fields')
    try {
      for (const name of ['from', 'to', '__proto__', 'constructor'])
        expect(shifted.hasField(name)).toBe(true)
      expect(shifted.hasField('toString')).toBe(false)
      expect(overlay.hasField('own')).toBe(true)
      expect(overlay.hasField('constructor')).toBe(false)
      expect(keys).not.toHaveBeenCalled()
      expect(fields).not.toHaveBeenCalled()
    } finally {
      keys.mockRestore()
      fields.mockRestore()
    }
  })
  it('copies a child path and revokes child scopes with their capture', () => {
    const { owner, capture } = fixture()
    const path: (string | number)[] = ['values', 1]
    const selected = capture.reader.at(path)
    path[1] = 0
    expect(selected.keyCount()).toBe(3)
    capture.release()
    expect(() => selected.keyCount()).toThrow('released')
    expect(() => selected.hasField('number')).toThrow('released')
    expect(() => selected.at(['number'])).toThrow('released')
    owner.dispose()
    expect(owner.stats.retainedBytes).toBe(0)
  })
  it('expires child item scopes on parent advancement and return', () => {
    const { owner, capture } = fixture()
    try {
      const items = capture.reader.elements(['values'])
      const first = items.next()
      if (first.done) throw new Error('Fixture')
      const text = first.value.at(['text'])
      expect(text.scalarType()).toBe('string')
      expect(text.cachedText()).toBeUndefined()
      const second = items.next()
      if (second.done) throw new Error('Fixture')
      const number = second.value.at(['number'])
      expect(() => text.scalarType()).toThrow('expired')
      expect(() => text.cachedText()).toThrow('expired')
      expect(() => first.value.hasField('text')).toThrow('expired')
      expect(number.scalarType()).toBe('number')
      items.return()
      expect(() => number.scalarType()).toThrow('expired')
      expect(owner.stats.readers).toBe(0)
    } finally {
      owner.dispose()
    }
  })
  it('rejects invalid paths and workspace reservations without changing accounting', () => {
    const { owner, capture } = fixture()
    const before = owner.stats
    try {
      for (const path of [[-1], [NaN], ['x'.repeat(1025)], Array(129).fill('x')])
        expect(() => capture.reader.at(path)).toThrow('path')
      for (const [retained, staging] of [
        [-1, 0],
        [0, -1],
        [NaN, 0],
        [Infinity, 0],
        [0, MiB + 1],
        [4 * MiB, 0],
      ])
        expect(() => capture.workspace(retained ?? 0, staging ?? 0)).toThrow()
      expect(owner.stats).toEqual(before)
    } finally {
      owner.dispose()
    }
  })
  it.each(['release', 'dispose'] as const)(
    'charges simultaneous workspaces and revokes escaped holds on %s',
    (action) => {
      const { owner, capture } = fixture({ readers: 2 })
      const before = owner.stats
      const one = capture.workspace(1024, 600000)
      expect(owner.stats.retainedBytes).toBe(before.retainedBytes + 1024 + 512)
      expect(owner.stats.readerStagingBytes).toBe(600000)
      expect(() => capture.workspace(0, 600000)).toThrow('staging')
      const two = capture.workspace(2048, 1)
      expect(owner.stats.readers).toBe(2)
      expect(() => capture.workspace(0, 0)).toThrow('scope')
      if (action === 'release') capture.release()
      else owner.dispose()
      expect(owner.stats.readers).toBe(0)
      expect(owner.stats.readerStagingBytes).toBe(0)
      const after = owner.stats
      one.release()
      two.release()
      one.release()
      expect(owner.stats).toEqual(after)
      expect(() => capture.workspace(0, 0)).toThrow('released')
      owner.dispose()
      expect(owner.stats.retainedBytes).toBe(0)
    },
  )
})
