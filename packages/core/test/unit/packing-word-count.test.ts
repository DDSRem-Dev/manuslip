import { expect, it, vi } from 'vitest'
import { checkPackedWordCount } from '../../src/packing-validate-words'
import { finishPackedSteps } from '../../src/packing-work'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
const punctuation = Array.from({ length: 94 }, (_, index) =>
  String.fromCharCode(index + 33),
).filter((text) => !/[a-z\d]/i.test(text))
function nativeWords(text: string, oracle = segmenter): number {
  let words = 0
  for (const segment of oracle.segment(text)) if (segment.isWordLike) words++
  return words
}
function check(text: string, words = nativeWords(text)): void {
  finishPackedSteps(checkPackedWordCount(text, words, () => {}))
}
function observeIteration() {
  const original = Intl.Segmenter.prototype.segment
  let iterators = 0
  const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment').mockImplementation(function (
    this: Intl.Segmenter,
    input,
  ) {
    const result = original.call(this, input)
    const iterate = result[Symbol.iterator].bind(result)
    Object.defineProperty(result, Symbol.iterator, {
      value: () => {
        iterators++
        return iterate()
      },
    })
    return result
  })
  return { segment, iterators: () => iterators }
}

it('matches native counts for every ASCII punctuation pair around and between word runs', () => {
  for (const left of punctuation) {
    for (const right of punctuation) {
      check(left + right)
      for (const word of ['letters', '123', 'a1B2']) {
        for (const text of [
          left + word + right,
          word + left + right,
          left + right + word,
          `${left}${word}${right} ${right}${word}${left}`,
          word + left + right + word,
          left + word + right + word + left,
        ])
          check(text)
      }
    }
  }
})

it('counts complete ASCII markup punctuation without starting the native iterator', () => {
  const texts = [
    punctuation.filter((text) => text !== '_').join(''),
    '> > Nested writing with **emphasis**, `code`, a [link], "quotes" and $42. '.repeat(8000),
    '(alpha) [beta] {gamma} <delta> /echo/ \\foxtrot\\ @golf #hotel %42 &juliet *kilo* +73 =99 ^lima |mike| ~november~',
  ]
  const expected = texts.map((text) => [text, nativeWords(text)] as const)
  const observed = observeIteration()
  try {
    for (const [text, words] of expected) check(text, words)
    expect(observed.segment.mock.calls).toEqual(texts.map((text) => [text]))
    expect(observed.iterators()).toBe(0)
  } finally {
    observed.segment.mockRestore()
  }
})

it('uses the complete native iterator for punctuation bridges, underscores and other controls', () => {
  const texts = [
    ...punctuation.filter((text) => text !== '-').map((text) => `a1${text}b2`),
    '_',
    '__',
    '_word_',
    ...Array.from({ length: 33 }, (_, index) => (index === 32 ? 127 : index))
      .filter((code) => code < 9 || code > 13)
      .map((code) => `a${String.fromCharCode(code)}b`),
    `${'word '.repeat(4096)}[tail]_`,
  ]
  for (const text of texts) {
    const expected = nativeWords(text)
    const observed = observeIteration()
    try {
      check(text, expected)
      expect(observed.segment).toHaveBeenCalledExactlyOnceWith(text)
      expect(observed.iterators()).toBe(1)
    } finally {
      observed.segment.mockRestore()
    }
  }
})

it('matches every non-underscore ASCII punctuation context across native locale settings', () => {
  for (const locale of Intl.Segmenter.supportedLocalesOf([
    'en',
    'zh-CN',
    'ja',
    'ar',
    'he',
    'th',
    'sv',
    'fi',
    'fr',
    'de',
  ])) {
    const oracle = new Intl.Segmenter(locale, { granularity: 'word' })
    for (const mark of punctuation.filter((text) => text !== '_')) {
      for (const text of [mark + mark, `${mark}alpha42${mark}`, `42${mark} ${mark}beta`])
        check(text, nativeWords(text, oracle))
    }
  }
})

