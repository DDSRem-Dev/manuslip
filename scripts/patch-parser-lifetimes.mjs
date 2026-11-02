import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import {
  cancelledTokenizerSteps,
  compileEventSteps,
  postprocessBlockSteps,
} from './parser-compile-steps.mjs'
import { inlineResolverSteps } from './parser-inline-resolve-steps.mjs'
import { labelResolverSteps } from './parser-label-resolve-steps.mjs'
import { listlessSpanPreparation } from './parser-list-preparation.mjs'
import { finalCarriageReturn } from './parser-preprocessing.mjs'
import { textResolverSteps } from './parser-text-resolve-steps.mjs'

// Pinned parser lifetime patch. Only mdast's private events are compacted/consumed;
// micromark's public event contexts and the serializer's streaming identity stay intact.
// See docs/patches/parser-lifetimes.md for provenance, compatibility and measured limits.
const variants = [
  {
    package: 'micromark',
    version: '4.0.3',
    file: 'lib/create-tokenizer.js',
    kind: 'tokenizer',
    dev: false,
    original: '4d563d31e0f48eb0460072c869c6e38d92da7179768a671c66fa9db9fbe4fadf',
    patched: 'd6ea9e698cabf43322108871b9cedc8ddd793cae5fdfad9ef63785ff0d090949',
    previousInline: 'f1ca50b01e4f60381b06f7198e476ffe0aad703973018512a82f1c31a8333672',
    previousText: 'f9e2b07a25a72dc0a9e54e42385706d71170ac89950d6e7aa874fd0e5895e4c1',
    previousResolution: 'f2b7bfc834e2619690a4f6b037e3bfac3e245f017b7a762b8113e75bebe89871',
    previousCancellation: '64b4cdb74ff85a72ada49a7ac1cd9b6ef75d75b182853305ee230c6e5fd4337b',
    previousCompleted: 'a5706cb8169715d0bae53db9521b20a6d37de55a235a6b623a655c8640e25789',
    previous: '0be559dc3f989b4d5aa3c3465776bd7562764e6f2a182c1b9acaf4ebf42bac0f',
  },
  {
    package: 'micromark',
    version: '4.0.3',
    file: 'dev/lib/create-tokenizer.js',
    kind: 'tokenizer',
    dev: true,
    original: '3046dca3821cd57682f7bea3a91879519d7821a5976f2bd8aef5ce644885f7ce',
    patched: 'b161c49bbf3144bb748631ad00065ab5e2a2f085b5d312e6c9ea042236d40640',
    previousInline: 'f50a5ff72ef4354d5571436eb6804e68cdd6a83506f9a8d06b11fd9c5fea1a8d',
    previousText: 'c8f379b6ddaacde4080ca46ea892493810b450506122ca9b6623319b7137c47f',
    previousResolution: 'ec9b0386789ce85cc7fdb0f24053f84f15394e30bcbcfac72bb0d8ec16d09d89',
    previousCancellation: '256b775dc06a7d3920a851029f8f5b570efa59a18fc420b15a0d559a375ea2c5',
    previousCompleted: '4748267dc2f1a8f245dc7d207738465c9af5cca56178b128ff8a2f011a05621d',
    previous: 'e0cf0c4efcfaab87846090506a2d0584e556cd4f6e276561a5f0a25335cdd40b',
  },
  {
    package: 'mdast-util-from-markdown',
    version: '2.1.0',
    file: 'lib/index.js',
    kind: 'compiler',
    dev: false,
    original: 'dd0cd20672558ab4ca548b4f7e442e850863228915fff8eafd6d987d29fb107b',
    patched: 'f398a7b4c45dd304c2b09b2f7c7ac8c8d87186b55c11b98acfb1b490e4204ae1',
    previousPreprocessing: 'a476f2e7cc4ee0bb6f896072d5c42573a261f24f521840cabaf4d37b050e90f0',
    previousListCopies: '5ebb94bb7e65fb123b31c44c191df8638e805c9a66f56afde1420d03ed9d1c2f',
    previousResolution: 'd207acb6c3afdbfeda4ebe2289906a7b0801fd5843317f41b955cd29d8c2abc0',
    previousPostprocess: '9aa3209790118d6692f6529f78c534be000384fec5f9c6c69b38b1c9f586f37f',
    previousCompilation: '02064da77b598aa50b9721f4c75d47f8a28149eae2f5feca3d2e0069f7565e35',
    previousCompleted: '0edc03eb2f77a2623dd0487b8d45fc918b84d6ece43aacb1ffbe5cc16270e98e',
    previousTokenSteps: '2caaaaa1679fbf33b78b40ae074f39eed5bd12993a86aa87093ee53732c4379d',
    previousHandoff: '39fc5d3b2a850b08b2550d1c6a36af4bfcfa4863b930d470b93e70dde2780e6f',
    previousStream: 'ad095f74ffbb540fc0aea410d25e97eb16f8ba73ed95fa519d4dff45e84d7501',
    previousBlocks: '5182ee8cacb095764a7a06dc97afa3ff4a284eba66975754b79abe7f4227198d',
    previousSpans: '7bfda0e45999e1a89d7510f2fe57c9ab7fbe890aac2abc95b058a3c5d23aef3b',
    previous: '6e9aa9f5902ace264cbe42d28841e649a7f0b8ab8969e0813709d2bc3aae52e6',
  },
  {
    package: 'mdast-util-from-markdown',
    version: '2.1.0',
    file: 'dev/lib/index.js',
    kind: 'compiler',
    dev: true,
    original: 'c05ff75bbc99fbae60f4bcf53bc29edc7ab20f3750c7f3bc3ed6381e2f7627dd',
    patched: 'd7c200c319d9d71356330a6c1927779e9df9ffff064f8901575fc55494f53933',
    previousPreprocessing: '7db264970c4e8edeeed801ac3563cf7814c0a7891bf3f68fad09016703260978',
    previousListCopies: 'd906fc3062c2fcbdc89e58e3e11f5050bb2112f588104bffc94fc8d66413a96c',
    previousResolution: 'c579b2a91162f0c9ca6a69693e1ee214cf3b9a688669f59c5e4f6ed9fba0ae20',
    previousPostprocess: '85b2ca628df57243e2dccf2e8392fc5e7b3c2c43a6a3eaebcf198d6f555a6430',
    previousCompilation: '459718abfd6569549a7bab050f12c026de55b0432c53f36ea56b1793e9b26b47',
    previousCompleted: 'ae5ad144493a8cd7fc7aa3bfe923de294a007b2bddf0599f6b392d3be508e15c',
    previousTokenSteps: '8194000ec980fe15c46fe74347c993459f4edfa8832a664aa454c80d66d0c39a',
    previousHandoff: 'b094ce071e890d2b47565edd3ee6bb912e3a68e81146525cbaa4c0fb578296e1',
    previousStream: '0180d3fb9922c8b96d4d8a4e69064a78abd51eb339708bc9dc1751437f5feaf1',
    previousBlocks: '810824f90f1bb544beba5c46c7682c22a4b23167dbf9e9150d99371468182fe5',
    previousSpans: 'cb671922fded769556f70e37fbd49d20ca129ec0d31f264d083a2a7ea1b7b7d5',
    previous: '1a1c6e7d50693b9c068e5706970ef5f9b0c4d6d8a2eda7205b48a55fa3c76763',
  },
  {
    package: 'micromark',
    version: '4.0.3',
    file: 'lib/preprocess.js',
    kind: 'preprocessor',
    dev: false,
    original: '7b537d897bec551f515477d1033e1fafaa84519ee296cad0c5331ecd2e86d188',
    patched: '7b537d897bec551f515477d1033e1fafaa84519ee296cad0c5331ecd2e86d188',
  },
  {
    package: 'micromark',
    version: '4.0.3',
    file: 'dev/lib/preprocess.js',
    kind: 'preprocessor',
    dev: true,
    original: '9fcd1199a8f45c9c9f34b6697f29a1482efaf2e76ecc116cfcc4b86d7d3201c2',
    patched: '9fcd1199a8f45c9c9f34b6697f29a1482efaf2e76ecc116cfcc4b86d7d3201c2',
  },
  {
    package: 'micromark',
    version: '4.0.3',
    file: 'lib/initialize/text.js',
    kind: 'text-resolver',
    dev: false,
    original: '1c5682291dbb6cea7f95edeb6d50421238b91752c9e0fb9485bdde44628ce090',
    patched: 'aedd0c6982951a1813bac9aaeaa31e4db041b01697b7e4128880dfa12e9493eb',
  },
  {
    package: 'micromark',
    version: '4.0.3',
    file: 'dev/lib/initialize/text.js',
    kind: 'text-resolver',
    dev: true,
    original: '42f71a37602a65811779e2ae2977bd968504e2b54b575c1458ebb7dd0ca4ff66',
    patched: 'd0fe317d4892db1e33e9e11955447756c971d1fd050efbd5be6650ea02f03e16',
  },
  {
    package: 'micromark-core-commonmark',
    version: '2.0.4',
    file: 'lib/attention.js',
    kind: 'inline-source',
    dev: false,
    original: 'cd9329ed32379acf1e80e427124f25648fba7722886ecc0de3c5dc8551268ee4',
    patched: 'cd9329ed32379acf1e80e427124f25648fba7722886ecc0de3c5dc8551268ee4',
  },
  {
    package: 'micromark-core-commonmark',
    version: '2.0.4',
    file: 'dev/lib/attention.js',
    kind: 'inline-source',
    dev: true,
    original: 'a80deb1561614d952f3b283999cc3f949f23525de164b390e8e78b151049cfea',
    patched: 'a80deb1561614d952f3b283999cc3f949f23525de164b390e8e78b151049cfea',
  },
  {
    package: 'micromark-extension-gfm-strikethrough',
    version: '2.1.0',
    file: 'lib/syntax.js',
    kind: 'inline-source',
    dev: false,
    original: '293e9b13a554fe569efd096cd7f1c3f4d6da861f30bba701e8b923f621181250',
    patched: '293e9b13a554fe569efd096cd7f1c3f4d6da861f30bba701e8b923f621181250',
  },
  {
    package: 'micromark-extension-gfm-strikethrough',
    version: '2.1.0',
    file: 'dev/lib/syntax.js',
    kind: 'inline-source',
    dev: true,
    original: '913b1c9346b06ab0e5825f9b2d2f85a3d0505bf9a557f488cdf07020d494d791',
    patched: '913b1c9346b06ab0e5825f9b2d2f85a3d0505bf9a557f488cdf07020d494d791',
  },
  {
    package: 'micromark-core-commonmark',
    version: '2.0.4',
    file: 'lib/label-end.js',
    kind: 'label-resolver',
    dev: false,
    original: '055ac0d7f62144011730fbd5bf81ee6f4cb40bdd8428b44d2f0febd3f1ea4364',
    patched: '055ac0d7f62144011730fbd5bf81ee6f4cb40bdd8428b44d2f0febd3f1ea4364',
  },
  {
    package: 'micromark-core-commonmark',
    version: '2.0.4',
    file: 'dev/lib/label-end.js',
    kind: 'label-resolver',
    dev: true,
    original: 'a98205fee00589963f9fc4426871a9eaef43621216d5966df7de3525f7a1cee6',
    patched: 'a98205fee00589963f9fc4426871a9eaef43621216d5966df7de3525f7a1cee6',
  },
]

