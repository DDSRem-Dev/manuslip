import { describe, expect, it, vi } from 'vitest'
import { type SemanticDocument, sourceHash } from '../../src/contracts'
import { packValue } from '../../src/packing'
import { PackedArena } from '../../src/packing-arena'
import { packedDocumentWordsSteps } from '../../src/packing-document-words'
import { PackedReceiver } from '../../src/packing-receiver'
import { PackedSession } from '../../src/packing-session'
import { PackedSource } from '../../src/packing-source'
import { packedTextStepCost } from '../../src/packing-text-stream'
import { newPackedToken } from '../../src/packing-token'
import { validatePackedDocument } from '../../src/packing-validate-document'
import { type PackedWordPhase, validatePackedWords } from '../../src/packing-validate-words'
import { packedWireVersion } from '../../src/packing-wire'
import { PackedWordBuffer } from '../../src/packing-word-buffer'
import { finishPackedSteps } from '../../src/packing-work'
import { parseMarkdown } from '../../src/parse'
import examples from '../fixtures/commonmark-0.31.2/spec.json'

const MiB = 1024 * 1024
const limits = { bytes: 8 * MiB, retained: 64 * MiB, staging: 8 * MiB, captures: 8, readers: 160 }
const validation = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const phases: PackedWordPhase[] = ['scan', 'read', 'join', 'segment', 'count']
function source(text: string, document: SemanticDocument, revision = 1) {
  return new PackedSource(
    {
      generation: 1,
      documentId: 'word-validation',
      revision,
      sourceHash: sourceHash(text),
      parserVersion: document.parserVersion,
      rendererVersion: 'test',
      options: 'test',
    },
    text,
  )
}
function fixture(text: string, document = parseMarkdown(text), staging = limits.staging) {
  const checked = source(text, document)
  const owner = new PackedSession({ ...limits, staging })
  owner.commit(
    owner.prepareFull(
      owner.beginPrepared(checked),
      checked.identity,
      packValue({ document }, limits.bytes),
    ),
  )
  const capture = owner.capture()
  return { owner, capture, checked }
}
function validate(text: string, document = parseMarkdown(text)) {
  const context = fixture(text, document)
  try {
    finishPackedSteps(
      validatePackedDocument(context.capture, context.checked, ['document'], validation),
    )
    expect(context.owner.stats.readers).toBe(0)
    expect(context.owner.stats.readerStagingBytes).toBe(0)
  } finally {
    context.owner.dispose()
  }
  expect(context.owner.stats.retainedBytes).toBe(0)
}

