import { expect, it } from 'vitest'
import { packValueSteps, unpackValue } from '../../src/packing'
import { PackedReader, PackedWriter } from '../../src/packing-bytes'
import { finishPackedSteps } from '../../src/packing-work'

const bytes = 8 * 1024 * 1024

it.each([4094, 4095, 4096, 4097])(
  'matches native JSON string bytes across the surrogate boundary %s',
  (prefix) => {
    const value = `${'a'.repeat(prefix)}😀界\ud800x\udfff\n\r\t\b\f"\\${'z'.repeat(13000)}`
    const writer = new PackedWriter(bytes)
    const steps = writer.stringSteps(value)
    let advances = 0
    while (!steps.next().done) advances++
    expect(advances).toBeGreaterThan(4)
    const output = writer.finish()
    const reader = new PackedReader(output)
    const size = reader.uint()
    const native = new TextEncoder().encode(JSON.stringify(value))
    expect(size).toBe(native.length)
    expect(new Uint8Array(output).slice(reader.position)).toEqual(native)
    expect(new PackedReader(output).string()).toBe(value)
  },
)

it('preserves all UTF-16 code units and the complete semantic graph through cooperative encoding', () => {
  const text = Array.from({ length: 65536 }, (_, unit) => String.fromCharCode(unit)).join('')
  const input = {
    text,
    children: Array.from({ length: 5000 }, (_, index) => ({ index, text: 'same' })),
  }
  const work = packValueSteps(input, bytes)
  let advances = 0
  let step = work.next()
  while (!step.done) {
    advances++
    step = work.next()
  }
  expect(advances).toBeGreaterThan(100)
  if (!step.value) throw new Error('Missing encoded graph')
  const result = unpackValue(step.value, { bytes, retained: 32 * 1024 * 1024, staging: bytes })
  expect(result.value).toEqual(input)
  expect(work.next()).toEqual({ done: true, value: undefined })
})

it.each([0, 1, 40, 200])('cancels without publishing partial output after %s advances', (count) => {
  const input = {
    text: '界😀\n'.repeat(100000),
    children: Array.from({ length: 5000 }, (_, index) => index),
  }
  const work = packValueSteps(input, bytes)
  for (let index = 0; index < count; index++) expect(work.next().done).toBe(false)
  expect(work.return()).toEqual({ done: true, value: undefined })
  expect(work.next()).toEqual({ done: true, value: undefined })
  expect(finishPackedSteps(work)).toBeUndefined()
})

it('enforces the actual string byte cap during cooperative preparation', () => {
  expect(() => finishPackedSteps(packValueSteps('界'.repeat(10000), 10000))).toThrow('byte limit')
})