function patchBlocks(source, variant) {
  const dev = variant.dev
  const end = dev ? '' : ';'
  const change = (before, after) => {
    assert.equal(source.split(before).length, 2, before)
    source = source.replace(before, after)
  }
  const branch = `  // Manuslip private event-span path.\n`
  change(
    branch,
    `  // Manuslip private block-stream path.
  if (options && options._manuslipEventSpans && options._manuslipBlockStream) {
    return (function* () {
      return yield* compiler(options)(eventSpans(parse(options).document().write(preprocess()(value, encoding, true))))${end}
    })()${end}
  }
  // End Manuslip private block-stream path.
${branch}`,
  )
  const select = `  return options && options._manuslipEventSpans ? compileSpans : compile${end}`
  change(
    select,
    `  // Manuslip private block-stream compiler selection.
  if (options && options._manuslipEventSpans && options._manuslipBlockStream) {
    const allowed = options._manuslipBlockTransforms${end}
    if (!Array.isArray(allowed) || config.transforms.length !== allowed.length ||
        config.transforms.some((transform, index) => transform !== allowed[index]))
      throw new Error('Unsupported private block-stream transform')${end}
    return compileBlockSpans${end}
  }
  // End Manuslip private block-stream compiler selection.
${select}`,
  )
  const from = source.indexOf('  function compileSpans(events) {')
  const to = source.indexOf('  // End Manuslip span compiler.\n', from)
  assert.ok(from > 0 && to > from)
  let generator = source
    .slice(from, to)
    .replace('function compileSpans(events)', 'function* compileBlockSpans(events)')
  const loop = `    for (const input of events) {`
  assert.equal(generator.split(loop).length, 2)
  generator = generator.replace(
    loop,
    `    try {
${loop}`,
  )
  const consumed = `      events.length = 0${end}\n    }`
  assert.equal(generator.split(consumed).length, 2)
  generator = generator.replace(
    consumed,
    `      events.length = 0${end}
      if (context.stack.length !== 1 || context.tokenStack.length)
        throw new Error('Unclosed private block-stream span')${end}
      if (tree.children.length) {
        // Only the explicitly supplied block-local transforms are supported.
        for (const transform of config.transforms) {
          const result = transform(tree)${end}
          if (result && result !== tree)
            throw new Error('Unsupported private block-stream root replacement')${end}
        }
        const completed = tree.children${end}
        tree.children = []${end}
        try {
          for (let index = 0; index < completed.length; index++) {
            let child = completed[index]${end}
            completed[index] = undefined${end}
            yield child${end}
            child = undefined${end}
          }
        } finally {
          completed.length = 0${end}
        }
      }
    }`,
  )
  const transforms = `    // Call transforms.\n    index = -1${end}\n    while (++index < config.transforms.length) {\n      tree = config.transforms[index](tree) || tree${end}\n    }\n${dev ? '\n' : ''}    return tree${end}\n  }\n`
  assert.equal(generator.split(transforms).length, 2)
  generator = generator.replace(
    transforms,
    `    return tree${end}
    } finally {
      tree.children.length = 0${end}
      context.stack.length = 0${end}
      context.tokenStack.length = 0${end}
      for (const key of Object.keys(data)) delete data[key]${end}
    }
  }
`,
  )
  generator = generator.replace(/\bevents\b/g, 'streamEvents')
  source = `${source.slice(0, to)}  // Manuslip block-stream compiler.\n${generator}${source.slice(to)}`
  return yieldClosedBlocks(source, variant)
}

