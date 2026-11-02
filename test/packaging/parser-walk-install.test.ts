import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const prelude = `    const value = /** @type {Record<string, unknown>} */ (
      node && typeof node === 'object' ? node : {}
    )

    if (typeof value.type === 'string') {
      const name =
        // \x60hast\x60
        typeof value.tagName === 'string'
          ? value.tagName
          : // \x60xast\x60
            typeof value.name === 'string'
            ? value.name
            : undefined

      Object.defineProperty(visit, 'name', {
        value:
          'node (' + color(node.type + (name ? '<' + name + '>' : '')) + ')'
      })
    }

`
function upstream(source: string): string {
  return source
    .replace('  visit(tree, undefined, [])', '  factory(tree, undefined, [])()')
    .replace(
      '  function visit(node, index, parents) {',
      `  function factory(node, index, parents) {\n${prelude}    return visit\n\n    function visit() {`,
    )
    .replace(
      '            subresult = visit(child, offset, grandparents)',
      '            subresult = factory(child, offset, grandparents)()',
    )
    .replace('      return result\n  }\n}', '      return result\n    }\n  }\n}')
}
async function fixture(run: (directory: string, target: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-walk-patch-'))
  if (!resolve(directory).startsWith(`${resolve(tmpdir())}${sep}manuslip-walk-patch-`))
    throw new Error('Traversal patch test cleanup escaped its temporary directory')
  try {
    const target = join(directory, 'node_modules/unist-util-visit-parents')
    await mkdir(join(target, 'lib'), { recursive: true })
    await mkdir(join(directory, 'scripts'))
    await copyFile(
      join(root, 'scripts/patch-unist-visit.mjs'),
      join(directory, 'scripts/patch.mjs'),
    )
    await writeFile(
      join(target, 'package.json'),
      JSON.stringify({ name: 'unist-util-visit-parents', version: '6.0.2' }),
    )
    const source = (
      await readFile(join(root, 'node_modules/unist-util-visit-parents/lib/index.js'), 'utf8')
    ).replaceAll('\r\n', '\n')
    await writeFile(join(target, 'lib/index.js'), upstream(source))
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

it('requires the traversal patch and applies idempotently after original CRLF installation', async () => {
  await fixture(async (directory, target) => {
    const path = join(target, 'lib/index.js')
    const original = await readFile(path, 'utf8')
    const missing = invoke(directory, '--check')
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('Unist visitor patch is missing')
    await writeFile(path, original.replaceAll('\n', '\r\n'))
    expect(invoke(directory).status).toBe(0)
    const patched = await readFile(path, 'utf8')
    expect(patched).not.toContain('Object.defineProperty(visit')
    expect(patched).not.toContain('factory(child')
    expect(invoke(directory).status).toBe(0)
    expect(invoke(directory, '--check').status).toBe(0)
    expect(await readFile(path, 'utf8')).toBe(patched)
    expect(upstream(patched)).toBe(original)
  })
})

it('refuses unreviewed traversal contents and versions without replacing sources', async () => {
  await fixture(async (directory, target) => {
    const path = join(target, 'lib/index.js')
    await writeFile(path, '// local changes\n')
    expect(invoke(directory).stderr).toContain('Unrecognized unist visitor source')
    expect(await readFile(path, 'utf8')).toBe('// local changes\n')
    await writeFile(
      join(target, 'package.json'),
      JSON.stringify({ name: 'unist-util-visit-parents', version: '6.0.3' }),
    )
    expect(invoke(directory).stderr).toContain('Unsupported unist visitor version')
    expect(await readFile(path, 'utf8')).toBe('// local changes\n')
  })
})
