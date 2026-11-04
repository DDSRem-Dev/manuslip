import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const patches = [
  {
    name: 'lifetimes',
    script: 'patch-parser-lifetimes.mjs',
    originals: 'originalParserSources',
    packages: ['micromark', 'mdast-util-from-markdown'],
    sourceError: 'Unrecognized parser lifetime source',
  },
  {
    name: 'replay',
    script: 'patch-micromark-replay.mjs',
    originals: 'originalReplaySources',
    packages: ['micromark-util-subtokenize'],
    sourceError: 'Unrecognized micromark replay source',
  },
] as const
type ParserPatch = (typeof patches)[number]

interface ParserSource {
  name: string
  version: string
  file: string
  url: string
  source: string
  patched: string
}
async function originals(patch: ParserPatch): Promise<ParserSource[]> {
  const helper = pathToFileURL(
    join(root, 'test/packaging/helpers/parser-lifetime-sources.mjs'),
  ).href
  return (await import(helper))[patch.originals]()
}

// Each historical image owns a fresh CLI fixture and the normal per-test deadline.
it.each([
  ['mdast-util-from-markdown', 'withoutParserSpans'],
  ['mdast-util-from-markdown', 'withRetainedSpanInput'],
  ['mdast-util-from-markdown', 'withoutParserBlocks'],
  ['mdast-util-from-markdown', 'withSpanBlockAccumulation'],
  ['mdast-util-from-markdown', 'withSynchronousBlockTokenization'],
  ['mdast-util-from-markdown', 'withSynchronousBlockPreprocessing'],
  ['micromark', 'withSynchronousDocumentTokenizer'],
  ['micromark', 'withRetainedCompletedTokenizer'],
  ['mdast-util-from-markdown', 'withRetainedCompletedTokenizer'],
  ['mdast-util-from-markdown', 'withSynchronousBlockCompilation'],
  ['mdast-util-from-markdown', 'withCopiedListlessSpans'],
  ['mdast-util-from-markdown', 'withPendingFinalCarriageReturn'],
  ['mdast-util-from-markdown', 'withSynchronousBlockPostprocessing'],
  ['micromark', 'withRetainedCancelledTokenizer'],
  ['micromark', 'withSynchronousTextResolution'],
  ['mdast-util-from-markdown', 'withSynchronousTextResolution'],
  ['micromark', 'withSynchronousInlineResolution'],
  ['micromark', 'withSynchronousLabelResolution'],
] as const)('upgrades the recognized %s lifetime image: %s', async (name, restoreName) => {
  const helper = await import(
    pathToFileURL(join(root, 'test/packaging/helpers/parser-lifetime-sources.mjs')).href
  )
  const restore = helper[restoreName]
  await fixture(patches[0], async (directory, sources) => {
    expect(invoke(directory).status).toBe(0)
    for (const source of sources.filter((source) => source.name === name))
      await writeFile(
        join(directory, 'node_modules', source.name, source.file),
        restore(source.patched, source.file.startsWith('dev/')),
      )
    expect(invoke(directory, '--check').status).toBe(1)
    expect(invoke(directory).status).toBe(0)
    for (const source of sources)
      expect(
        await readFile(join(directory, 'node_modules', source.name, source.file), 'utf8'),
      ).toBe(source.patched)
  })
})