function yieldClosedBlocks(source, variant) {
  const end = variant.dev ? '' : ';'
  const from = source.indexOf('  // Manuslip block-stream compiler.\n')
  const to = source.indexOf('  // End Manuslip span compiler.\n', from)
  assert.ok(from > 0 && to > from, 'Missing private block-stream compiler')
  let compile = source.slice(from, to)
  const first = compile.indexOf('      if (tree.children.length) {\n')
  const last = compile.indexOf('\n    }\n\n    // Handle tokens still being open.', first)
  assert.ok(first > 0 && last > first, 'Missing completed span children')
  const completed = compile.slice(first, last)
  compile = compile.slice(0, first) + compile.slice(last)
  const consumed = compile.indexOf(`      streamEvents.length = 0${end}`)
  const loopEnd = compile.lastIndexOf('\n    }\n', consumed)
  assert.ok(loopEnd > 0 && consumed > loopEnd, 'Missing private event loop')
  const handoff = `      // Manuslip closed-block handoff.
      streamEvents[index] = undefined${end}
${completed.replace(
  'if (tree.children.length)',
  'if (context.stack.length === 1 && !context.tokenStack.length && tree.children.length)',
)}
      // End Manuslip closed-block handoff.`
  compile = `${compile.slice(0, loopEnd)}\n${handoff}${compile.slice(loopEnd)}`
  return tokenizeInSteps(source.slice(0, from) + compile + source.slice(to), variant)
}

