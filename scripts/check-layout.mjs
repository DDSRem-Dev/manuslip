import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const failures = []
const files = []
const generated = new Set([
  '.git',
  '.omo',
  '.claude',
  '.impeccable',
  'node_modules',
  'out',
  'release',
  'dist',
])
const rootDocuments = new Set([
  'README.md',
  'README.zh-CN.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  '.github/pull_request_template.md',
])
const slash = (path) => path.split(sep).join('/')

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const path = resolve(directory, entry.name)
    const location = slash(relative(root, path))
    if (/^\.uuid(?:[.-].*)?$/.test(entry.name)) failures.push(`${location}: remove UUID metadata`)
    if (entry.isDirectory()) {
      if (
        !generated.has(entry.name) &&
        !/\btest\/artifacts(?:\/|$)/.test(location) &&
        !/^test\/(e2e|benchmark|packaging)\/(results|report)$/.test(location)
      )
        await collect(path)
    } else files.push(location)
  }
}

for (const obsolete of [
  'e2e',
  'benchmarks',
  'patches',
  '.logs',
  'benchmark-result',
  'benchmark-results',
  'test-results',
  'playwright-report',
]) {
  if (await exists(resolve(root, obsolete)))
    failures.push(`${obsolete}: use the classified docs/test directory`)
}
await collect(root)
for (const file of files) {
  if (file.endsWith('.md')) {
    if (
      !rootDocuments.has(file) &&
      !/^docs\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)+[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(file)
    )
      failures.push(`${file}: put documentation in docs/<topic>/ with a kebab-case filename`)

    const source = await readFile(resolve(root, file), 'utf8')
    let fence
    for (const [index, line] of source.split('\n').entries()) {
      const delimiter = line.match(/^\s*(`{3,}|~{3,})/)
      if (delimiter) {
        if (!fence) fence = delimiter[1]
        else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length)
          fence = undefined
        continue
      }
      if (fence) continue
      const links = line.matchAll(/(?:\]\(|^\[(?!\^)[^\]\n]+\]:\s*)<?([^\s)>]+)/g)
      for (const [, link] of links) {
        if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(link)) continue
        const target = decodeURIComponent(link.split(/[?#]/)[0])
        if (!(await exists(resolve(root, dirname(file), target))))
          failures.push(`${file}:${index + 1}: missing local link ${link}`)
      }
    }
  }
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) {
    if (
      !/^(?:apps|packages)\/[^/]+\/test\/(?:unit|integration)\/.*\.test\.tsx?$/.test(file) &&
      !/^test\/(?:e2e|benchmark)\/.*\.spec\.ts$/.test(file) &&
      !/^test\/packaging\/.*\.test\.(?:ts|mjs)$/.test(file)
    )
      failures.push(`${file}: classify tests by owning package and suite`)
  }
  if (file.startsWith('scripts/') && /\/(?:test-|profile-).+\.[cm]?js$/.test(file))
    failures.push(`${file}: move test runners and profilers into their suite`)
  if (file !== 'scripts/check-layout.mjs' && /\.[cm]?[jt]sx?$/.test(file)) {
    const source = await readFile(resolve(root, file), 'utf8')
    if (/(['"`])(?:\.logs|test-results|benchmark-results?|playwright-report)(?:\/|\1)/.test(source))
      failures.push(`${file}: write generated output inside the owning test directory`)
  }
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else console.log('Documentation links and repository test layout passed')