describe('exact packed document word counts', () => {
  it.each([
    { name: 'cancel with Error', primary: false, original: undefined, cleanup: new Error('close') },
    { name: 'cancel with undefined', primary: false, original: undefined, cleanup: undefined },
    { name: 'observer Error', primary: true, original: new Error('observer'), cleanup: undefined },
    { name: 'observer undefined', primary: true, original: undefined, cleanup: new Error('close') },
  ])(
    'finishes fused document cleanup after a cleanup failure: $name',
    ({ primary, original, cleanup }) => {
      const context = fixture('first paragraph\n')
      const before = context.owner.stats
      let paused = false
      const work = context.capture.work(
        packedDocumentWordsSteps(
          context.capture,
          context.checked,
          ['document'],
          validation,
          function* (_node, type) {
            if (type !== 'text') return
            paused = true
            yield
            if (primary) throw original
          },
        ),
      )
      let closing: ReturnType<typeof vi.spyOn> | undefined
      try {
        while (!paused) expect(work.next().done).toBe(false)
        const close = PackedWordBuffer.prototype.close
        const closed = new Set<PackedWordBuffer>()
        closing = vi.spyOn(PackedWordBuffer.prototype, 'close').mockImplementation(function (
          this: PackedWordBuffer,
        ) {
          expect(closed.has(this)).toBe(false)
          closed.add(this)
          close.call(this)
          throw cleanup
        })
        let threw = false
        let failure: unknown
        try {
          if (primary) work.next()
          else work.return()
        } catch (error) {
          threw = true
          failure = error
        }
        expect(threw).toBe(true)
        expect(failure).toBe(primary ? original : cleanup)
        expect(closed.size).toBe(1)
        expect(context.owner.stats).toEqual(before)
        expect(work.next()).toEqual({ done: true, value: undefined })
        expect(work.return()).toEqual({ done: true, value: undefined })
      } finally {
        closing?.mockRestore()
        work.return()
        context.owner.dispose()
      }
    },
  )

  it.each([
    { name: 'cancel with Error', primary: false, original: undefined, cleanup: new Error('close') },
    { name: 'cancel with undefined', primary: false, original: undefined, cleanup: undefined },
    { name: 'observer Error', primary: true, original: new Error('phase'), cleanup: undefined },
    { name: 'observer undefined', primary: true, original: undefined, cleanup: new Error('close') },
  ])('finishes word cleanup after a cleanup failure: $name', ({ primary, original, cleanup }) => {
    const context = fixture('first paragraph\n')
    const before = context.owner.stats
    let phase: PackedWordPhase | undefined
    const work = validatePackedWords(
      context.capture,
      context.checked,
      ['document'],
      validation,
      (value) => {
        phase = value
        if (value === 'join' && primary) throw original
      },
    )
    let closing: ReturnType<typeof vi.spyOn> | undefined
    try {
      while (phase !== 'read') expect(work.next().done).toBe(false)
      const close = PackedWordBuffer.prototype.close
      const closed = new Set<PackedWordBuffer>()
      closing = vi.spyOn(PackedWordBuffer.prototype, 'close').mockImplementation(function (
        this: PackedWordBuffer,
      ) {
        expect(closed.has(this)).toBe(false)
        closed.add(this)
        close.call(this)
        throw cleanup
      })
      let threw = false
      let failure: unknown
      try {
        if (primary) while (!work.next().done) {}
        else work.return()
      } catch (error) {
        threw = true
        failure = error
      }
      expect(threw).toBe(true)
      expect(failure).toBe(primary ? original : cleanup)
      expect(closed.size).toBe(1)
      expect(context.owner.stats).toEqual(before)
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(work.return()).toEqual({ done: true, value: undefined })
    } finally {
      closing?.mockRestore()
      work.return()
      context.owner.dispose()
    }
  })

  it.each(['local', 'session'] as const)(
    'retries separate phases after partial document collection exceeds %s workspace',
    (budget) => {
      const text = `one\n\n${'word '.repeat(5000)}\n`
      const context = fixture(
        text,
        parseMarkdown(text),
        budget === 'session' ? 850 * 1024 : limits.staging,
      )
      const before = context.owner.stats
      const append = vi.spyOn(PackedWordBuffer.prototype, 'append')
      const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
      try {
        finishPackedSteps(
          validatePackedDocument(context.capture, context.checked, ['document'], {
            ...validation,
            staging: budget === 'local' ? 850 * 1024 : validation.staging,
          }),
        )
        // The abandoned prefix must be discarded; the complete second pass counts once.
        expect(append.mock.calls.filter(([value]) => value === 'one')).toHaveLength(2)
        expect(segment).toHaveBeenCalledOnce()
        expect(context.owner.stats).toEqual(before)
      } finally {
        append.mockRestore()
        segment.mockRestore()
        context.owner.dispose()
      }
    },
  )
  it.each(['return', 'release', 'dispose'] as const)(
    'revokes partially collected document prose during %s',
    (action) => {
      const context = fixture(`one\n\n${'word '.repeat(2000)}\n`)
      const before = context.owner.stats
      const append = vi.spyOn(PackedWordBuffer.prototype, 'append')
      const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
      const work = validatePackedDocument(
        context.capture,
        context.checked,
        ['document'],
        validation,
      )
      try {
        while (!append.mock.calls.length) expect(work.next().done).toBe(false)
        expect(context.owner.stats.readerStagingBytes).toBeGreaterThan(0)
        if (action === 'return') work.return()
        else if (action === 'release') context.capture.release()
        else context.owner.dispose()
        expect(work.next()).toEqual({ done: true, value: undefined })
        expect(segment).not.toHaveBeenCalled()
        expect(context.owner.stats.readers).toBe(0)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
        if (action === 'return') expect(context.owner.stats).toEqual(before)
      } finally {
        work.return()
        append.mockRestore()
        segment.mockRestore()
        context.owner.dispose()
      }
      expect(context.owner.stats.retainedBytes).toBe(0)
    },
  )
  it('rejects a later descriptor after collecting text without entering Intl', () => {
    const text = 'one\n\ntwo\n'
    const document = parseMarkdown(text)
    const last = document.blocks.at(-1)
    if (!last) throw new Error('Missing descriptor')
    last.hash = 'invalid'
    const context = fixture(text, document)
    const before = context.owner.stats
    const append = vi.spyOn(PackedWordBuffer.prototype, 'append')
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
    try {
      expect(() =>
        finishPackedSteps(
          validatePackedDocument(context.capture, context.checked, ['document'], validation),
        ),
      ).toThrow('Invalid packed semantic')
      expect(append.mock.calls.map(([value]) => value)).toEqual(['one'])
      expect(segment).not.toHaveBeenCalled()
      expect(context.owner.stats).toEqual(before)
    } finally {
      append.mockRestore()
      segment.mockRestore()
      context.owner.dispose()
    }
  })
  it('rejects growing prose before copying a rejected leaf and can retry after cleanup', () => {
    const context = fixture(`**one** ${'word '.repeat(2000)}\n`)
    const before = context.owner.stats
    const append = vi.spyOn(PackedWordBuffer.prototype, 'append')
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
    try {
      expect(() =>
        finishPackedSteps(
          validatePackedWords(context.capture, context.checked, ['document'], {
            ...validation,
            staging: PackedWordBuffer.bytes(3, 1, validation.depth) + packedTextStepCost.workspace,
          }),
        ),
      ).toThrow('Packed words exceed workspace limit')
      expect(append.mock.calls.map(([value]) => value)).toEqual(['one'])
      expect(segment).not.toHaveBeenCalled()
      expect(context.owner.stats).toEqual(before)
      finishPackedSteps(
        validatePackedWords(context.capture, context.checked, ['document'], validation),
      )
      expect(segment).toHaveBeenCalledOnce()
      expect(context.owner.stats).toEqual(before)
    } finally {
      append.mockRestore()
      segment.mockRestore()
      context.owner.dispose()
    }
  })
  it.each(['nodes', 'depth'] as const)(
    'releases partially collected prose when a later node exceeds %s',
    (key) => {
      const context = fixture('one\n\n> two\n')
      const before = context.owner.stats
      const append = vi.spyOn(PackedWordBuffer.prototype, 'append')
      const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
      try {
        expect(() =>
          finishPackedSteps(
            validatePackedWords(context.capture, context.checked, ['document'], {
              ...validation,
              [key]: key === 'nodes' ? 4 : 3,
            }),
          ),
        ).toThrow('Packed word traversal limit')
        expect(append.mock.calls.map(([value]) => value)).toEqual(['one'])
        expect(segment).not.toHaveBeenCalled()
        expect(context.owner.stats).toEqual(before)
      } finally {
        append.mockRestore()
        segment.mockRestore()
        context.owner.dispose()
      }
    },
  )
  it('borrows short arena text under full prose admission without opening decoders', () => {
    const context = fixture('**ภาษา**ไทย [中文](url)没有*空格*\n\n界😀\ud800\n')
    const before = context.owner.stats
    const decode = vi.spyOn(PackedArena.prototype, 'stringSteps')
    let peak = 0
    const work = validatePackedWords(context.capture, context.checked, ['document'], validation)
    try {
      while (!work.next().done) peak = Math.max(peak, context.owner.stats.readerStagingBytes)
      expect(decode).not.toHaveBeenCalled()
      expect(peak).toBeGreaterThan(0)
      expect(context.owner.stats).toEqual(before)
    } finally {
      work.return()
      decode.mockRestore()
      context.owner.dispose()
    }
  })
  it('streams an edited short text value and preserves the original captured word count', () => {
    const text = 'old two\n'
    const context = fixture(text)
    const after = 'newword\n'
    const fresh = parseMarkdown(after)
    const checked = source(after, fresh, 2)
    const valuePath = ['document', 'root', 'children', 0, 'children', 0, 'value']
    const payload = packValue(
      { value: 'newword', hash: fresh.sourceHash, blocks: fresh.blocks, words: fresh.counts.words },
      limits.bytes,
    )
    const arena = PackedArena.open(payload.slice(0), limits)
    const field = (name: string) => {
      const record = arena.field(arena.root, name)
      if (record === undefined) throw new Error('Missing fixture record')
      return record
    }
    context.owner.commit(
      context.owner.prepareDelta(context.owner.beginPrepared(checked), {
        base: context.checked.identity,
        baseSource: text,
        result: checked.identity,
        payload,
        operations: [
          { kind: 'text', path: valuePath, start: 0, remove: 7, record: field('value') },
          { kind: 'replace', path: ['document', 'sourceHash'], record: field('hash') },
          { kind: 'replace', path: ['document', 'blocks'], record: field('blocks') },
          { kind: 'replace', path: ['document', 'counts', 'words'], record: field('words') },
        ],
      }),
    )
    const capture = context.owner.capture()
    const before = context.owner.stats
    const decode = vi.spyOn(PackedArena.prototype, 'stringSteps')
    try {
      expect(capture.reader.cachedText(valuePath)).toBeUndefined()
      finishPackedSteps(validatePackedDocument(capture, checked, ['document'], validation))
      expect(decode).toHaveBeenCalled()
      expect(capture.reader.scalar(['document', 'counts', 'words'], validation)).toBe(1)
      expect(context.capture.reader.cachedText(valuePath)).toBe('old two')
      expect(context.capture.reader.scalar(['document', 'counts', 'words'], validation)).toBe(2)
      expect(context.owner.stats).toEqual(before)
    } finally {
      decode.mockRestore()
      context.owner.dispose()
    }
  })
  it.each(['commonmark', 'manuslip'] as const)(
    'validates every pinned CommonMark document including exact counts in %s',
    (syntax) => {
      for (const example of examples)
        validate(example.markdown, parseMarkdown(example.markdown, syntax))
    },
  )
  it.each([
    '',
    '\ufeff',
    '\ufeff# 😀\r\n\r\nparagraph\r\n',
    '# **one** `code` $x$ ![image words](url) [link](url) <i>HTML</i> &amp; ~~end~~\n',
    '## user@e.co and www.example.com?\n',
    'ภาษาไทยภาษาไทย ພາສາລາວ ភាសាខ្មែរ 中文没有空格 日本語の文章 한국어 문장\n',
    'العربية بالعربية עברית हिन्दी संस्कृतम्\n',
    'a\u0301 a\u200db 👩🏽‍💻 🏳️‍🌈 🇸🇬🇨🇳 1,234.5 don’t word-word\n',
    '**ภาษา**ไทย [中文](url)没有*空格*\n',
    '---\ntitle: omitted words\n---\n\n$$\nomitted math\n$$\n\n[^a]: note words\n\nText[^a]\n',
    '- [x] task one\n- [ ] task two\n\n| A | B |\n| - | - |\n| one | two |\n',
    '# a\ud800\ud800\udfff\udfff😀b\n\nsecond\r\nline\n',
    `# ${'界'.repeat(5000)}\n`,
    `${'a'.repeat(20000)} ${'!'.repeat(10000)}\n`,
  ])('matches parser counts for %j', (text) => validate(text))

  it('rejects a plausible in-range word count that the shape validator accepts', () => {
    const text = '# Heading\n\nfirst paragraph\n'
    const document = parseMarkdown(text)
    document.counts.words++
    expect(document.counts.words).toBeLessThan(text.length)
    expect(() => validate(text, document)).toThrow('Invalid packed semantic document')
  })
  it.each(['words', 'characters'] as const)(
    'combined validation rejects an incorrect %s count',
    (key) => {
      const text = 'one two\n'
      const document = parseMarkdown(text)
      document.counts[key]--
      expect(() => validate(text, document)).toThrow('Invalid packed semantic document')
    },
  )
  it('uses one whole-string Intl call with parser preorder and spaces, including empty leaves', () => {
    const text = 'available source capacity for synthetic leaves'
    const values = ['ภาษา', '', 'ไทย', '中文', '没有', 'a\u0301', '👩🏽‍💻']
    const document = parseMarkdown(text)
    document.root = {
      type: 'root',
      children: [{ type: 'paragraph', children: values.map((value) => ({ type: 'text', value })) }],
    }
    const prose = values.join(' ')
    document.counts.words = [
      ...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(prose),
    ].filter((segment) => segment.isWordLike).length
    const context = fixture(text, document)
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
    try {
      finishPackedSteps(
        validatePackedWords(context.capture, context.checked, ['document'], validation),
      )
      expect(segment).toHaveBeenCalledExactlyOnceWith(prose)
    } finally {
      segment.mockRestore()
      context.owner.dispose()
    }
  })
  it('decodes long text in bounded chunks while charging its complete prose workspace', () => {
    const context = fixture(`${'word '.repeat(20000)}\n`)
    const before = context.owner.stats
    const scalar = vi.spyOn(PackedArena.prototype, 'scalar')
    const original = PackedArena.prototype.stringSteps
    let chunks = 0
    const decode = vi.spyOn(PackedArena.prototype, 'stringSteps').mockImplementation(function* (
      this: PackedArena,
      ...args
    ) {
      for (const chunk of original.apply(this, args)) {
        if (chunk !== undefined) {
          chunks++
          expect(chunk.length).toBeLessThanOrEqual(4098)
        }
        yield chunk
      }
    })
    const work = validatePackedWords(context.capture, context.checked, ['document'], validation)
    let peak = 0
    try {
      while (!work.next().done) {
        peak = Math.max(peak, context.owner.stats.readerStagingBytes)
        expect(context.owner.stats.readerStagingBytes).toBeLessThanOrEqual(validation.staging)
      }
      expect(chunks).toBeGreaterThan(1)
      expect(peak).toBeGreaterThan(100000 * 6)
      expect(context.owner.stats).toEqual(before)
      for (const result of scalar.mock.results)
        if (result.type === 'return' && typeof result.value === 'string')
          expect(result.value.length).toBeLessThan(4096)
    } finally {
      scalar.mockRestore()
      decode.mockRestore()
      context.owner.dispose()
    }
  })
  it.each(['complete', 'cancel'] as const)(
    'bounds native segment iteration between scheduler advances during %s',
    (action) => {
      const context = fixture(`${'ภาษาไทย 中文 word-word '.repeat(1000)}\n`)
      const before = context.owner.stats
      const original = Intl.Segmenter.prototype.segment
      let reads = 0
      const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment').mockImplementation(function (
        this: Intl.Segmenter,
        input,
      ) {
        const result = original.call(this, input)
        const iterator = result[Symbol.iterator]()
        Object.defineProperty(result, Symbol.iterator, {
          value: () => ({
            next() {
              reads++
              return iterator.next()
            },
            [Symbol.iterator]() {
              return this
            },
          }),
        })
        return result
      })
      const work = validatePackedWords(context.capture, context.checked, ['document'], validation)
      let batches = 0
      try {
        while (true) {
          const at = reads
          const next = work.next()
          expect(reads - at).toBeLessThanOrEqual(16)
          if (reads - at === 16) {
            batches++
            if (action === 'cancel') {
              work.return()
              break
            }
          }
          if (next.done) break
        }
        expect(batches).toBeGreaterThan(0)
        expect(work.next().done).toBe(true)
        expect(context.owner.stats).toEqual(before)
      } finally {
        work.return()
        segment.mockRestore()
        context.owner.dispose()
      }
    },
  )
  it.each(['retained', 'staging', 'nodes', 'depth'] as const)(
    'rejects an insufficient %s budget without entering Intl and releases its scopes',
    (key) => {
      const context = fixture('**one** two\n')
      const before = context.owner.stats
      const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
      try {
        expect(() =>
          finishPackedSteps(
            validatePackedWords(context.capture, context.checked, ['document'], {
              ...validation,
              [key]: 1,
            }),
          ),
        ).toThrow()
        expect(segment).not.toHaveBeenCalled()
        expect(context.owner.stats).toEqual(before)
      } finally {
        segment.mockRestore()
        context.owner.dispose()
      }
    },
  )
  it('admits the complete prose before decoding and retries after releasing a competing validator', () => {
    const context = fixture(`${'x '.repeat(40000)}\n`, undefined, MiB)
    const before = context.owner.stats
    let phase: PackedWordPhase | undefined
    const first = validatePackedWords(
      context.capture,
      context.checked,
      ['document'],
      validation,
      (value) => {
        phase = value
      },
    )
    try {
      while (phase !== 'read') expect(first.next().done).toBe(false)
      const occupied = context.owner.stats
      expect(occupied.readerStagingBytes).toBeGreaterThan(MiB / 2)
      expect(() =>
        finishPackedSteps(
          validatePackedWords(context.capture, context.checked, ['document'], validation),
        ),
      ).toThrow(/staging|workspace/)
      expect(context.owner.stats).toEqual(occupied)
      first.return()
      expect(context.owner.stats).toEqual(before)
      finishPackedSteps(
        validatePackedWords(context.capture, context.checked, ['document'], validation),
      )
      expect(context.owner.stats).toEqual(before)
    } finally {
      context.owner.dispose()
    }
  })
  it('copies the document path and budget before suspension', () => {
    const context = fixture('one two\n')
    const path = ['document']
    const budget = { ...validation }
    const work = validatePackedDocument(context.capture, context.checked, path, budget)
    path[0] = 'missing'
    budget.nodes = 0
    try {
      finishPackedSteps(work)
    } finally {
      context.owner.dispose()
    }
  })
  it.each(['complete', 'cancel'] as const)(
    'counts lazy text pieces and forwards discarded array prefixes during %s',
    (action) => {
      const text = `${'ภาษาไทย 中文 a\u0301 👩🏽‍💻 '.repeat(2000)}\n\n${'# Heading\n\n'.repeat(3000)}`
      const document = parseMarkdown(text)
      const context = fixture(text, document)
      const rootChildren = ['document', 'root', 'children']
      const valuePath = [...rootChildren, 0, 'children', 0, 'value']
      const length = context.capture.reader.textLength(valuePath)
      const payload = packValue({ empty: [], text: '' }, limits.bytes)
      const arena = PackedArena.open(payload.slice(0), limits)
      const empty = arena.field(arena.root, 'empty')
      const inserted = arena.field(arena.root, 'text')
      if (empty === undefined || inserted === undefined) throw new Error('Missing fixture records')
      const checked = source(text, document, 2)
      context.owner.commit(
        context.owner.prepareDelta(context.owner.beginPrepared(checked), {
          base: context.checked.identity,
          baseSource: text,
          result: checked.identity,
          payload,
          operations: [
            { kind: 'text', path: valuePath, start: length - 1000, remove: 0, record: inserted },
            { kind: 'splice', path: rootChildren, start: 2500, remove: 0, record: empty },
          ],
        }),
      )
      const capture = context.owner.capture()
      let reads = 0
      const elements = PackedArena.prototype.elements
      const spy = vi.spyOn(PackedArena.prototype, 'elements').mockImplementation(function* (
        this: PackedArena,
        id: number,
      ) {
        for (const value of elements.call(this, id)) {
          reads++
          yield value
        }
      })
      const work = validatePackedWords(capture, checked, ['document'], validation)
      let progress = 0
      try {
        while (true) {
          const before = reads
          const step = work.next()
          expect(reads - before).toBeLessThanOrEqual(256)
          if (step.done) break
          if (reads - before === 256) {
            progress++
            if (action === 'cancel') {
              capture.release()
              break
            }
          }
        }
        expect(progress).toBeGreaterThan(0)
        expect(work.next().done).toBe(true)
        expect(context.owner.stats.readers).toBe(0)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
        expect(context.capture.reader.textLength(valuePath)).toBe(length)
        expect(context.capture.reader.scalar(['document', 'counts', 'words'], validation)).toBe(
          document.counts.words,
        )
      } finally {
        work.return()
        spy.mockRestore()
        context.owner.dispose()
      }
    },
  )
  it.each(['source', 'document'] as const)('rejects a mismatching %s identity', (kind) => {
    const text = 'one two\n'
    const document = parseMarkdown(text)
    if (kind === 'document') document.sourceHash = 'bad'
    const context = fixture(text, document)
    try {
      const checked = kind === 'source' ? source(text, document) : context.checked
      expect(() =>
        finishPackedSteps(validatePackedWords(context.capture, checked, ['document'], validation)),
      ).toThrow('Invalid packed semantic document')
    } finally {
      context.owner.dispose()
    }
  })
})