function tokenizeInSteps(source, variant) {
  const end = variant.dev ? '' : ';'
  const call = `      return yield* compiler(options)(eventSpans(parse(options).document().write(preprocess()(value, encoding, true))))${end}\n`
  assert.equal(source.split(call).length, 2, 'Missing private block tokenization')
  const result = source.replace(
    call,
    `      // Manuslip cooperative block-tokenization.
      if (options._manuslipBlockTokenSteps) {
        const compile = compiler(options)${end}
        const parser = parse(options)${end}
        parser._manuslipBlockTokenSteps = true${end}
        const document = parser.document()${end}
        delete parser._manuslipBlockTokenSteps${end}
        const chunks = preprocess()(value, encoding, true)${end}
        try {
          if (typeof document._manuslipWriteSteps !== 'function')
            throw new Error('Missing private tokenizer stepping')${end}
          const events = yield* document._manuslipWriteSteps(chunks)${end}
          return yield* compile(eventSpans(events))${end}
        } finally {
          chunks.length = 0${end}
          document.events.length = 0${end}
        }
      }
      // End Manuslip cooperative block-tokenization.
${call}`,
  )
  return preprocessInSteps(result, variant)
}

function preprocessInSteps(source, variant) {
  const end = variant.dev ? '' : ';'
  const before = `        const chunks = preprocess()(value, encoding, true)${end}\n        try {\n`
  assert.equal(source.split(before).length, 2, 'Missing private preprocessing')
  source = source.replace(
    before,
    `        let chunks${end}
        try {
          chunks = options._manuslipBlockPreprocessSteps
            ? yield* preprocessSteps(value, encoding)
            : preprocess()(value, encoding, true)${end}
          value = undefined${end}
`,
  )
  const clear = `          chunks.length = 0${end}\n`
  assert.equal(source.split(clear).length, 2, 'Missing private chunk release')
  source = source.replace(
    clear,
    `          value = undefined${end}\n          if (chunks) chunks.length = 0${end}\n`,
  )
  return `${source}
// Manuslip cooperative preprocessing.
// Whole-value variant of micromark 4.0.3 preprocess: identical chunks, bounded scans.
// String slicing, byte decoding, array storage and later parser work remain unadmitted.
function* preprocessSteps(value, encoding) {
  let column = 1${end}
  let atCarriageReturn${end}
  const chunks = []${end}
  let completed = false${end}
  try {
    value = typeof value === 'string'
      ? value.toString()
      : new TextDecoder(encoding || undefined).decode(value)${end}
    let startPosition = value.charCodeAt(0) === 65279 ? 1 : 0${end}
    let scanned = startPosition${end}
    while (startPosition < value.length) {
      let endPosition = startPosition${end}
      while (endPosition < value.length) {
        if (scanned === 4096) {
          scanned = 0${end}
          yield${end}
        }
        const code = value.charCodeAt(endPosition)${end}
        scanned++${end}
        if (code === 0 || code === 9 || code === 10 || code === 13) break${end}
        endPosition++${end}
      }
      const code = value.charCodeAt(endPosition)${end}
      if (endPosition === value.length) {
        chunks.push(value.slice(startPosition))${end}
        break${end}
      }
      if (code === 10 && startPosition === endPosition && atCarriageReturn) {
        chunks.push(-3)${end}
        atCarriageReturn = undefined${end}
      } else {
        if (atCarriageReturn) {
          chunks.push(-5)${end}
          atCarriageReturn = undefined${end}
        }
        if (startPosition < endPosition) {
          chunks.push(value.slice(startPosition, endPosition))${end}
          column += endPosition - startPosition${end}
        }
        switch (code) {
          case 0:
            chunks.push(65533)${end}
            column++${end}
            break${end}
          case 9: {
            const next = Math.ceil(column / 4) * 4${end}
            chunks.push(-2)${end}
            while (column++ < next) chunks.push(-1)${end}
            break${end}
          }
          case 10:
            chunks.push(-4)${end}
            column = 1${end}
            break${end}
          default:
            atCarriageReturn = true${end}
            column = 1${end}
        }
      }
      startPosition = endPosition + 1${end}
    }
    if (atCarriageReturn) chunks.push(-5)${end}
    chunks.push(null)${end}
    completed = true${end}
    return chunks${end}
  } finally {
    value = undefined${end}
    if (!completed) chunks.length = 0${end}
  }
}
// End Manuslip cooperative preprocessing.
`
}

