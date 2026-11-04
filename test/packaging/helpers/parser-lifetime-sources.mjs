import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  withRetainedCancelledTokenizer,
  withSynchronousBlockCompilation,
} from '../../../scripts/parser-compile-steps.mjs'
import { withSynchronousTextResolution } from '../../../scripts/parser-text-resolve-steps.mjs'

export {
  withRetainedCancelledTokenizer,
  withSynchronousBlockCompilation,
  withSynchronousBlockPostprocessing,
} from '../../../scripts/parser-compile-steps.mjs'
export { withSynchronousInlineResolution } from '../../../scripts/parser-inline-resolve-steps.mjs'
export { withSynchronousLabelResolution } from '../../../scripts/parser-label-resolve-steps.mjs'
export { withCopiedListlessSpans } from '../../../scripts/parser-list-preparation.mjs'
export { withPendingFinalCarriageReturn } from '../../../scripts/parser-preprocessing.mjs'
export { withSynchronousTextResolution } from '../../../scripts/parser-text-resolve-steps.mjs'

// Independent original-source fixtures: every reconstruction must match the
// published source hash, rather than treating an inverse edit as an oracle.
const variants = [
  [
    'micromark-core-commonmark',
    '2.0.4',
    'lib/label-end.js',
    false,
    '055ac0d7f62144011730fbd5bf81ee6f4cb40bdd8428b44d2f0febd3f1ea4364',
  ],
  [
    'micromark-core-commonmark',
    '2.0.4',
    'dev/lib/label-end.js',
    true,
    'a98205fee00589963f9fc4426871a9eaef43621216d5966df7de3525f7a1cee6',
  ],
  [
    'micromark',
    '4.0.3',
    'lib/create-tokenizer.js',
    false,
    '4d563d31e0f48eb0460072c869c6e38d92da7179768a671c66fa9db9fbe4fadf',
  ],
  [
    'micromark',
    '4.0.3',
    'dev/lib/create-tokenizer.js',
    true,
    '3046dca3821cd57682f7bea3a91879519d7821a5976f2bd8aef5ce644885f7ce',
  ],
  [
    'mdast-util-from-markdown',
    '2.1.0',
    'lib/index.js',
    false,
    'dd0cd20672558ab4ca548b4f7e442e850863228915fff8eafd6d987d29fb107b',
  ],
  [
    'mdast-util-from-markdown',
    '2.1.0',
    'dev/lib/index.js',
    true,
    'c05ff75bbc99fbae60f4bcf53bc29edc7ab20f3750c7f3bc3ed6381e2f7627dd',
  ],
  [
    'micromark',
    '4.0.3',
    'lib/preprocess.js',
    false,
    '7b537d897bec551f515477d1033e1fafaa84519ee296cad0c5331ecd2e86d188',
  ],
  [
    'micromark',
    '4.0.3',
    'dev/lib/preprocess.js',
    true,
    '9fcd1199a8f45c9c9f34b6697f29a1482efaf2e76ecc116cfcc4b86d7d3201c2',
  ],
  [
    'micromark',
    '4.0.3',
    'lib/initialize/text.js',
    false,
    '1c5682291dbb6cea7f95edeb6d50421238b91752c9e0fb9485bdde44628ce090',
  ],
  [
    'micromark',
    '4.0.3',
    'dev/lib/initialize/text.js',
    true,
    '42f71a37602a65811779e2ae2977bd968504e2b54b575c1458ebb7dd0ca4ff66',
  ],
  [
    'micromark-core-commonmark',
    '2.0.4',
    'lib/attention.js',
    false,
    'cd9329ed32379acf1e80e427124f25648fba7722886ecc0de3c5dc8551268ee4',
  ],
  [
    'micromark-core-commonmark',
    '2.0.4',
    'dev/lib/attention.js',
    true,
    'a80deb1561614d952f3b283999cc3f949f23525de164b390e8e78b151049cfea',
  ],
  [
    'micromark-extension-gfm-strikethrough',
    '2.1.0',
    'lib/syntax.js',
    false,
    '293e9b13a554fe569efd096cd7f1c3f4d6da861f30bba701e8b923f621181250',
  ],
  [
    'micromark-extension-gfm-strikethrough',
    '2.1.0',
    'dev/lib/syntax.js',
    true,
    '913b1c9346b06ab0e5825f9b2d2f85a3d0505bf9a557f488cdf07020d494d791',
  ],
]

