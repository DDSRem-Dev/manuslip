import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

// Pinned backport: preserve the dense event array's untouched prefix in consume().
// See docs/patches/micromark-edit-map.md for provenance, compatibility and verification.
const directory = new URL('../node_modules/micromark-util-edit-map/', import.meta.url)
const packageInfo = JSON.parse(await readFile(new URL('package.json', directory), 'utf8'))
if (packageInfo.name !== 'micromark-util-edit-map' || packageInfo.version !== '1.0.0')
  throw new Error(
    'Unsupported micromark edit-map version; review the parser patch before upgrading',
  )
const variants = [
  {
    file: 'index.js',
    original: '0a29b60e6299a7b17e57e3c185014ad9bfe5a0ad6fd1365ce14605d6d299cbf0',
    patched: '408969817f19a85e70fe86ec0d850d9398c128bbe4f9b6f093fa10228b24df67',
    remove: '    vecs.push(events.slice());\n    events.length = 0;\n',
  },
  {
    file: 'dev/index.js',
    original: '98048a86eeaf5d5b9c85715c124bd5865685a964cabe2a77e5039bf11d987017',
    patched: 'd498191cc0fbd7e152e56704d7f2878703f28cae681b42312b2b3e9cfe9c4118',
    remove: '    vecs.push(events.slice())\n    events.length = 0\n',
  },
]
const hash = (source) => createHash('sha256').update(source).digest('hex')
// Validate every input before writing either export. Both known states permit retry after
// an interrupted install; unknown content fails closed instead of replacing local changes.
const plans = await Promise.all(
  variants.map(async (variant) => {
    const path = new URL(variant.file, directory)
    const source = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n')
    const digest = hash(source)
    if (digest === variant.patched) return undefined
    if (digest !== variant.original)
      throw new Error(`Unrecognized micromark edit-map source: ${variant.file}`)
    if (process.argv.includes('--check'))
      throw new Error('Parser event-map patch is missing; run npm install before checking/building')
    const patched = source.replace(
      variant.remove,
      '    // Keep the untouched prefix in place; replay only changed suffixes.\n',
    )
    if (hash(patched) !== variant.patched)
      throw new Error(`Invalid micromark edit-map patch: ${variant.file}`)
    return { path, patched }
  }),
)
for (const plan of plans) if (plan) await writeFile(plan.path, plan.patched)
console.log('Pinned micromark event-map patch verified')
