import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

// Pinned traversal backport; compatibility is documented in docs/development/dependency-patches.md.
// The parser/renderer own ordinary data trees, not accessor nodes.
const directory = new URL('../node_modules/unist-util-visit-parents/', import.meta.url)
const info = JSON.parse(await readFile(new URL('package.json', directory), 'utf8'))
if (info.name !== 'unist-util-visit-parents' || info.version !== '6.0.2')
  throw new Error('Unsupported unist visitor version; review the traversal patch before upgrading')
const path = new URL('lib/index.js', directory)
const source = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n')
const hash = (value) => createHash('sha256').update(value).digest('hex')
const original = '8789a4f20d3e3c82bcaeec9628697752d662461bf6237ecfba61cfcc00f30bf7'
const patched = 'd5a4f2c07e2f4de0c3deca5a976de5cf3323a0316ad4a21b2d4a6e800d39a733'
const digest = hash(source)
if (digest !== patched) {
  if (digest !== original) throw new Error('Unrecognized unist visitor source')
  if (process.argv.includes('--check'))
    throw new Error('Unist visitor patch is missing; run npm install before checking/building')
  const start = source.indexOf('    const value = /** @type {Record<string, unknown>} */ (')
  const end = source.indexOf('    return visit\n', start)
  const result = (source.slice(0, start) + source.slice(end))
    .replace('  factory(tree, undefined, [])()', '  visit(tree, undefined, [])')
    .replace(
      '  function factory(node, index, parents) {\n    return visit\n\n    function visit() {',
      '  function visit(node, index, parents) {',
    )
    .replace(
      '            subresult = factory(child, offset, grandparents)()',
      '            subresult = visit(child, offset, grandparents)',
    )
    .replace('      return result\n    }\n  }\n}', '      return result\n  }\n}')
  if (start < 0 || end <= start || hash(result) !== patched)
    throw new Error('Invalid unist visitor patch')
  await writeFile(path, result)
}
console.log('Pinned unist traversal patch verified')