function patchTokenSteps(source, variant) {
  const end = variant.dev ? '' : ';'
  const writeFrom = source.indexOf('  function write(slice) {')
  const writeTo = source.indexOf('\n  //\n  // Tools.', writeFrom)
  const mainFrom = source.indexOf('  function main() {')
  const mainTo = source.indexOf('  /**\n   * Deal with one code.', mainFrom)
  assert.ok(writeFrom > 0 && writeTo > writeFrom && mainFrom > 0 && mainTo > mainFrom)
  const write = source
    .slice(writeFrom, writeTo)
    .replace('function write(slice)', 'function* writeSteps(slice)')
    .replace(`    main()${end}`, `    while (!mainSteps()) yield${end}`)
  let main = source
    .slice(mainFrom, mainTo)
    .replace('function main() {', `function mainSteps() {\n    let steps = 0${end}`)
  for (const call of ['go(chunk.charCodeAt(point._bufferIndex))', 'go(chunk)']) {
    assert.equal(main.split(call).length, 2, call)
    main = main.replace(call, `if (++steps > 4096) return false${end}\n          ${call}`)
  }
  const finish = main.lastIndexOf('\n  }')
  assert.ok(finish > 0)
  main = `${main.slice(0, finish)}\n    return true${end}${main.slice(finish)}`
  const indent = (value) =>
    value
      .split('\n')
      .map((line) => (line ? `  ${line}` : line))
      .join('\n')
  const marker = `  return context${end}\n`
  assert.equal(source.split(marker).length, 2, 'Missing tokenizer return')
  return source.replace(
    marker,
    `  // Manuslip cooperative document tokenizer.
  if (parser._manuslipBlockTokenSteps) {
    context._manuslipWriteSteps = writeSteps${end}
${indent(write)}
${indent(main)}  }
  // End Manuslip cooperative document tokenizer.
${marker}`,
  )
}

