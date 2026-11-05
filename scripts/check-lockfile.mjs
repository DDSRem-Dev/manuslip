import { glob, lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const registries = new Set(['https://registry.npmjs.org', 'https://registry.npmmirror.com'])

export async function checkLockfile(root) {
  root = await realpath(root)
  try {
    await lstat(resolve(root, 'npm-shrinkwrap.json'))
    throw new Error('npm-shrinkwrap.json overrides package-lock.json; remove it before validation')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const [manifest, lockfile] = await Promise.all(
    ['package.json', 'package-lock.json'].map(async (file) =>
      JSON.parse(await readFile(resolve(root, file), 'utf8')),
    ),
  )
  if (
    lockfile.lockfileVersion !== 3 ||
    !lockfile.packages ||
    typeof lockfile.packages !== 'object' ||
    Array.isArray(lockfile.packages) ||
    !Object.hasOwn(lockfile.packages, '')
  )
    throw new Error('Expected an npm v3 lockfile with a packages map and root entry')

  const workspaces = new Map()
  for await (const directory of glob(manifest.workspaces, {
    cwd: root,
    exclude: ['**/node_modules/**'],
  })) {
    const actual = relative(root, await realpath(resolve(root, directory)))
    if (!actual || actual === '..' || actual.startsWith(`..${sep}`) || isAbsolute(actual))
      throw new Error(`${directory}: workspace must be a directory inside the repository`)
    let source
    try {
      source = await readFile(resolve(root, directory, 'package.json'), 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue
      throw error
    }
    workspaces.set(directory.split(sep).join('/'), JSON.parse(source).name)
  }

  const failures = []
  for (const [location, pkg] of Object.entries(lockfile.packages)) {
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
      failures.push(`${location || '(root)'}: expected a package entry`)
      continue
    }
    if (location === '') continue
    if (workspaces.has(location)) {
      if (pkg.name !== workspaces.get(location) || pkg.resolved !== undefined || pkg.link)
        failures.push(`${location}: expected local workspace metadata`)
      continue
    }
    if (
      !/(^|\/)node_modules\//.test(location) ||
      location.includes('\\') ||
      location.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      failures.push(`${location}: only declared workspaces may use local package paths`)
      continue
    }
    if (pkg.link) {
      const name = workspaces.get(pkg.resolved)
      if (
        pkg.link !== true ||
        !name ||
        !Object.hasOwn(lockfile.packages, pkg.resolved) ||
        location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length) !== name
      )
        failures.push(`${location}: link must target its declared workspace`)
      continue
    }
    let url
    try {
      if (typeof pkg.resolved === 'string') url = new URL(pkg.resolved)
    } catch {}
    if (
      !url ||
      !registries.has(url.origin) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      failures.push(
        `${location}: resolved must use HTTPS on an approved registry without credentials, query or fragment`,
      )
    if (
      typeof pkg.integrity !== 'string' ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(pkg.integrity) ||
      Buffer.from(pkg.integrity.slice(7), 'base64').toString('base64') !== pkg.integrity.slice(7)
    )
      failures.push(`${location}: expected a valid SHA-512 integrity hash`)
  }
  if (failures.length) throw new Error(failures.join('\n'))
}

if (import.meta.main) {
  checkLockfile(fileURLToPath(new URL('..', import.meta.url))).then(
    () => console.log('Lockfile registry, integrity and workspace policy passed'),
    (error) => {
      console.error(error.message)
      process.exitCode = 1
    },
  )
}