// Reconstruct the exact predecessor retaining completed private tokenizer state.
export function withRetainedCompletedTokenizer(source, dev) {
  source = withRetainedCancelledTokenizer(source, dev)
  source = withSynchronousBlockCompilation(source, dev)
  const end = dev ? '' : ';'
  const marker = '\n// Manuslip private completed-tokenizer release.\n'
  if (source.includes(marker)) {
    assert.ok(source.endsWith('// End Manuslip private completed-tokenizer release.\n'))
    source = source.slice(0, source.indexOf(marker))
    const call = `\n    if (parser._manuslipReleaseCompleted) releaseCompletedTokenizer(context, serialization)${end}`
    assert.equal(source.split(call).length, 3, 'Both completed-tokenizer release sites')
    source = source.replaceAll(call, '')
  }
  return source.replace(`\n        parser._manuslipReleaseCompleted = true${end}`, '')
}

// Reconstruct the exact tokenizer before private document stepping was added.
export function withSynchronousDocumentTokenizer(source, _dev) {
  source = withRetainedCompletedTokenizer(source, _dev)
  const start = '  // Manuslip cooperative document tokenizer.\n'
  if (!source.includes(start)) return source
  const finish = '  // End Manuslip cooperative document tokenizer.\n'
  const from = source.indexOf(start)
  const to = source.indexOf(finish, from)
  assert.ok(from > 0 && to > from, 'Missing cooperative document tokenizer')
  return source.slice(0, from) + source.slice(to + finish.length)
}

// Reconstruct the exact compiler before cooperative whole-value preprocessing.
export function withSynchronousBlockPreprocessing(source, dev) {
  source = withRetainedCompletedTokenizer(source, dev)
  const marker = '\n// Manuslip cooperative preprocessing.\n'
  if (!source.includes(marker)) return source
  const from = source.indexOf(marker)
  assert.ok(source.endsWith('// End Manuslip cooperative preprocessing.\n'))
  source = source.slice(0, from)
  const end = dev ? '' : ';'
  const stepped = `        let chunks${end}
        try {
          chunks = options._manuslipBlockPreprocessSteps
            ? yield* preprocessSteps(value, encoding)
            : preprocess()(value, encoding, true)${end}
          value = undefined${end}
`
  assert.equal(source.split(stepped).length, 2, 'Missing cooperative preprocessing call')
  source = source.replace(
    stepped,
    `        const chunks = preprocess()(value, encoding, true)${end}\n        try {\n`,
  )
  const cleared = `          value = undefined${end}\n          if (chunks) chunks.length = 0${end}\n`
  assert.equal(source.split(cleared).length, 2, 'Missing cooperative preprocessing cleanup')
  return source.replace(cleared, `          chunks.length = 0${end}\n`)
}

// Reconstruct the exact early-handoff compiler with synchronous whole-source tokenization.
export function withSynchronousBlockTokenization(source, _dev) {
  source = withSynchronousBlockPreprocessing(source, _dev)
  const start = '      // Manuslip cooperative block-tokenization.\n'
  if (!source.includes(start)) return source
  const finish = '      // End Manuslip cooperative block-tokenization.\n'
  const from = source.indexOf(start)
  const to = source.indexOf(finish, from)
  assert.ok(from > 0 && to > from, 'Missing cooperative block tokenization')
  return source.slice(0, from) + source.slice(to + finish.length)
}