it('matches native whole-string segmentation for exhaustive short ASCII boundaries', () => {
  const alphabet = ['a', 'B', '0', '9', ' ', '\t', '\r', '\n', '.', ',', ':', ';', '!', '?', '-']
  check('')
  for (let length = 1; length <= 4; length++) {
    const count = alphabet.length ** length
    for (let value = 0; value < count; value++) {
      let index = value
      let text = ''
      for (let at = 0; at < length; at++) {
        text += alphabet[index % alphabet.length]
        index = Math.floor(index / alphabet.length)
      }
      check(text)
    }
  }
})

it('preserves the complete native input and counts simple prose without iterating segments', () => {
  const values = [
    '',
    '?!.,:;',
    'A1B23',
    '\tAlpha, beta!\r\nGamma42?\v\f',
    'Writing leaves room for another idea. '.repeat(12000),
  ]
  const expected = values.map((text) => [text, nativeWords(text)] as const)
  const observed = observeIteration()
  try {
    for (const [text, words] of expected) check(text, words)
    expect(observed.segment.mock.calls).toEqual(values.map((text) => [text]))
    expect(observed.iterators()).toBe(0)
  } finally {
    observed.segment.mockRestore()
  }
})

it('retains complete native segmentation for bridges, unsupported ASCII, Unicode and surrogates', () => {
  const values = [
    'e.g.',
    'example.com',
    "can't",
    'a:a',
    '3.2',
    '3,456.789',
    'a_b',
    'a\u0000b',
    'a\u007fb',
    '中文 日本語',
    'ภาษาไทย',
    'العربية עברית',
    'a\u0301',
    '👩🏽‍💻 🇸🇬',
    '\ud800word\udc00',
    'one\u00a0two',
    `${'word '.repeat(4096)}x:y`,
  ]
  for (const text of values) {
    const expected = nativeWords(text)
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment')
    try {
      check(text, expected)
      expect(segment).toHaveBeenCalledExactlyOnceWith(text)
    } finally {
      segment.mockRestore()
    }
  }
})

it('rejects incorrect counts on both the simple and native paths', () => {
  for (const text of [
    '',
    'one word.',
    'A1 B2 C3!',
    'ภาษาไทย 中文',
    'e.g. 12,345',
    `${'word '.repeat(900)}bridge:word`,
  ]) {
    const expected = nativeWords(text)
    expect(() => check(text, expected + 1)).toThrow('Invalid packed semantic')
    if (expected > 0) expect(() => check(text, expected - 1)).toThrow('Invalid packed semantic')
  }
})

it('matches simple-prose counts across native locale configurations', () => {
  const values = [
    'alpha A1 42, beta!',
    'word-word 12-34 nested-containers',
    '\n?!Gamma23;\tDelta.\r\n',
    'x'.repeat(4100),
    '.,:;!?',
  ]
  for (const locale of Intl.Segmenter.supportedLocalesOf([
    'en',
    'zh-CN',
    'ja',
    'ar',
    'he',
    'th',
    'sv',
    'fi',
    'fr',
    'de',
  ])) {
    const oracle = new Intl.Segmenter(locale, { granularity: 'word' })
    for (const text of values) check(text, nativeWords(text, oracle))
  }
})

it('bounds lexical advances and cancels without iterating native segments', () => {
  const text = 'one word. '.repeat(3000)
  const expected = nativeWords(text)
  const original = String.prototype.charCodeAt
  let reads = 0
  const character = vi.spyOn(String.prototype, 'charCodeAt').mockImplementation(function (
    this: string,
    index,
  ) {
    reads++
    return original.call(this, index)
  })
  const observed = observeIteration()
  const work = checkPackedWordCount(text, expected, () => {})
  let bounded = false
  try {
    while (true) {
      const before = reads
      const next = work.next()
      const advanced = reads - before
      expect(advanced).toBeLessThanOrEqual(4096)
      if (advanced === 4096) {
        bounded = true
        work.return(undefined)
        break
      }
      if (next.done) break
    }
    expect(bounded).toBe(true)
    expect(work.next()).toEqual({ done: true, value: undefined })
    expect(observed.segment).toHaveBeenCalledExactlyOnceWith(text)
    expect(observed.iterators()).toBe(0)
  } finally {
    work.return(undefined)
    character.mockRestore()
    observed.segment.mockRestore()
  }
})
