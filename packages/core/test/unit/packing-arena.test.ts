import { describe, expect, it } from 'vitest'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { parseMarkdown } from '../../src/parse'
import examples from '../fixtures/commonmark-0.31.2/spec.json'

const limits = { bytes: 8 * 1024 * 1024, retained: 16 * 1024 * 1024, staging: 8 * 1024 * 1024 }
function materialize(arena: PackedArena, reference = arena.root): unknown {
  switch (arena.kind(reference)) {
    case 'scalar':
      return arena.scalar(reference)
    case 'position':
      return arena.position(reference)
    case 'array':
      return [...arena.elements(reference)].map((id) => materialize(arena, id))
    case 'object':
      return Object.fromEntries(
        arena.keys(reference).map((key) => {
          const id = arena.field(reference, key)
          if (id === undefined) throw new Error('Missing field')
          return [key, materialize(arena, id)]
        }),
      )
  }
}
function open(value: unknown) {
  return PackedArena.open(packValue(value, limits.bytes), limits)
}

function openCooperative(value: unknown): PackedArena {
  const work = PackedArena.openSteps(packValue(value, limits.bytes), limits)
  let step = work.next()
  while (!step.done) step = work.next()
  if (!step.value) throw new Error('Incomplete arena')
  return step.value
}

