import { readdir, readFile } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const root = fileURLToPath(new URL('..', import.meta.url))
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))
const failures = []

async function inspect(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      if (!['node_modules', 'out', 'release', 'test'].includes(entry.name)) await inspect(path)
      continue
    }
    if (!/\.tsx?$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name)) continue
    const source = parse(await readFile(path, 'utf8'), {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    })
    const location = relative(root, path).split(sep).join('/')
    function visit(node) {
      let specifier
      let typeOnly = false
      if (
        ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type)
      ) {
        specifier = node.source?.value
        typeOnly = Boolean(
          node.importKind === 'type' ||
            node.exportKind === 'type' ||
            (node.specifiers?.length > 0 &&
              node.specifiers.every(
                (item) => item.importKind === 'type' || item.exportKind === 'type',
              )),
        )
      } else if (node.type === 'ImportExpression' && node.source.type === 'StringLiteral') {
        specifier = node.source.value
      } else if (
        node.type === 'CallExpression' &&
        node.callee.type === 'Identifier' &&
        node.callee.name === 'require' &&
        node.arguments[0]?.type === 'StringLiteral'
      ) {
        specifier = node.arguments[0].value
      }
      if (specifier) {
        const target = specifier.startsWith('.')
          ? relative(root, resolve(directory, specifier)).split(sep).join('/')
          : specifier
        const forbidden =
          builtins.has(specifier) ||
          specifier === 'electron' ||
          target.startsWith('apps/desktop/src/main') ||
          target.startsWith('apps/desktop/src/preload') ||
          target.startsWith('test/') ||
          /^(?:apps|packages)\/[^/]+\/test(?:\/|$)/.test(target) ||
          (location.startsWith('packages/') && target.startsWith('apps/')) ||
          (location.startsWith('apps/desktop/src/renderer/') &&
            target.startsWith('apps/desktop/src/shared/') &&
            !typeOnly)
        if (forbidden) {
          const line = node.loc?.start.line || 1
          failures.push(`${location}:${line}: forbidden runtime dependency ${specifier}`)
        }
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
          for (const child of value) if (child && typeof child.type === 'string') visit(child)
        } else if (value && typeof value === 'object' && typeof value.type === 'string')
          visit(value)
      }
    }
    visit(source)
  }
}

for (const directory of ['apps/desktop/src/renderer', 'apps/desktop/src/shared', 'packages']) {
  await inspect(resolve(root, directory))
}
if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log('Runtime import boundaries passed')
}