async function fixture(
  patch: ParserPatch,
  run: (directory: string, sources: ParserSource[]) => Promise<void>,
) {
  const logs = join(root, 'test/packaging/result')
  await mkdir(logs, { recursive: true })
  const directory = await mkdtemp(join(logs, 'parser-lifetimes-test-'))
  if (!resolve(directory).startsWith(`${resolve(logs)}${sep}parser-lifetimes-test-`))
    throw new Error('Parser lifetime test cleanup escaped its directory')
  try {
    const sources = await originals(patch)
    await mkdir(join(directory, 'scripts'))
    await copyFile(join(root, 'scripts', patch.script), join(directory, 'scripts/patch.mjs'))
    if (patch.name === 'lifetimes')
      for (const helper of [
        'parser-compile-steps.mjs',
        'parser-text-resolve-steps.mjs',
        'parser-inline-resolve-steps.mjs',
        'parser-label-resolve-steps.mjs',
        'parser-list-preparation.mjs',
        'parser-preprocessing.mjs',
      ])
        await copyFile(join(root, 'scripts', helper), join(directory, 'scripts', helper))
    for (const source of sources) {
      const target = join(directory, 'node_modules', source.name, source.file)
      await mkdir(resolve(target, '..'), { recursive: true })
      await writeFile(target, source.source)
      await writeFile(
        join(directory, 'node_modules', source.name, 'package.json'),
        JSON.stringify({ name: source.name, version: source.version }),
      )
    }
    await run(directory, sources)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
function invoke(directory: string, ...args: string[]) {
  return spawnSync(process.execPath, [join(directory, 'scripts/patch.mjs'), ...args], {
    cwd: directory,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 10000,
  })
}

for (const patch of patches)
  describe(patch.name, () => {
    it('installs default/development exports, checks exact sources and stays idempotent', async () => {
      await fixture(patch, async (directory, sources) => {
        expect(invoke(directory, '--check').status).toBe(1)
        expect(invoke(directory).status).toBe(0)
        for (const source of sources)
          expect(
            await readFile(join(directory, 'node_modules', source.name, source.file), 'utf8'),
          ).toBe(source.patched)
        expect(invoke(directory).status).toBe(0)
        expect(invoke(directory, '--check').status).toBe(0)
      })
    })

    it('validates all files before writing and never overwrites unknown source', async () => {
      await fixture(patch, async (directory, sources) => {
        const last = sources.at(-1)
        if (!last) throw new Error('Missing parser fixture')
        const path = join(directory, 'node_modules', last.name, last.file)
        await writeFile(path, '// local change\n')
        const result = invoke(directory)
        expect(result.status).toBe(1)
        expect(result.stderr).toContain(patch.sourceError)
        for (const source of sources.slice(0, -1))
          expect(
            await readFile(join(directory, 'node_modules', source.name, source.file), 'utf8'),
          ).toBe(source.source)
        expect(await readFile(path, 'utf8')).toBe('// local change\n')
      })
    })

    it.each([...patch.packages])(
      'rejects unreviewed %s versions without modifying source',
      async (name) => {
        await fixture(patch, async (directory, sources) => {
          await writeFile(
            join(directory, 'node_modules', name, 'package.json'),
            JSON.stringify({ name, version: '99.0.0' }),
          )
          expect(invoke(directory).status).toBe(1)
          for (const source of sources)
            expect(
              await readFile(join(directory, 'node_modules', source.name, source.file), 'utf8'),
            ).toBe(source.source)
        })
      },
    )

    it('repairs known partial installation with original CRLF sources', async () => {
      await fixture(patch, async (directory, sources) => {
        expect(invoke(directory).status).toBe(0)
        for (const source of sources.filter((_, index) => index % 2))
          await writeFile(
            join(directory, 'node_modules', source.name, source.file),
            source.source.replaceAll('\n', '\r\n'),
          )
        expect(invoke(directory).status).toBe(0)
        expect(invoke(directory, '--check').status).toBe(0)
      })
    })
  })

it.each(patches)(
  'matches fresh originals for $name under both export conditions, including nested roots and rendering',
  (patch) => {
    const result = spawnSync(
      process.execPath,
      [
        join(root, 'test/packaging/helpers/compare-parser-lifetimes.mjs'),
        ...(patch.name === 'replay' ? ['--event-copy'] : []),
      ],
      {
        cwd: root,
        windowsHide: true,
        encoding: 'utf8',
        timeout: 60000,
      },
    )
    expect(result.status, result.stderr || result.stdout).toBe(0)
  },
  65000,
)