function releaseSpanInput(source, variant) {
  const end = variant.dev ? '' : ';'
  const from = source.indexOf('\n  // Manuslip span compiler.\n')
  const to = source.indexOf('  // End Manuslip span compiler.\n', from)
  if (from < 0 || to < from) throw new Error('Missing private span compiler')
  const compile = source
    .slice(from, to)
    .replace(
      `    events = prepared${end}`,
      `    // Prepared owns every event; drop the private input before node construction.\n    input.length = 0${end}\n    events = prepared${end}`,
    )
    .replace(
      `      events.length = 0${end}\n      input.length = 0${end}`,
      `      events.length = 0${end}`,
    )
  return source.slice(0, from) + compile + source.slice(to)
}

function patchSpans(source, variant) {
  const end = variant.dev ? '' : ';'
  const from = source.indexOf('  function compile(events) {')
  const to = source.indexOf('\n  /**\n   * @param {Array<Handle>}', from)
  if (from < 0 || to < from) throw new Error('Missing original compiler')
  let compile = source
    .slice(from, to)
    .replace('function compile(events)', 'function compileSpans(events)')
  const prepare = compile.indexOf('    /** @type {Array<number>} */')
  const handled = compile.indexOf('    // Handle tokens still being open.')
  if (prepare < 0 || handled < prepare) throw new Error('Missing compiler event loops')
  const loops = compile.slice(prepare, handled)
  compile = `${compile.slice(0, prepare)}    let index = -1${end}
    let firstPoint, penultimateEnd, lastEnd${end}
    for (const input of events) {
      let events = serializationEvents(postprocess(input))${end}
      if (events.length) {
        if (!firstPoint) firstPoint = point(events[0][1].start)${end}
        penultimateEnd = events.length > 1 ? point(events[events.length - 2][1].end) : lastEnd${end}
        lastEnd = point(events[events.length - 1][1].end)${end}
      }
${loops}
      events.length = 0${end}
      input.length = 0${end}
    }

${compile.slice(handled)}`
  const position = compile.indexOf('    tree.position = {')
  const transforms = compile.indexOf('    // Call transforms.', position)
  if (position < 0 || transforms < position) throw new Error('Missing compiler root position')
  compile = `${compile.slice(0, position)}    tree.position = {
      start: firstPoint || point({line: 1, column: 1, offset: 0}),
      end: penultimateEnd || point({line: 1, column: 1, offset: 0})
    }${end}

${compile.slice(transforms)}`
  const call = `  return compiler(options)(serializationEvents(postprocess(parse(options).document().write(preprocess()(value, encoding, true)))))${end}`
  const branch = `  // Manuslip private event-span path.
  if (options && options._manuslipEventSpans) {
    return compiler(options)(eventSpans(parse(options).document().write(preprocess()(value, encoding, true))))${end}
  }
`
  const result =
    (
      source.slice(0, to) +
      '\n  // Manuslip span compiler.\n' +
      compile +
      '  // End Manuslip span compiler.\n' +
      source.slice(to)
    )
      .replace(call, branch + call)
      .replace(
        `\n  return compile${end}\n`,
        `\n  return options && options._manuslipEventSpans ? compileSpans : compile${end}\n`,
      ) +
    `
/**
 * Resolve complete top-level spans after all block definitions are known.
 * This generator consumes only the private fromMarkdown event array.
 */
function* eventSpans(events) {
  let depth = 0${end}
  const linked = new Set()${end}
  let batch = []${end}
  try {
    for (let index = 0; index < events.length; index++) {
      const event = events[index]${end}
      events[index] = undefined${end}
      batch.push(event)${end}
      depth += event[0] === 'enter' ? 1 : -1${end}
      if (event[0] === 'enter') linked.delete(event[1])${end}
      else if (event[1].next) linked.add(event[1].next)${end}
      if (depth === 0 && linked.size === 0) {
        yield batch${end}
        batch = []${end}
      }
    }
    if (depth !== 0 || linked.size) throw new Error('Unbalanced private event span')${end}
    if (batch.length) yield batch${end}
  } finally {
    events.length = 0${end}
    batch.length = 0${end}
    linked.clear()${end}
  }
}
`
  return patchBlocks(releaseSpanInput(result, variant), variant)
}