describe('packed word validation ownership', () => {
  const cancellation = ['unstarted', ...phases].flatMap((phase) =>
    (['return', 'release', 'dispose'] as const).map((action) => ({ phase, action })),
  )
  it.each(cancellation)(
    'closes $phase work on $action without advancing the escaped handle',
    ({ phase, action }) => {
      const context = fixture(`${'word '.repeat(2000)}\n`)
      const before = context.owner.stats
      let current: PackedWordPhase | undefined
      const work = validatePackedWords(
        context.capture,
        context.checked,
        ['document'],
        validation,
        (value) => {
          current = value
        },
      )
      try {
        if (phase !== 'unstarted') while (current !== phase) expect(work.next().done).toBe(false)
        if (action === 'return') work.return()
        else if (action === 'release') context.capture.release()
        else context.owner.dispose()
        expect(context.owner.stats.readers).toBe(0)
        expect(context.owner.stats.readerStagingBytes).toBe(0)
        if (action === 'return') expect(context.owner.stats).toEqual(before)
        expect(work.next()).toEqual({ done: true, value: undefined })
      } finally {
        context.owner.dispose()
      }
      expect(context.owner.stats.retainedBytes).toBe(0)
    },
  )
  it.each(phases)('unwinds reentrant capture release during %s', (phase) => {
    const context = fixture('one **two** three\n')
    const work = validatePackedWords(
      context.capture,
      context.checked,
      ['document'],
      validation,
      (value) => {
        if (value === phase) context.capture.release()
      },
    )
    try {
      expect(() => finishPackedSteps(work)).toThrow('released')
      expect(context.owner.stats.readers).toBe(0)
      expect(context.owner.stats.readerStagingBytes).toBe(0)
      expect(work.next().done).toBe(true)
    } finally {
      context.owner.dispose()
    }
  })
  it('keeps the old receiver revision and sends no acknowledgement for an incorrect exact total', () => {
    let current: PackedWordPhase | undefined
    const receiver = new PackedReceiver(limits, (capture, checked) =>
      validatePackedDocument(capture, checked, ['document'], validation, (phase) => {
        current = phase
      }),
    )
    const text = 'one two\n'
    const document = parseMarkdown(text)
    const original = source(text, document)
    const packet = (ticket: ReturnType<PackedReceiver['begin']>, doc: SemanticDocument) => ({
      protocol: packedWireVersion,
      kind: 'full',
      sequence: ticket.sequence,
      result: ticket.identity,
      requestToken: ticket.requestToken,
      resultToken: newPackedToken(),
      sentAt: 0,
      payload: packValue({ document: doc }, limits.bytes),
      metadata: { cached: false, transportInMs: 0, serializeMs: 0 },
    })
    try {
      const initialTicket = receiver.begin(1, original)
      const initial = finishPackedSteps(
        receiver.receiveSteps(initialTicket, packet(initialTicket, document)),
      )
      if (initial?.kind !== 'accepted') throw new Error('Missing accepted fixture')
      const updatedText = 'one two three\n'
      const wrong = parseMarkdown(updatedText)
      wrong.counts.words--
      const checked = source(updatedText, wrong, 2)
      const ticket = receiver.begin(2, checked)
      const work = receiver.receiveSteps(ticket, packet(ticket, wrong))
      expect(() => {
        while (true) {
          const result = work.next()
          expect(result.done).toBe(false)
          expect(result.value).toBeUndefined()
          expect(receiver.stats.current).toEqual(original.identity)
        }
      }).toThrow('Invalid packed semantic document')
      expect(current).toBe('count')
      expect(work.next()).toEqual({ done: true, value: undefined })
      expect(receiver.stats.current).toEqual(original.identity)
      expect(receiver.stats.prepared).toBeNull()
      expect(receiver.stats.readers).toBe(0)
      expect(receiver.stats.readerStagingBytes).toBe(0)
      expect(initial.capture.reader.scalar(['document', 'counts', 'words'], validation)).toBe(2)
      const retry = receiver.begin(3, checked)
      const accepted = finishPackedSteps(
        receiver.receiveSteps(retry, packet(retry, parseMarkdown(updatedText))),
      )
      expect(accepted?.kind).toBe('accepted')
      expect(receiver.stats.current).toEqual(checked.identity)
      initial.capture.release()
    } finally {
      receiver.dispose()
    }
    expect(receiver.stats.retainedBytes).toBe(0)
  })
})