describe('experimental immutable indexed packed arena', () => {
  it.each([open, openCooperative])(
    'preserves reordered wide-field reads across atomic queries and suspended iterators: %s',
    (create) => {
      const fields = Object.fromEntries(
        Array.from({ length: 64 }, (_, index) => [`field-${index}`, index + 1000]),
      )
      const input = {
        // Force multi-byte record references as well as mixed-width numeric spellings.
        padding: Array.from({ length: 200 }, (_, index) => `padding-${index}`),
        first: fields,
        second: Object.fromEntries(Object.keys(fields).map((key) => [key, `second-${key}`])),
        position: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 2, column: 1, offset: 20 },
        },
      }
      const arena = create(input)
      const roots = Object.fromEntries(arena.fields(arena.root))
      const first = roots.first,
        second = roots.second,
        position = roots.position,
        padding = roots.padding
      if (
        first === undefined ||
        second === undefined ||
        position === undefined ||
        padding === undefined
      )
        throw new Error('fixture')
      const stream = arena.fields(first)
      const keys = arena.keys(first)
      const orders = [keys, [...keys].reverse(), keys.filter((_, index) => index % 3 === 0), keys]
      for (const order of orders)
        for (const key of order) {
          const reference = arena.field(first, key)
          if (reference === undefined) throw new Error('Missing own field')
          expect(arena.scalar(reference)).toBe(fields[key])
          expect(arena.position(position)).toEqual(input.position)
          expect(arena.length(padding)).toBe(200)
          expect(arena.field(first, key)).toBe(reference)
          expect(arena.field(first, 'absent')).toBeUndefined()
          expect(() => arena.field(reference, key)).toThrow('not an object')
          expect(arena.field(first, key)).toBe(reference)
        }
      expect(stream.next().value?.[0]).toBe(keys[0])
      for (const key of keys) {
        const reference = arena.field(second, key)
        if (reference === undefined) throw new Error('Missing second own field')
        expect(arena.scalar(reference)).toBe(input.second[key])
        const firstReference = arena.field(first, key)
        if (firstReference === undefined) throw new Error('Missing first own field')
        expect(arena.scalar(firstReference)).toBe(fields[key])
      }
      expect([...stream].map(([key]) => key)).toEqual(keys.slice(1))
      expect(materialize(arena)).toEqual(input)
    },
  )

  it('keeps repeated field reads exact across records, failures and record zero', () => {
    const arena = open({
      first: { '': null, value: 'first' },
      second: { '': true, value: 'second' },
    })
    const roots = Object.fromEntries(arena.fields(arena.root))
    const first = roots.first
    const second = roots.second
    if (first === undefined || second === undefined) throw new Error('fixture')
    const a = Object.fromEntries(arena.fields(first))
    const b = Object.fromEntries(arena.fields(second))
    expect(a['']).toBe(0)
    for (let repeat = 0; repeat < 3; repeat++) {
      expect(arena.field(first, '')).toBe(a[''])
      expect(arena.field(first, '')).toBe(a[''])
      for (const invalid of [-1, NaN, Infinity, 0.5, arena.records])
        expect(() => arena.field(invalid, '')).toThrow('record ID')
      expect(arena.field(first, 'missing')).toBeUndefined()
      expect(arena.field(first, '')).toBe(a[''])
      expect(arena.field(second, '')).toBe(b[''])
      expect(arena.field(second, '')).toBe(b[''])
      expect(arena.field(first, 'value')).toBe(a.value)
      expect(arena.field(first, 'value')).toBe(a.value)
      expect(arena.field(second, 'value')).toBe(b.value)
    }
    expect(materialize(arena)).toEqual({
      first: { '': null, value: 'first' },
      second: { '': true, value: 'second' },
    })
  })

  it('preserves object-kind and own-field checks after successful repeated lookups', () => {
    const value = JSON.parse(
      '{"constructor":"own","__proto__":false,"scalar":1,"array":[],"object":{}}',
    )
    const arena = open(value)
    const refs = Object.fromEntries(arena.fields(arena.root))
    for (const key of ['constructor', '__proto__']) {
      expect(arena.field(arena.root, key)).toBe(refs[key])
      expect(arena.field(arena.root, key)).toBe(refs[key])
      for (const name of ['scalar', 'array']) {
        const reference = refs[name]
        if (reference === undefined) throw new Error('fixture')
        expect(() => arena.field(reference, key)).toThrow('not an object')
      }
      const empty = refs.object
      if (empty === undefined) throw new Error('fixture')
      expect(arena.field(empty, key)).toBeUndefined()
      expect(arena.field(arena.root, key)).toBe(refs[key])
    }
    expect(arena.field(arena.root, 'toString')).toBeUndefined()
    expect(materialize(arena)).toEqual(value)
  })

  it('reserves fixed query storage before indexing or consuming rejected synchronous input', () => {
    const payload = packValue({ value: 1 }, limits.bytes)
    const rejected = payload.slice(0)
    expect(() =>
      PackedArena.open(rejected, { ...limits, retained: payload.byteLength + 383 }),
    ).toThrow('retained limit')
    expect(rejected.byteLength).toBe(payload.byteLength)
    const admitted: number[] = []
    const work = PackedArena.openSteps(payload, limits, (retained) => admitted.push(retained))
    let step = work.next()
    while (!step.done) step = work.next()
    expect(admitted[0]).toBe(rejected.byteLength + 384)
    expect(step.value?.field(step.value.root, 'value')).toBeDefined()
  })

  it('isolates suspended streams from atomic reads, failed reads and other streams', () => {
    const text = '界😀\ud800\n\\"'.repeat(3000)
    const value = {
      text,
      items: [null, false, true, 0xffffffff, -1.25, 'short'],
      position: {
        start: { line: 1, column: 2, offset: 1 },
        end: { line: 3, column: 4, offset: 99 },
      },
    }
    const arena = open(value)
    const references = Object.fromEntries(arena.fields(arena.root))
    const textId = references.text
    const itemsId = references.items
    const positionId = references.position
    if (textId === undefined || itemsId === undefined || positionId === undefined)
      throw new Error('fixture')
    const itemIds = [...arena.elements(itemsId)]
    const fields = arena.fields(arena.root)
    const elements = arena.elements(itemsId)
    const streams = [
      arena.stringSteps(textId, arena.stringWorkspace(textId)),
      arena.stringSteps(textId, arena.stringWorkspace(textId)),
    ]
    const output = ['', '']
    const actualFields = []
    const actualElements = []
    let complete = false
    while (!complete) {
      complete = true
      for (const [index, stream] of streams.entries()) {
        const step = stream.next()
        if (!step.done) {
          complete = false
          output[index] += step.value ?? ''
        }
      }
      const field = fields.next()
      if (!field.done) actualFields.push(field.value)
      const element = elements.next()
      if (!element.done) actualElements.push(element.value)
      expect(arena.keys(arena.root)).toEqual(Object.keys(value))
      expect(arena.field(arena.root, 'items')).toBe(itemsId)
      expect(arena.field(arena.root, 'missing')).toBeUndefined()
      expect(arena.length(itemsId)).toBe(value.items.length)
      expect(arena.position(positionId)).toEqual(value.position)
      expect(arena.kind(textId)).toBe('scalar')
      expect(arena.scalarType(textId)).toBe('string')
      expect(arena.stringLength(textId)).toBe(text.length)
      expect(arena.cachedString(textId)).toBeUndefined()
      expect(arena.scalarCost(textId).retained).toBe(32 + text.length * 2)
      expect(arena.recordToken(itemsId)).toBe(arena.recordToken(textId))
      for (const [index, id] of itemIds.entries()) {
        expect(arena.element(itemsId, index)).toBe(id)
        expect(arena.scalar(id)).toBe(value.items[index])
      }
      for (const invalid of [-1, NaN, Infinity, 0.5, arena.records])
        expect(() => arena.kind(invalid)).toThrow('record ID')
      expect(() => arena.element(itemsId, value.items.length)).toThrow('array index')
      expect(() => arena.position(textId)).toThrow('not a position')
      expect(() => arena.field(textId, 'items')).toThrow('not an object')
    }
    expect(output).toEqual([text, text])
    expect(actualFields).toEqual(Object.entries(references))
    expect(actualElements).toEqual(itemIds)
    expect(materialize(arena)).toEqual(value)
  })

  it('keeps position summaries and complete encoding copies independent of atomic cursors', () => {
    const value = Array.from({ length: 700 }, (_, index) => ({
      text: `record ${index}`,
      position: {
        start: { line: 1, column: index + 1, offset: index },
        end: { line: 1, column: index + 2, offset: index + 1 },
      },
    }))
    const encoded = packValue(value, limits.bytes)
    const arena = PackedArena.open(encoded.slice(0), limits)
    const expected = arena.summarizePositions(() => {})
    const work = arena.summarizePositionSteps(() => {
      expect(arena.length(arena.root)).toBe(value.length)
    })
    let advances = 0
    while (true) {
      const step = work.next()
      if (step.done) {
        expect(step.value.at(arena.root)).toEqual(expected.at(arena.root))
        break
      }
      advances++
      expect(materialize(arena, arena.element(arena.root, advances % value.length))).toEqual(
        value[advances % value.length],
      )
    }
    expect(advances).toBeGreaterThan(1)
    const copy = new ArrayBuffer(encoded.byteLength)
    for (const _step of arena.copyEncoding(copy)) arena.kind(arena.root)
    expect(new Uint8Array(copy)).toEqual(new Uint8Array(encoded))
  })

  it('exposes bounded string chunks and exact UTF-16 lengths without retaining large scalar output', () => {
    const value = `${'x'.repeat(20000)}😀\ud800\n\\"`
    const arena = open([value, 'short', '', 1])
    const [large, short, empty, number] = [...arena.elements(arena.root)]
    if (large === undefined || short === undefined || empty === undefined || number === undefined)
      throw new Error('fixture')
    expect(arena.stringLength(large)).toBe(value.length)
    expect(arena.stringWorkspace(large)).toBeGreaterThan(0)
    expect([...arena.stringChunks(large, arena.stringWorkspace(large))].join('')).toBe(value)
    expect([...arena.stringChunks(short, 0)]).toEqual(['short'])
    expect([...arena.stringChunks(empty, 0)]).toEqual([])
    expect(arena.stringLength(empty)).toBe(0)
    expect(() => [...arena.stringChunks(large, arena.stringWorkspace(large) - 1)]).toThrow(
      'workspace',
    )
    for (const method of ['stringLength', 'stringWorkspace'] as const)
      expect(() => arena[method](number)).toThrow('not a string')
    expect(() => [...arena.stringChunks(number, 0)]).toThrow('not a string')
  })

  it('reads individual array references without expanding preceding values', () => {
    const value = [null, -0, { text: 'last' }]
    const arena = open(value)
    const ids = [...arena.elements(arena.root)]
    for (let index = 0; index < ids.length; index++)
      expect(arena.element(arena.root, index)).toBe(ids[index])
    for (const index of [-1, NaN, Infinity, 0.5, value.length])
      expect(() => arena.element(arena.root, index)).toThrow('array index')
    expect(() => arena.element(arena.records, 0)).toThrow('record ID')
    const scalar = ids[0]
    if (scalar === undefined) throw new Error('fixture')
    expect(() => arena.element(scalar, 0)).toThrow('not an array')
  })

  for (const example of examples)
    it(`exposes every field and position of CommonMark root ${example.example}`, () => {
      const root = parseMarkdown(example.markdown).root
      expect(materialize(open(root))).toEqual(root)
    })

  it.each([
    '---\ntitle: 世界\n---\n\n# 😀\n\n- [x] Task\n\n| A | B |\n| - | - |\n| **bold** | $x$ |\n',
    'Read [link][ref] and note[^one].\n\n[ref]: https://example.invalid/\n\n[^one]: Footnote body\n',
    '> > > nested **prose** with `code`.\n\n```mermaid\ngraph TD; A-->B\n```\n\n$$\nx^2\n$$\n',
    '\ufeff# heading\r\n\r\nraw \ud800 \udfff and 😀\r\n',
  ])('exposes complete extension and Unicode document values: %s', (source) => {
    const document = parseMarkdown(source)
    expect(materialize(open(document))).toEqual(document)
  })

  it('consumes successful input without exposing mutable bytes, indexes, keys or cached strings', () => {
    const payload = packValue({ text: 'original', items: [1, 'two'] }, limits.bytes)
    const view = new Uint8Array(payload)
    const bytes = payload.byteLength
    const arena = PackedArena.open(payload, limits)
    expect(payload.byteLength).toBe(0)
    expect(view.byteLength).toBe(0)
    expect(arena.bytes).toBe(bytes)
    expect(Object.isFrozen(arena)).toBe(true)
    expect(Object.isFrozen(arena.keys(arena.root))).toBe(true)
    expect(Reflect.ownKeys(arena).every((key) => typeof Reflect.get(arena, key) === 'number')).toBe(
      true,
    )
    expect(() => {
      ;(arena.keys(arena.root) as string[])[0] = 'changed'
    }).toThrow()
    expect(materialize(arena)).toEqual({ text: 'original', items: [1, 'two'] })
    expect(arena.field(arena.root, 'missing')).toBeUndefined()
    const reference = arena.field(arena.root, 'items')
    if (reference === undefined) throw new Error('Missing items')
    expect(arena.length(reference)).toBe(2)
    const first = arena.elements(reference)
    const second = arena.elements(reference)
    expect(first.next()).toEqual(second.next())
    expect(first.next()).toEqual(second.next())
  })

  it('keeps special object keys safe and preserves every finite scalar value', () => {
    const value = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":"safe","text":"\\ud800"}',
    )
    expect(materialize(open(value))).toEqual(value)
    expect(Reflect.get({}, 'polluted')).toBeUndefined()
    const values = [null, false, true, 0, -0, -1, 0.125, 0xffffffff, 0x100000000, '']
    expect(materialize(open(values))).toEqual(values)
  })

  it('reads a deep graph and an exponentially shared graph without expanding them', () => {
    let value: unknown = 'leaf'
    for (let index = 0; index < 20000; index++) value = { child: value }
    const arena = open(value)
    let reference = arena.root
    for (let index = 0; index < 20000; index++) {
      const next = arena.field(reference, 'child')
      if (next === undefined) throw new Error('Missing child')
      reference = next
    }
    expect(arena.scalar(reference)).toBe('leaf')
    let shared: unknown = 1
    for (let index = 0; index < 100; index++) shared = [shared, shared]
    const compact = open(shared)
    reference = compact.root
    for (let index = 0; index < 100; index++) {
      const refs = [...compact.elements(reference)]
      expect(refs).toHaveLength(2)
      expect(refs[0]).toBe(refs[1])
      const next = refs[0]
      if (next === undefined) throw new Error('Missing shared value')
      reference = next
    }
    expect(compact.scalar(reference)).toBe(1)
  })

  it('does not retain large decoded strings and rejects malformed uncached text before transfer', () => {
    const value = '界😀\ud800"\\\n'.repeat(4000)
    const input = packValue(value, limits.bytes)
    const arena = PackedArena.open(input, limits)
    expect(arena.retainedBytes - arena.bytes).toBeLessThan(4096)
    expect(arena.scalarCost(arena.root).retained).toBe(32 + value.length * 2)
    expect(arena.scalarCost(arena.root).workspace).toBeGreaterThan(value.length * 2)
    for (let index = 0; index < 10; index++) expect(arena.scalar(arena.root)).toBe(value)
    const malformed = new Uint8Array(packValue('x'.repeat(5000), limits.bytes))
    malformed[malformed.length - 2] = 120 // Replace the closing JSON quote.
    expect(() => PackedArena.open(malformed.buffer, limits)).toThrow('string')
    expect(malformed.byteLength).toBeGreaterThan(5000)
  })

  it('enforces exact storage and staging budgets before transferring ownership', () => {
    const encoded = packValue({ text: 'value', items: [1, 2, 3] }, limits.bytes)
    const measured = PackedArena.open(encoded.slice(0), limits)
    for (const [key, limit] of [
      ['bytes', encoded.byteLength - 1],
      ['retained', measured.retainedBytes - 1],
      ['staging', measured.stagingBytes - 1],
    ] as const) {
      const input = encoded.slice(0)
      expect(() => PackedArena.open(input, { ...limits, [key]: limit })).toThrow()
      expect(input.byteLength).toBe(encoded.byteLength)
    }
    const exact = PackedArena.open(encoded, {
      bytes: encoded.byteLength,
      retained: measured.retainedBytes,
      staging: measured.stagingBytes,
    })
    expect(materialize(exact)).toEqual({ text: 'value', items: [1, 2, 3] })
  })

  it('rejects invalid record IDs and operations of the wrong kind', () => {
    const arena = open({ array: [1], scalar: 'text' })
    for (const id of [-1, NaN, Infinity, 0.5, arena.records]) {
      for (const read of [
        () => arena.kind(id),
        () => arena.scalar(id),
        () => arena.keys(id),
        () => arena.field(id, 'a'),
        () => arena.position(id),
        () => arena.length(id),
        () => [...arena.elements(id)],
      ])
        expect(read).toThrow('record ID')
    }
    expect(() => arena.scalar(arena.root)).toThrow('scalar')
    expect(() => arena.position(arena.root)).toThrow('position')
    expect(() => arena.length(arena.root)).toThrow('array')
    expect(() => [...arena.elements(arena.root)]).toThrow('array')
    const id = arena.field(arena.root, 'scalar')
    if (id === undefined) throw new Error('Missing scalar')
    expect(() => arena.keys(id)).toThrow('object')
    expect(() => arena.field(id, 'a')).toThrow('object')
  })

  it('checks every byte before admission and leaves rejected buffers intact', () => {
    const encoded = new Uint8Array(packValue({ a: [1, '世界'] }, limits.bytes))
    for (let length = 0; length < encoded.length; length++) {
      const input = encoded.slice(0, length).buffer
      expect(() => PackedArena.open(input, limits)).toThrow()
      expect(input.byteLength).toBe(length)
    }
    const appended = new Uint8Array(encoded.length + 1)
    appended.set(encoded)
    expect(() => PackedArena.open(appended.buffer, limits)).toThrow('trailing')
  })

  it.each([
    [77, 83, 80, 51],
    [77, 83, 80, 50, 128, 0],
    [77, 83, 80, 50, 255, 255, 255, 255, 31],
    [77, 83, 80, 50, 0, 0, 1, 6, 1, 0, 0],
    [77, 83, 80, 50, 0, 0, 1, 8, 0],
    [77, 83, 80, 50, 0, 0, 1, 5, 1, 255, 0],
    [77, 83, 80, 50, 1, 2, 3, 34, 97, 34, 3, 34, 97, 34],
    [77, 83, 80, 50, 0, 1, 7, 0, 0, 0, 0, 0, 0, 0, 0],
    [77, 83, 80, 50, 0, 0, 1, 7, 1, 1, 0, 1, 1, 0, 0],
  ])('rejects malformed tables, strings, references and counts: %s', (...bytes) => {
    const input = new Uint8Array(bytes).buffer
    expect(() => PackedArena.open(input, limits)).toThrow()
    expect(input.byteLength).toBe(bytes.length)
  })

  it.each([NaN, -1, Infinity, 0.5])('rejects invalid budgets: %s', (budget) => {
    const input = packValue(1, limits.bytes)
    for (const key of ['bytes', 'retained', 'staging'])
      expect(() => PackedArena.open(input, { ...limits, [key]: budget })).toThrow('limits')
  })
})
