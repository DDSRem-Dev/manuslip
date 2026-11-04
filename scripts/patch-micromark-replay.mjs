import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

// Replay a completed gap buffer into the caller's original event array directly.
// See docs/development/dependency-patches.md for provenance and compatibility boundaries.
const directory = new URL('../node_modules/micromark-util-subtokenize/', import.meta.url)
const info = JSON.parse(await readFile(new URL('package.json', directory), 'utf8'))
if (info.name !== 'micromark-util-subtokenize' || info.version !== '2.1.0')
  throw new Error(
    'Unsupported micromark subtokenizer version; review the replay patch before upgrading',
  )
const variants = [
  {
    file: 'index.js',
    original: 'a70e48d4652be4f956606dcda3e4c13707952dc74b86f6f71990eba88d4a1e79',
    patched: 'df2b1bc175449dee8c63ddc13a5c00abe4810ddc2019947682f21734dc8dbaef',
    end: ';',
  },
  {
    file: 'dev/index.js',
    original: 'a63cb1552428d205157690b7c052b9a8bd011f94a7420e5b2c8f4765d5d67603',
    patched: 'e44df36efa2bbf3a6da8f89efb343e373974dcadc6fde4215f863e6b2fe27065',
    end: '',
  },
]
const hash = (value) => createHash('sha256').update(value).digest('hex')
const plans = await Promise.all(
  variants.map(async (variant) => {
    const path = new URL(variant.file, directory)
    const source = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n')
    if (hash(source) === variant.patched) return undefined
    if (hash(source) !== variant.original)
      throw new Error(`Unrecognized micromark replay source: ${variant.file}`)
    if (process.argv.includes('--check'))
      throw new Error('Micromark replay patch is missing; run npm install before checking/building')
    const result = source
      .replace(
        `  splice(eventsArray, 0, Number.POSITIVE_INFINITY, events.slice(0))${variant.end}`,
        `  const length = events.length${variant.end}
  for (let eventIndex = 0; eventIndex < length; eventIndex++) {
    eventsArray[eventIndex] = events.get(eventIndex)${variant.end}
  }
  eventsArray.length = length${variant.end}`,
      )
      .replace(/import \{ ?splice ?\} from 'micromark-util-chunked';?\n/, '')
    if (hash(result) !== variant.patched)
      throw new Error(`Invalid micromark replay patch: ${variant.file}`)
    return { path, result }
  }),
)
// Validate both exports before writing either; known partial installs can be repaired.
for (const plan of plans) if (plan) await writeFile(plan.path, plan.result)
console.log('Pinned micromark replay patch verified')
