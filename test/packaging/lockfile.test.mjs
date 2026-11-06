import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { checkLockfile } from '../../scripts/check-lockfile.mjs'

const script = new URL('../../scripts/check-lockfile.mjs', import.meta.url)
const integrity = `sha512-${Buffer.alloc(64, 42).toString('base64')}`

async function fixture(context) {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-lockfile-'))
  context.after(() => rm(directory, { recursive: true, force: true, maxRetries: 3 }))
  const root = join(directory, 'project')
  await mkdir(join(root, 'packages/core'), { recursive: true })
  const manifest = { name: 'fixture', workspaces: ['packages/*'] }
  const workspace = { name: '@fixture/core', version: '1.0.0' }
  const registryPackage = {
    version: '1.0.0',
    resolved: 'https://registry.npmmirror.com/example/-/example-1.0.0.tgz',
    integrity,
  }
  const lockfile = {
    lockfileVersion: 3,
    packages: {
      '': manifest,
      'packages/core': workspace,
      'node_modules/@fixture/core': { resolved: 'packages/core', link: true },
      'node_modules/example': { ...registryPackage },
      'node_modules/parent/node_modules/nested': { ...registryPackage, dev: true },
      'packages/core/node_modules/optional': { ...registryPackage, optional: true },
    },
  }
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(root, 'packages/core/package.json'), JSON.stringify(workspace))
  const save = () => writeFile(join(root, 'package-lock.json'), JSON.stringify(lockfile))
  await save()
  return { root, directory, lockfile, save }
}

test('accepts approved HTTPS registries, nested packages and actual workspace links', async (context) => {
  const { root, lockfile, save } = await fixture(context)
  lockfile.packages['node_modules/example'].resolved =
    'https://registry.npmjs.org/example/-/example-1.0.0.tgz'
  await save()
  await checkLockfile(root)
})

for (const resolved of [
  undefined,
  'http://registry.npmmirror.com/example.tgz',
  'https://registry.npmjs.org.attacker.invalid/example.tgz',
  'https://attacker.invalid/example.tgz',
  'https://registry.npmjs.org@attacker.invalid/example.tgz',
  'https://user:secret@registry.npmjs.org/example.tgz',
  'https://registry.npmjs.org:8443/example.tgz',
  'https://registry.npmjs.org/example.tgz?redirect=elsewhere',
  'https://registry.npmjs.org/example.tgz#fragment',
  'git+https://github.com/example/package.git#commit',
  'file:../../outside',
  '../outside/package.tgz',
])
  test(`rejects an unsafe package source: ${resolved}`, async (context) => {
    const { root, lockfile, save } = await fixture(context)
    lockfile.packages['node_modules/example'].resolved = resolved
    await save()
    await assert.rejects(checkLockfile(root), /resolved must use HTTPS on an approved registry/)
  })

for (const value of [undefined, '', 'sha1-old-hash', 'sha512-not-base64', 'sha512-YQ=='])
  test(`rejects a missing or malformed integrity hash: ${value}`, async (context) => {
    const { root, lockfile, save } = await fixture(context)
    lockfile.packages['node_modules/example'].integrity = value
    await save()
    await assert.rejects(checkLockfile(root), /expected a valid SHA-512 integrity hash/)
  })

for (const location of [
  'node_modules/parent/node_modules/nested',
  'packages/core/node_modules/optional',
])
  test(`also checks nested, development and optional packages: ${location}`, async (context) => {
    const { root, lockfile, save } = await fixture(context)
    delete lockfile.packages[location].integrity
    await save()
    await assert.rejects(checkLockfile(root), /expected a valid SHA-512 integrity hash/)
  })

for (const target of ['../../outside', 'file:packages/core', 'packages/forged'])
  test(`rejects links that do not target an actual declared workspace: ${target}`, async (context) => {
    const { root, lockfile, save } = await fixture(context)
    lockfile.packages['node_modules/@fixture/core'].resolved = target
    lockfile.packages[target] = { name: '@fixture/core', version: '1.0.0' }
    await save()
    await assert.rejects(checkLockfile(root), /link must target its declared workspace/)
  })

test('rejects a workspace link installed under an unrelated package name', async (context) => {
  const { root, lockfile, save } = await fixture(context)
  lockfile.packages['node_modules/unrelated'] = { resolved: 'packages/core', link: true }
  await save()
  await assert.rejects(checkLockfile(root), /link must target its declared workspace/)
})

test('rejects a workspace redirected outside the repository by a symlink', async (context) => {
  const { root, directory } = await fixture(context)
  const outside = join(directory, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'package.json'), JSON.stringify({ name: '@fixture/outside' }))
  await symlink(
    outside,
    join(root, 'packages/outside'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  await assert.rejects(checkLockfile(root), /workspace must be a directory inside the repository/)
})

test('rejects a shrinkwrap file that would override the validated lockfile', async (context) => {
  const { root } = await fixture(context)
  await writeFile(join(root, 'npm-shrinkwrap.json'), '{}')
  await assert.rejects(checkLockfile(root), /npm-shrinkwrap.json overrides package-lock.json/)
})

test('rejects unsupported lockfile formats instead of skipping validation', async (context) => {
  const { root, lockfile, save } = await fixture(context)
  lockfile.lockfileVersion = 1
  await save()
  await assert.rejects(checkLockfile(root), /Expected an npm v3 lockfile/)
  lockfile.lockfileVersion = 3
  delete lockfile.packages
  await save()
  await assert.rejects(checkLockfile(root), /Expected an npm v3 lockfile/)
})

test('CLI validates direct and directory-aliased entrypoints without dependencies', async (context) => {
  const { root, directory, lockfile, save } = await fixture(context)
  await mkdir(join(root, 'scripts'))
  const cli = join(root, 'scripts/check-lockfile.mjs')
  await copyFile(script, cli)
  const alias = join(directory, 'project-alias')
  await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const entrypoints = [cli, join(alias, 'scripts/check-lockfile.mjs')]
  const run = (entrypoint) =>
    spawnSync(process.execPath, [entrypoint], { cwd: root, encoding: 'utf8', windowsHide: true })
  for (const entrypoint of entrypoints) {
    const valid = run(entrypoint)
    assert.equal(valid.status, 0, valid.stderr)
  }
  lockfile.packages['node_modules/example'].resolved = 'file:../../outside'
  await save()
  for (const entrypoint of entrypoints) {
    const invalid = run(entrypoint)
    assert.equal(invalid.status, 1, invalid.stderr)
    assert.match(invalid.stderr, /resolved must use HTTPS on an approved registry/)
  }
})
