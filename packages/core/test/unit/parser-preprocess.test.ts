import { readFile } from 'node:fs/promises'
import type { Chunk, Encoding, Value } from 'micromark-util-types'
import { beforeAll, describe, expect, it, vi } from 'vitest'

type Scanner = (value: Value, encoding?: Encoding) => Generator<undefined, Chunk[]>
type Preprocessor = (value: Value, encoding: Encoding | undefined, end: boolean) => Chunk[]

const boundaryCases = [4095, 4096, 4097, 8191, 8192, 8193].map((offset) => ({
  name: `special characters after ${offset} units`,
  value: `\ufeff${'x'.repeat(offset - 1)}\r\n\t\0🙂\ud800\n\r[r]: /late\n[^n]: footnote\r`,
}))
const cases: { name: string; value: Value; encoding?: Encoding }[] = [
  { name: 'empty', value: '' },
  { name: 'only BOM', value: '\ufeff' },
  { name: 'trailing CR', value: 'one\r\ntwo\rthree\r' },
  { name: 'long literal', value: 'x'.repeat(20000) },
  { name: 'dense markers', value: '\t\0\r\n\r\t'.repeat(4000) },
  { name: 'mixed Unicode and line endings', value: '🙂\ud800\udfff\t中\r\n\0é\r'.repeat(2000) },
  ...boundaryCases,
  { name: 'UTF-8 bytes', value: new TextEncoder().encode('\ufeff中🙂\t\0\r\n'.repeat(1200)) },
  {
    name: 'UTF-16 bytes',
    value: Buffer.from('\ufeff中🙂\t\0\r\n'.repeat(1200), 'utf16le'),
    encoding: 'utf-16le',
  },
  {
    name: 'byte view',
    value: Uint8Array.of(100, 239, 187, 191, 65, 13, 10, 0, 9, 100).subarray(1, 9),
  },
  { name: 'invalid UTF-8', value: Uint8Array.of(240, 159, 13, 10, 255, 0, 9) },
]

function finish(iterator: ReturnType<Scanner>) {
  while (true) {
    const step = iterator.next()
    if (step.done) return step.value
    expect(step.value).toBeUndefined()
  }
}

for (const development of [false, true])
  describe(`private preprocessing with ${development ? 'development' : 'production'} parser`, () => {
    let scan: Scanner
    let original: () => Preprocessor
    beforeAll(async () => {
      const prefix = development ? 'dev/' : ''
      const url = new URL(
        `../../../../node_modules/mdast-util-from-markdown/${prefix}lib/index.js`,
        import.meta.url,
      )
      const source = await readFile(url, 'utf8')
      const marker = '\n// Manuslip cooperative preprocessing.\n'
      const from = source.indexOf(marker)
      expect(from).toBeGreaterThan(0)
      // Execute the installed private helper itself, without adding a production export.
      const module = `${source.slice(from)}\nexport { preprocessSteps }\n`
      const privateUrl = `data:text/javascript;base64,${Buffer.from(module).toString('base64')}`
      scan = (await import(privateUrl)).preprocessSteps
      const publicUrl = new URL(
        `../../../../node_modules/micromark/${prefix}lib/preprocess.js`,
        import.meta.url,
      )
      original = (await import(publicUrl.href)).preprocess
    })

    it.each(cases)(
      'preserves the original complete chunk sequence: $name',
      ({ value, encoding }) => {
        expect(finish(scan(value, encoding))).toEqual(original()(value, encoding, true))
      },
    )

    it.each(['x'.repeat(20000), `\ufeff${'\t\0\r\nz'.repeat(4000)}`])(
      'scans at most 4096 distinct source units per advance',
      (value) => {
        const expected = original()(value, undefined, true)
        const charCodeAt = String.prototype.charCodeAt
        const visited = new Set<number>()
        let current = new Set<number>()
        const spy = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (
          this: string,
          index: number,
        ) {
          if (this === value && index < value.length) {
            current.add(index)
            visited.add(index)
          }
          return charCodeAt.call(this, index)
        })
        const iterator = scan(value)
        let pauses = 0
        try {
          while (true) {
            current = new Set()
            const step = iterator.next()
            expect(current.size).toBeLessThanOrEqual(4096)
            if (step.done) {
              expect(step.value).toEqual(expected)
              break
            }
            expect(step.value).toBeUndefined()
            pauses++
          }
          expect(pauses).toBeGreaterThan(1)
          expect(visited.size).toBe(value.length)
        } finally {
          iterator.return([])
          spy.mockRestore()
        }
      },
    )

    it('keeps suspended scanners independent', () => {
      const left = 'left\t\r\n\0'.repeat(2000)
      const right = `\ufeff${'right🙂'.repeat(4000)}\r`
      const a = scan(left),
        b = scan(right)
      expect(a.next()).toEqual({ done: false, value: undefined })
      expect(b.next()).toEqual({ done: false, value: undefined })
      expect(a.next()).toEqual({ done: false, value: undefined })
      expect(finish(b)).toEqual(original()(right, undefined, true))
      expect(finish(a)).toEqual(original()(left, undefined, true))
    })

    it('stops the scanner permanently when cancelled at a checkpoint', () => {
      const iterator = scan('z'.repeat(20000))
      expect(iterator.next()).toEqual({ done: false, value: undefined })
      expect(iterator.return([])).toEqual({ done: true, value: [] })
      expect(iterator.next()).toEqual({ done: true, value: undefined })
    })
  })