// Reconstruct the exact predecessor that accumulated all native siblings in a span.
export function withSpanBlockAccumulation(source, dev) {
  source = withSynchronousBlockTokenization(source, dev)
  const start = '\n      // Manuslip closed-block handoff.\n'
  if (!source.includes(start)) return source
  const finish = '\n      // End Manuslip closed-block handoff.'
  const from = source.indexOf(start)
  const to = source.indexOf(finish, from)
  assert.ok(from > 0 && to > from, 'Missing closed-block handoff')
  const block = source.slice(from + start.length, to)
  const end = dev ? '' : ';'
  const clear = `      streamEvents[index] = undefined${end}\n`
  assert.ok(block.startsWith(clear), 'Missing consumed event release')
  const completed = block
    .slice(clear.length)
    .replace(
      'if (context.stack.length === 1 && !context.tokenStack.length && tree.children.length)',
      'if (tree.children.length)',
    )
  source = source.slice(0, from) + source.slice(to + finish.length)
  const closed = `      if (context.stack.length !== 1 || context.tokenStack.length)\n        throw new Error('Unclosed private block-stream span')${end}\n`
  assert.equal(source.split(closed).length, 2, 'Missing closed span guard')
  return source.replace(closed, closed + completed)
}

// Reproduce the previous private compiler for isolated upgrade tests/diagnostics.
export function withRetainedSpanInput(source, dev) {
  source = withoutParserBlocks(source, dev)
  const end = dev ? '' : ';'
  const from = source.indexOf('\n  // Manuslip span compiler.\n')
  const marker = '  // End Manuslip span compiler.\n'
  const to = source.indexOf(marker, from)
  assert.ok(from > 0 && to > from, 'Missing private span compiler')
  const compile = source.slice(from, to)
  const release = `    // Prepared owns every event; drop the private input before node construction.\n    input.length = 0${end}\n`
  assert.equal(compile.split(release).length, 2, 'Missing early private input release')
  return (
    source.slice(0, from) +
    compile
      .replace(release, '')
      .replace(
        `      events.length = 0${end}`,
        `      events.length = 0${end}\n      input.length = 0${end}`,
      ) +
    source.slice(to)
  )
}

// Reconstruct the exact predecessor with whole-tree span compilation only.
export function withoutParserBlocks(source, _dev) {
  source = withSynchronousBlockPreprocessing(source, _dev)
  if (!source.includes('  // Manuslip private block-stream path.\n')) return source
  for (const [start, finish, keepFinish] of [
    [
      '  // Manuslip private block-stream path.\n',
      '  // End Manuslip private block-stream path.\n',
      false,
    ],
    [
      '  // Manuslip private block-stream compiler selection.\n',
      '  // End Manuslip private block-stream compiler selection.\n',
      false,
    ],
    ['  // Manuslip block-stream compiler.\n', '  // End Manuslip span compiler.\n', true],
  ]) {
    const from = source.indexOf(start)
    const to = source.indexOf(finish, from)
    assert.ok(from > 0 && to > from, `Missing block-stream marker: ${start}`)
    source = source.slice(0, from) + source.slice(to + (keepFinish ? 0 : finish.length))
  }
  return source
}

// Preserve the former whole-graph diagnostic path and reconstruct its exact source.
export function withoutParserSpans(source, dev) {
  source = withoutParserBlocks(source, dev)
  if (!source.includes('  // Manuslip private event-span path.')) return source
  const end = dev ? '' : ';'
  const branch = `  // Manuslip private event-span path.
  if (options && options._manuslipEventSpans) {
    return compiler(options)(eventSpans(parse(options).document().write(preprocess()(value, encoding, true))))${end}
  }
`
  source = source
    .replace(branch, '')
    .replace(
      `  return options && options._manuslipEventSpans ? compileSpans : compile${end}`,
      `  return compile${end}`,
    )
  const from = source.indexOf('\n  // Manuslip span compiler.\n')
  const marker = '  // End Manuslip span compiler.\n'
  const to = source.indexOf(marker, from)
  assert.ok(from > 0 && to > from, 'Missing private span compiler')
  source = source.slice(0, from) + source.slice(to + marker.length)
  const generator = source.lastIndexOf('\n/**\n * Resolve complete top-level spans')
  assert.ok(generator > 0, 'Missing private event-span generator')
  return source.slice(0, generator)
}

