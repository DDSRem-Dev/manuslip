import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const marker = '    // Keep the untouched prefix in place; replay only changed suffixes.\n'
const variants = [
  { file: 'index.js', original: '    vecs.push(events.slice());\n    events.length = 0;\n' },
  { file: 'dev/index.js', original: '    vecs.push(events.slice())\n    events.length = 0\n' },
]

async function fixture(run: (directory: string, target: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-parser-patch-'))
  if (!resolve(directory).startsWith(`${resolve(tmpdir())}${sep}manuslip-parser-patch-`))
    throw new Error('Parser patch test cleanup escaped its temporary directory')
  try {
    const target = join(directory, 'node_modules/micromark-util-edit-map')
    await mkdir(join(target, 'dev'), { recursive: true })
    await mkdir(join(directory, 'scripts'))
    await copyFile(
      join(root, 'scripts/patch-micromark-edit-map.mjs'),
      join(directory, 'scripts/patch.mjs'),
    )
    await writeFile(
      join(target, 'package.json'),
      JSON.stringify({ name: 'micromark-util-edit-map', version: '1.0.0' }),
    )
    for (const variant of variants) {
      const source = (
        await readFile(join(root, 'node_modules/micromark-util-edit-map', variant.file), 'utf8')
      ).replaceAll('\r\n', '\n')
      await writeFile(join(target, variant.file), source.replace(marker, variant.original))
    }
    await run(directory, target)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function invoke(directory: string, ...args: string[]) {
  return spawnSync(process.execPath, [join(directory, 'scripts/patch.mjs'), ...args], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  })
}

it('requires the patch for check-only builds, installs both exports and stays idempotent', async () => {
  await fixture(async (directory, target) => {
    expect(invoke(directory, '--check').status).toBe(1)
    expect(invoke(directory).status).toBe(0)
    const contents = await Promise.all(
      variants.map((variant) => readFile(join(target, variant.file), 'utf8')),
    )
    for (const source of contents) expect(source).toContain(marker)
    expect(invoke(directory).status).toBe(0)
    expect(invoke(directory, '--check').status).toBe(0)
    expect(
      await Promise.all(variants.map((variant) => readFile(join(target, variant.file), 'utf8'))),
    ).toEqual(contents)
  })
})

it('rejects unknown source before writing the other export', async () => {
  await fixture(async (directory, target) => {
    const intact = await readFile(join(target, 'index.js'), 'utf8')
    await writeFile(join(target, 'dev/index.js'), '// unexpected local change\n')
    const result = invoke(directory)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unrecognized micromark edit-map source: dev/index.js')
    expect(await readFile(join(target, 'index.js'), 'utf8')).toBe(intact)
    expect(await readFile(join(target, 'dev/index.js'), 'utf8')).toBe(
      '// unexpected local change\n',
    )
  })
})

it('rejects an unreviewed dependency version without modifying sources', async () => {
  await fixture(async (directory, target) => {
    const before = await readFile(join(target, 'index.js'), 'utf8')
    await writeFile(
      join(target, 'package.json'),
      JSON.stringify({ name: 'micromark-util-edit-map', version: '1.0.1' }),
    )
    const result = invoke(directory)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unsupported micromark edit-map version')
    expect(await readFile(join(target, 'index.js'), 'utf8')).toBe(before)
  })
})

it('repairs a known partial installation and accepts original CRLF spelling', async () => {
  await fixture(async (directory, target) => {
    const original = await readFile(join(target, 'dev/index.js'), 'utf8')
    expect(invoke(directory).status).toBe(0)
    await writeFile(join(target, 'dev/index.js'), original.replaceAll('\n', '\r\n'))
    expect(invoke(directory).status).toBe(0)
    expect(invoke(directory, '--check').status).toBe(0)
  })
})
