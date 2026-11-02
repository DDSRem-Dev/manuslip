import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** Retain the exact build inputs, emitted assets and Worker profile associations. */
export async function createSemanticServiceEvidence(directory) {
  const root = resolve('.')
  const normalizedRoot = `${root.replaceAll('\\', '/')}/`
  const sources = new Map()
  const profiles = []
  let buildRoot
  let assets = []
  await mkdir(resolve(directory, 'sources'))
  const retain = (path, role, code) => {
    const bytes = readFileSync(resolve(root, path))
    if (code !== undefined)
      assert.equal(Buffer.from(code).toString(), bytes.toString(), `Loaded source differs: ${path}`)
    const hash = sha256(bytes)
    const existing = sources.get(path)
    if (existing) {
      assert.equal(hash, existing.sha256, `Input changed during diagnostic: ${path}`)
      if (!existing.roles.includes(role)) existing.roles.push(role)
    } else {
      const archive = `sources/${hash}`
      sources.set(path, { path, bytes: bytes.length, sha256: hash, archive, roles: [role] })
      writeFileSync(resolve(directory, archive), bytes)
    }
  }
  for (const path of [
    'package.json',
    'package-lock.json',
    'test/benchmark/profiles/profile-semantic-service.mjs',
    'test/benchmark/helpers/semantic-service-worker-cpu.mjs',
    'test/benchmark/helpers/semantic-service-evidence.mjs',
    'test/benchmark/fixtures/semantic-corpus.mjs',
    'test/benchmark/fixtures/packed-memory/main.cjs',
  ])
    retain(path, 'driver')
  // Vite delegates external oracle dependencies to Node. Bind those actual loads
  // without routing CommonJS packages through the ESM transform pipeline.
  const nativeHook = registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context)
      if (url.startsWith('file:')) {
        const path = fileURLToPath(url).replaceAll('\\', '/')
        if (path.startsWith(normalizedRoot) && /\.[cm]?js$/.test(path))
          retain(path.slice(normalizedRoot.length), 'node', result.source ?? undefined)
      }
      return result
    },
  })
  return {
    plugin(role) {
      return {
        name: `semantic-service-source-binding-${role}`,
        enforce: 'pre',
        transform(code, id) {
          const path = id.replaceAll('\\', '/')
          if (path.startsWith(normalizedRoot) && /\.[cm]?[jt]sx?$/.test(path))
            retain(path.slice(normalizedRoot.length), role, code)
        },
      }
    },
    async bindBuild(buildDirectory) {
      buildRoot = resolve(buildDirectory)
      const entries = []
      const walk = async (directory) => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const path = resolve(directory, entry.name)
          if (entry.isDirectory()) await walk(path)
          else {
            assert.ok(entry.isFile(), `Unexpected build entry: ${path}`)
            const bytes = await readFile(path)
            entries.push({
              path: relative(buildDirectory, path).split(sep).join('/'),
              bytes: bytes.length,
              sha256: sha256(bytes),
            })
          }
        }
      }
      await walk(buildRoot)
      assets = entries.sort((a, b) => a.path.localeCompare(b.path))
      assert.ok(assets.some((asset) => /packed-semantic\.worker-.*\.js$/.test(asset.path)))
      return assets
    },
    async recordProfile(name, revision, targetInfo, profile, origin) {
      assert.match(name, /^[a-z][a-z0-9-]*$/)
      assert.ok(Number.isSafeInteger(revision) && revision >= 0)
      assert.ok(!profiles.some((row) => row.name === name && row.revision === revision))
      const url = new URL(targetInfo.url)
      assert.equal(url.origin, origin, 'Profile target must belong to this diagnostic server')
      const assetPath = decodeURIComponent(url.pathname).replace(/^\//, '')
      const asset = assets.find((row) => row.path === assetPath)
      assert.ok(asset && /packed-semantic\.worker-.*\.js$/.test(asset.path))
      assert.ok(
        profile.nodes.some((node) => node.callFrame.url === targetInfo.url),
        'CPU profile must include the actual application Worker asset',
      )
      const path = `${name}-${revision}.cpuprofile`
      const bytes = Buffer.from(JSON.stringify(profile))
      await writeFile(resolve(directory, path), bytes, { flag: 'wx' })
      const row = {
        name,
        revision,
        targetInfo,
        asset,
        path,
        bytes: bytes.length,
        sha256: sha256(bytes),
        samples: profile.samples.length,
      }
      profiles.push(row)
      return row
    },
    async finish() {
      nativeHook.deregister()
      for (const row of sources.values()) {
        assert.equal(sha256(await readFile(resolve(root, row.path))), row.sha256)
        assert.equal(sha256(await readFile(resolve(directory, row.archive))), row.sha256)
      }
      for (const row of assets)
        assert.equal(sha256(await readFile(resolve(buildRoot, row.path))), row.sha256)
      for (const row of profiles)
        assert.equal(sha256(await readFile(resolve(directory, row.path))), row.sha256)
      const result = {
        node: process.version,
        sources: [...sources.values()].sort((a, b) => a.path.localeCompare(b.path)),
        assets,
        profiles,
      }
      await writeFile(resolve(directory, 'evidence.json'), `${JSON.stringify(result, null, 2)}\n`)
      return result
    },
  }
}