/** Only the private block compiler enables this after all EOF resolvers finish.
 * Later subtokenization needs events, parser and source slicing. Keep those in
 * detached factories so completed contexts no longer own tokenizer closures.
 */
function releaseCompleted(source, variant) {
  const end = variant.dev ? '' : ';'
  if (variant.kind === 'compiler') {
    const from = `        const parser = parse(options)${end}`
    assert.equal(source.split(from).length, 2, 'Private block parser creation')
    return source.replace(from, `${from}\n        parser._manuslipReleaseCompleted = true${end}`)
  }
  if (variant.kind !== 'tokenizer') return source
  const from = `    context.events = resolveAll(resolveAllConstructs, context.events, context)${end}`
  assert.equal(source.split(from).length, 3, 'Both ordinary/private EOF resolver sites')
  return (
    source.replaceAll(
      from,
      from +
        `\n    if (parser._manuslipReleaseCompleted) releaseCompletedTokenizer(context, serialization)${end}`,
    ) +
    `
// Manuslip private completed-tokenizer release.
function releaseCompletedTokenizer(context, source) {
  for (const key of Object.keys(context))
    if (key !== 'events' && key !== 'parser' && key !== 'sliceSerialize') delete context[key]${end}
  context.sliceStream = detachedCompletedStream(source)${end}
}
function detachedCompletedStream(source) {
  return function sliceStream(token) {
    return sliceChunks(source.chunks, token)${end}
  }${end}
}
// End Manuslip private completed-tokenizer release.
`
  )
}

function patch(source, variant) {
  const end = variant.dev ? '' : ';'
  if (variant.kind === 'tokenizer') {
    return patchTokenSteps(
      source
        .replace(
          `  let chunks = []${end}`,
          `  let chunks = []${end}\n  const serialization = {chunks}${end}`,
        )
        .replace(
          '    sliceSerialize,\n',
          '    sliceSerialize: detachedSerializer(serialization),\n',
        )
        .replace(
          `    chunks = push(chunks, slice)${end}`,
          `    chunks = push(chunks, slice)${end}\n    serialization.chunks = chunks${end}`,
        )
        .replace(
          `  /** @type {TokenizeContext['sliceSerialize']} */\n  function sliceSerialize(token, expandTabs) {\n    return serializeChunks(sliceStream(token), expandTabs)${end}\n  }\n\n`,
          '',
        ) +
        `
/**
 * Serialize source without retaining tokenizer state, events or parser closures.
 * @param {{chunks: Array<Chunk>}} source
 * @returns {TokenizeContext['sliceSerialize']}
 */
function detachedSerializer(source) {
  return function sliceSerialize(token, expandTabs) {
    return serializeChunks(sliceChunks(source.chunks, token), expandTabs)${end}
  }${end}
}
`,
      variant,
    )
  }
  // All resolvers have finished. The private compiler only reads sliceSerialize
  // from each context, including contexts copied into synthetic list-item events.
  const original = variant.dev
    ? `  return compiler(options)(\n    postprocess(\n      parse(options)\n        .document()\n        .write(preprocess()(value, encoding, true))\n    )\n  )`
    : '  return compiler(options)(postprocess(parse(options).document().write(preprocess()(value, encoding, true))));'
  const replacement = `  return compiler(options)(serializationEvents(postprocess(parse(options).document().write(preprocess()(value, encoding, true)))))${end}`
  return patchSpans(
    source.replace(original, replacement) +
      `
/**
 * Drop completed tokenizer contexts before native tree construction.
 * This array belongs to fromMarkdown, after all micromark resolution.
 * @param {Array<Event>} events
 * @returns {Array<Event>}
 */
function serializationEvents(events) {
  const contexts = new WeakMap()${end}
  for (const event of events) {
    const original = event[2]${end}
    let context = contexts.get(original)${end}
    if (!context) {
      context = {sliceSerialize: original.sliceSerialize}${end}
      contexts.set(original, context)${end}
    }
    event[2] = context${end}
  }
  return events${end}
}
`,
    variant,
  )
}

