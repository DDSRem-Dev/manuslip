import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import {
  collectReleaseArtifacts,
  listReleaseArtifacts,
  writeChecksums,
} from '../../scripts/release-artifacts.mjs'
import { releaseVersion, validateReleaseTag } from '../../scripts/release-tag.mjs'

test('rejects ambiguous tags, shell fragments and mismatched workspace versions', () => {
  for (const tag of [
    'v01.2.3',
    'v1.2.3-beta.01',
    'v1.2.3/../main',
    'main',
    'v1.2.3\n',
    'v1.2.3;echo unsafe',
    '--help',
  ])
    assert.throws(() => releaseVersion(tag, [{ version: '1.2.3' }]))
  assert.throws(
    () => releaseVersion('v1.2.3', [{ version: '1.2.3' }, { version: '1.2.4' }]),
    /must match/,
  )
  assert.deepEqual(releaseVersion('v1.2.3-beta.1', [{ version: '1.2.3-beta.1' }]), {
    version: '1.2.3-beta.1',
    prerelease: true,
  })
  assert.deepEqual(releaseVersion('v1.2.3', [{ version: '1.2.3' }]), {
    version: '1.2.3',
    prerelease: false,
  })
})

test('binds releases to the selected tag, checkout and reviewed main history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manuslip-release-tag-'))
  const execute = promisify(execFile)
  const git = async (...args) => (await execute('git', args, { cwd: root })).stdout.trim()
  const names = ['GITHUB_ACTIONS', 'GITHUB_REF', 'GITHUB_SHA']
  const previous = names.map((name) => process.env[name])
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }))
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({ packages: { '': {} } }))
    await git('init', '--initial-branch=main')
    const commit = () =>
      git(
        '-c',
        'user.name=Release fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--allow-empty',
        '-m',
        'test: create release fixture',
      )
    await commit()
    const sha = await git('rev-parse', 'HEAD')
    await git('update-ref', 'refs/remotes/origin/main', sha)
    await git('-c', 'tag.gpgsign=false', 'tag', 'v1.2.3')
    process.env.GITHUB_ACTIONS = 'true'
    process.env.GITHUB_REF = 'refs/tags/v1.2.3'
    process.env.GITHUB_SHA = sha
    assert.equal((await validateReleaseTag('v1.2.3', root)).sha, sha)
    process.env.GITHUB_REF = 'refs/heads/main'
    await assert.rejects(validateReleaseTag('v1.2.3', root), /selected version tag/)
    process.env.GITHUB_REF = 'refs/tags/v1.2.3'
    process.env.GITHUB_SHA = '0'.repeat(40)
    await assert.rejects(validateReleaseTag('v1.2.3', root), /tag moved/)
    process.env.GITHUB_SHA = sha
    await commit()
    await assert.rejects(validateReleaseTag('v1.2.3', root), /Checkout does not match/)
    await git('-c', 'tag.gpgsign=false', 'tag', '--force', 'v1.2.3')
    process.env.GITHUB_SHA = await git('rev-parse', 'HEAD')
    await assert.rejects(validateReleaseTag('v1.2.3', root))
  } finally {
    for (const [index, name] of names.entries()) {
      if (previous[index] === undefined) delete process.env[name]
      else process.env[name] = previous[index]
    }
    await rm(root, { recursive: true, force: true })
  }
})

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'manuslip-release-artifacts-'))
  const source = join(root, 'downloads')
  const destination = join(root, 'staged')
  try {
    for (const [platform, os, arch, extension] of [
      ['win32', 'win', 'x64', 'exe'],
      ['linux', 'linux', 'x64', 'AppImage'],
      ['darwin', 'mac', 'x64', 'dmg'],
      ['darwin', 'mac', 'arm64', 'dmg'],
    ]) {
      const directory = join(source, `release-${platform}-${arch}`)
      const output = join(directory, 'artifacts')
      await mkdir(output, { recursive: true })
      const prefix = `Manuslip-1.2.3-${os}-${arch}`
      await writeFile(join(output, `${prefix}.${extension}`), 'verified installer bytes')
      await writeFile(join(output, `${prefix}.cdx.json`), '{"bomFormat":"CycloneDX"}')
      const artifacts = await listReleaseArtifacts(output)
      await writeChecksums(output, artifacts)
      await writeFile(
        join(directory, 'report.json'),
        JSON.stringify({
          exitCode: 0,
          platform,
          arch,
          version: '1.2.3',
          publish: 'never',
          signedRequested: platform !== 'linux',
          signature: platform === 'linux' ? undefined : { verified: true },
          hardening: {
            fuses: {
              RunAsNode: false,
              EnableNodeOptionsEnvironmentVariable: false,
              EnableNodeCliInspectArguments: false,
              EnableEmbeddedAsarIntegrityValidation: platform !== 'linux',
              OnlyLoadAppFromAsar: true,
              GrantFileProtocolExtraPrivileges: false,
            },
          },
          artifacts,
        }),
      )
    }
    await run({ source, destination, root })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('collects the complete signed matrix and writes a combined checksum manifest', async () => {
  await fixture(async ({ source, destination }) => {
    const artifacts = await collectReleaseArtifacts(source, destination, '1.2.3')
    assert.equal(artifacts.length, 8)
    assert.equal(
      (await readFile(join(destination, 'SHA256SUMS'), 'utf8')).trim().split('\n').length,
      8,
    )
    assert.equal(
      await readFile(join(destination, 'Manuslip-1.2.3-win-x64.exe'), 'utf8'),
      'verified installer bytes',
    )
  })
})

test('refuses tampered, unsigned, incomplete and path-injected release candidates', async () => {
  for (const change of [
    'tampered',
    'unsigned',
    'missing',
    'path',
    'metadata-path',
    'duplicate',
    'inspection',
    'checksum',
  ])
    await fixture(async ({ source, destination }) => {
      const directory = join(source, 'release-win32-x64')
      const path = join(directory, 'report.json')
      const report = JSON.parse(await readFile(path, 'utf8'))
      if (change === 'tampered')
        await writeFile(
          join(directory, 'artifacts/Manuslip-1.2.3-win-x64.exe'),
          'attacker replacement',
        )
      if (change === 'unsigned') report.signature.verified = false
      if (change === 'missing') await rm(join(source, 'release-darwin-arm64'), { recursive: true })
      if (change === 'path') report.artifacts[0].name = '../../escape.exe'
      if (change === 'metadata-path') report.artifacts[0].path = '../../escape.exe'
      if (change === 'duplicate') report.artifacts.push(report.artifacts[0])
      if (change === 'inspection') report.hardening.fuses.EnableNodeCliInspectArguments = true
      if (change === 'checksum') await writeFile(join(directory, 'artifacts/SHA256SUMS'), '')
      await writeFile(path, JSON.stringify(report))
      await assert.rejects(collectReleaseArtifacts(source, destination, '1.2.3'))
      await assert.rejects(readFile(join(destination, 'Manuslip-1.2.3-win-x64.exe')))
    })
})