export async function originalParserSources() {
  return Promise.all(
    variants.map(async ([name, version, file, dev, originalHash]) => {
      const url = new URL(`../../../node_modules/${name}/${file}`, import.meta.url)
      const patched = (await readFile(url, 'utf8')).replaceAll('\r\n', '\n')
      if (file.endsWith('/initialize/text.js')) {
        const source = withSynchronousTextResolution(patched, dev)
        assert.equal(createHash('sha256').update(source).digest('hex'), originalHash)
        return { name, version, file, url: url.href, source, patched, originalHash }
      }
      if (
        file.endsWith('/preprocess.js') ||
        !['micromark', 'mdast-util-from-markdown'].includes(name)
      ) {
        assert.equal(createHash('sha256').update(patched).digest('hex'), originalHash)
        return { name, version, file, url: url.href, source: patched, patched, originalHash }
      }
      const tokenizer = name === 'micromark'
      const marker = tokenizer
        ? '\n/**\n * Serialize source without retaining tokenizer state'
        : '\n/**\n * Drop completed tokenizer contexts'
      let source = withoutParserSpans(withSynchronousDocumentTokenizer(patched, dev), dev)
      const boundary = source.lastIndexOf(marker)
      assert.ok(boundary > 0, `Missing lifetime patch: ${name}/${file}`)
      source = source.slice(0, boundary)
      const end = dev ? '' : ';'
      if (tokenizer) {
        source = source
          .replace(`  const serialization = {chunks}${end}\n`, '')
          .replace(
            '    sliceSerialize: detachedSerializer(serialization),\n',
            '    sliceSerialize,\n',
          )
          .replace(`    serialization.chunks = chunks${end}\n`, '')
          .replace(
            "  /** @type {TokenizeContext['sliceStream']} */",
            `  /** @type {TokenizeContext['sliceSerialize']} */\n  function sliceSerialize(token, expandTabs) {\n    return serializeChunks(sliceStream(token), expandTabs)${end}\n  }\n\n  /** @type {TokenizeContext['sliceStream']} */`,
          )
      } else {
        const original = dev
          ? `  return compiler(options)(\n    postprocess(\n      parse(options)\n        .document()\n        .write(preprocess()(value, encoding, true))\n    )\n  )`
          : '  return compiler(options)(postprocess(parse(options).document().write(preprocess()(value, encoding, true))));'
        source = source.replace(
          `  return compiler(options)(serializationEvents(postprocess(parse(options).document().write(preprocess()(value, encoding, true)))))${end}`,
          original,
        )
      }
      assert.equal(
        createHash('sha256').update(source).digest('hex'),
        originalHash,
        `Original parser fixture: ${name}/${file}`,
      )
      return { name, version, file, url: url.href, source, patched, originalHash }
    }),
  )
}

export async function originalReplaySources() {
  const hashes = [
    'a70e48d4652be4f956606dcda3e4c13707952dc74b86f6f71990eba88d4a1e79',
    'a63cb1552428d205157690b7c052b9a8bd011f94a7420e5b2c8f4765d5d67603',
  ]
  return Promise.all(
    hashes.map(async (originalHash, index) => {
      const name = 'micromark-util-subtokenize'
      const file = index ? 'dev/index.js' : 'index.js'
      const url = new URL(`../../../node_modules/${name}/${file}`, import.meta.url)
      const patched = (await readFile(url, 'utf8')).replaceAll('\r\n', '\n')
      const end = index ? '' : ';'
      const replay = `  const length = events.length${end}\n  for (let eventIndex = 0; eventIndex < length; eventIndex++) {\n    eventsArray[eventIndex] = events.get(eventIndex)${end}\n  }\n  eventsArray.length = length${end}`
      const imported = index ? 'import {codes, types}' : 'import { SpliceBuffer }'
      const source = patched
        .replace(
          replay,
          `  splice(eventsArray, 0, Number.POSITIVE_INFINITY, events.slice(0))${end}`,
        )
        .replace(
          imported,
          `import {${index ? '' : ' '}splice${index ? '' : ' '}} from 'micromark-util-chunked'${end}\n${imported}`,
        )
      assert.equal(
        createHash('sha256').update(source).digest('hex'),
        originalHash,
        `Original replay fixture: ${file}`,
      )
      return { name, version: '2.1.0', file, url: url.href, source, patched, originalHash }
    }),
  )
}
