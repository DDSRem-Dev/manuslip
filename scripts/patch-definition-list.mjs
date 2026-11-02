import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

// Pinned GFM-table compatibility fix; see docs/patches/definition-list.md.
const directory = new URL('../node_modules/micromark-extension-definition-list/', import.meta.url)
const metadata = JSON.parse(await readFile(new URL('package.json', directory), 'utf8'))
if (metadata.name !== 'micromark-extension-definition-list' || metadata.version !== '2.0.2')
  throw new Error('Unsupported definition-list version; review the table compatibility patch')
const files = [
  [
    'lib/syntax.js',
    '276e9fbbf8d512eb9648748060fb8a623fc8caeff829a7581f516338796c6dcb',
    '95238dfb983f44e8337ce802fb6bcc22dc13eec6f641450909b61d27db08848d',
  ],
  [
    'dev/lib/syntax.js',
    '07c8c7e0273c2b0a8837ea85344bd92555ba90795c800a519594471e1690b8c5',
    '90b0092365453803506729e650442f4dd533a4dc25c16f74be59263d77f6610d',
  ],
]
const helper = `// A tentative GFM header can still become a definition term. A committed table
// body cannot: interrupting it would turn a colon-prefixed cell into prose.
function isPendingTableHead(events, index) {
  const token = events[index][1];
  if (token.type === 'tableHead') return !token.end;
  if (token.type !== 'tableRow') return false;
  while (index > 0) {
    const event = events[index];
    if (event[0] === 'enter' && event[1] === token) {
      const before = events[index - 1];
      return before[0] === 'enter' && before[1].type === 'tableHead' && !before[1].end;
    }
    index--;
  }
  return false;
}
`
const hash = (text) => createHash('sha256').update(text).digest('hex')
for (const [name, original, patched] of files) {
  const path = new URL(name, directory),
    source = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n')
  const digest = hash(source)
  if (digest === patched) continue
  if (digest !== original) throw new Error(`Unrecognized definition-list source: ${name}`)
  if (process.argv.includes('--check'))
    throw new Error('Definition-list patch is missing; run npm install')
  const pattern = /\s*\|\|\s*tmpToken.type === 'tableHead'\s*\|\|\s*tmpToken.type === 'tableRow'/g
  if ([...source.matchAll(pattern)].length !== 1)
    throw new Error('Invalid definition-list patch target')
  const result = source
    .replace(pattern, ' || isPendingTableHead(flowEvents, i)')
    .replace(
      'const ignorablePrefixTypes = new Set([',
      "const ignorablePrefixTypes = new Set(['listItemIndent', ",
    )
    .replace(
      'function checkPossibleDefTerm(events) {',
      `${helper}function checkPossibleDefTerm(events) {`,
    )
  if (hash(result) !== patched) throw new Error(`Invalid definition-list patch: ${name}`)
  await writeFile(path, result)
}
console.log('Pinned definition-list table compatibility patch verified')