const hash = (value) => createHash('sha256').update(value).digest('hex')
// Validate every package and pinned file before writing any of them. A known
// partial installation can be repaired; unknown sources are never overwritten.
const plans = await Promise.all(
  variants.map(async (variant) => {
    const directory = new URL(`../node_modules/${variant.package}/`, import.meta.url)
    const info = JSON.parse(await readFile(new URL('package.json', directory), 'utf8'))
    if (info.name !== variant.package || info.version !== variant.version)
      throw new Error(`Unsupported parser lifetime dependency: ${variant.package}`)
    const path = new URL(variant.file, directory)
    const source = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n')
    if (hash(source) === variant.patched) return undefined
    if (
      hash(source) !== variant.original &&
      hash(source) !== variant.previous &&
      hash(source) !== variant.previousSpans &&
      hash(source) !== variant.previousBlocks &&
      hash(source) !== variant.previousStream &&
      hash(source) !== variant.previousHandoff &&
      hash(source) !== variant.previousTokenSteps &&
      hash(source) !== variant.previousCompleted &&
      hash(source) !== variant.previousCompilation &&
      hash(source) !== variant.previousPostprocess &&
      hash(source) !== variant.previousCancellation &&
      hash(source) !== variant.previousResolution &&
      hash(source) !== variant.previousText &&
      hash(source) !== variant.previousInline &&
      hash(source) !== variant.previousListCopies &&
      hash(source) !== variant.previousPreprocessing
    )
      throw new Error(`Unrecognized parser lifetime source: ${variant.package}/${variant.file}`)
    if (process.argv.includes('--check'))
      throw new Error('Parser lifetime patch is missing; run npm install before checking/building')
    const finish = (result) => {
      if (variant.kind === 'compiler') result = finalCarriageReturn(result, variant.dev)
      if (hash(result) !== variant.patched)
        throw new Error(`Invalid parser lifetime patch: ${variant.package}/${variant.file}`)
      return { path, result }
    }
    if (hash(source) === variant.previousPreprocessing) return finish(source)
    if (hash(source) === variant.previousListCopies) {
      const result = listlessSpanPreparation(source, variant)
      return finish(result)
    }
    if (hash(source) === variant.previousInline) {
      const result = listlessSpanPreparation(labelResolverSteps(source, variant), variant)
      return finish(result)
    }
    if (hash(source) === variant.previousText) {
      const result = listlessSpanPreparation(
        labelResolverSteps(inlineResolverSteps(source, variant), variant),
        variant,
      )
      return finish(result)
    }
    if (variant.kind === 'text-resolver' || hash(source) === variant.previousResolution) {
      const result = listlessSpanPreparation(
        labelResolverSteps(
          inlineResolverSteps(textResolverSteps(source, variant), variant),
          variant,
        ),
        variant,
      )
      return finish(result)
    }
    const previous =
      hash(source) === variant.previousCancellation ||
      hash(source) === variant.previousPostprocess ||
      hash(source) === variant.previousCompilation
        ? source
        : hash(source) === variant.previousCompleted
          ? source
          : hash(source) === variant.previousTokenSteps
            ? preprocessInSteps(source, variant)
            : hash(source) === variant.previousHandoff
              ? tokenizeInSteps(source, variant)
              : hash(source) === variant.previousStream
                ? yieldClosedBlocks(source, variant)
                : hash(source) === variant.previousBlocks
                  ? patchBlocks(source, variant)
                  : hash(source) === variant.previousSpans
                    ? patchBlocks(releaseSpanInput(source, variant), variant)
                    : hash(source) === variant.previous
                      ? variant.kind === 'tokenizer'
                        ? patchTokenSteps(source, variant)
                        : patchSpans(source, variant)
                      : patch(source, variant)
    const result = listlessSpanPreparation(
      labelResolverSteps(
        inlineResolverSteps(
          textResolverSteps(
            cancelledTokenizerSteps(
              postprocessBlockSteps(
                hash(source) === variant.previousCancellation ||
                  hash(source) === variant.previousPostprocess
                  ? previous
                  : compileEventSteps(
                      hash(source) === variant.previousCompilation
                        ? previous
                        : releaseCompleted(previous, variant),
                      variant,
                    ),
                variant,
              ),
              variant,
            ),
            variant,
          ),
          variant,
        ),
        variant,
      ),
      variant,
    )
    return finish(result)
  }),
)
for (const plan of plans) if (plan) await writeFile(plan.path, plan.result)
console.log('Pinned parser lifetime patch verified')
