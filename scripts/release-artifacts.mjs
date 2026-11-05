import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function artifactHash(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function listReleaseArtifacts(directory) {
  const artifacts = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      entry.name.startsWith('.') ||
      entry.name.startsWith('builder-') ||
      entry.name === 'SHA256SUMS'
    )
      continue
    const path = join(directory, entry.name)
    artifacts.push({
      name: entry.name,
      bytes: (await lstat(path)).size,
      sha256: await artifactHash(path),
    })
  }
  return artifacts.sort((a, b) => a.name.localeCompare(b.name))
}

export async function writeChecksums(directory, artifacts) {
  await writeFile(
    join(directory, 'SHA256SUMS'),
    artifacts.map((row) => `${row.sha256}  ${row.name}\n`).join(''),
    { flag: 'wx' },
  )
}

/** Reject incomplete, unsigned, renamed or modified platform artifacts before any release write. */
export async function collectReleaseArtifacts(source, destination, version) {
  assert.match(version, /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/)
  const matrix = [
    ['win32', 'win', 'x64', 'exe'],
    ['linux', 'linux', 'x64', 'AppImage'],
    ['darwin', 'mac', 'x64', 'dmg'],
    ['darwin', 'mac', 'arm64', 'dmg'],
  ]
  const accepted = []
  for (const [platform, os, arch, extension] of matrix) {
    const directory = join(source, `release-${platform}-${arch}`)
    const reportPath = join(directory, 'report.json')
    assert.ok(
      (await lstat(reportPath)).isFile() && !(await lstat(reportPath)).isSymbolicLink(),
      'Invalid release report',
    )
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    assert.equal(report.exitCode, 0, 'Release build failed')
    assert.equal(report.platform, platform)
    assert.equal(report.arch, arch)
    assert.equal(report.version, version)
    assert.equal(report.publish, 'never')
    assert.equal(
      report.signedRequested,
      platform !== 'linux',
      'Public Windows/macOS artifacts must be signed',
    )
    if (platform !== 'linux')
      assert.equal(report.signature?.verified, true, 'Native signatures were not verified')
    assert.ok(report.hardening?.fuses)
    assert.equal(report.hardening.fuses.RunAsNode, false)
    assert.equal(report.hardening.fuses.EnableNodeOptionsEnvironmentVariable, false)
    assert.equal(report.hardening.fuses.EnableNodeCliInspectArguments, false)
    assert.equal(report.hardening.fuses.OnlyLoadAppFromAsar, true)
    assert.equal(report.hardening.fuses.GrantFileProtocolExtraPrivileges, false)
    assert.equal(report.hardening.fuses.EnableEmbeddedAsarIntegrityValidation, platform !== 'linux')
    const prefix = `Manuslip-${version}-${os}-${arch}`
    const required = [`${prefix}.${extension}`, `${prefix}.cdx.json`]
    const allowed = new Set([...required, `${prefix}.${extension}.blockmap`])
    const seen = new Set()
    for (const row of report.artifacts) {
      assert.deepEqual(
        Object.keys(row).sort(),
        ['bytes', 'name', 'sha256'],
        'Invalid asset metadata',
      )
      assert.ok(
        allowed.has(row.name) && !seen.has(row.name),
        'Unexpected or duplicate release asset',
      )
      assert.equal(basename(row.name), row.name)
      seen.add(row.name)
      const path = join(directory, 'artifacts', row.name)
      const metadata = await lstat(path)
      assert.ok(
        metadata.isFile() && !metadata.isSymbolicLink(),
        'Release asset must be a regular file',
      )
      assert.equal(metadata.size, row.bytes)
      assert.equal(await artifactHash(path), row.sha256, `Artifact checksum differs: ${row.name}`)
      accepted.push({ name: row.name, bytes: row.bytes, sha256: row.sha256, path })
    }
    assert.ok(
      required.every((name) => seen.has(name)),
      'Missing installer or SBOM',
    )
    const checksum = report.artifacts.map((row) => `${row.sha256}  ${row.name}\n`).join('')
    assert.equal(await readFile(join(directory, 'artifacts/SHA256SUMS'), 'utf8'), checksum)
  }
  await mkdir(destination, { recursive: true })
  assert.equal((await readdir(destination)).length, 0, 'Release staging directory must be empty')
  for (const row of accepted) await copyFile(row.path, join(destination, row.name))
  await writeChecksums(
    destination,
    accepted.sort((a, b) => a.name.localeCompare(b.name)),
  )
  return accepted
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  collectReleaseArtifacts(
    resolve('test/packaging/result/downloads'),
    resolve('test/packaging/result/staged'),
    process.env.MANUSLIP_RELEASE_VERSION || '',
  ).then(
    (artifacts) => console.log(`Verified and staged ${artifacts.length} release assets`),
    (error) => {
      console.error(error.message)
      process.exitCode = 1
    },
  )
}
