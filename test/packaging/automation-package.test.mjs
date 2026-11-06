import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readlink, realpath, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve, sep } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses'
import { artifactHash } from '../../scripts/release-artifacts.mjs'
import { automationPackage } from '../helpers/automation-package.mjs'

const require = createRequire(import.meta.url)

test('macOS automation preserves framework links, signs the copy and leaves the source unchanged', {
  skip: process.platform !== 'darwin',
  timeout: 60000,
}, async () => {
  const source = await realpath(require('electron'))
  const sourceRoot = resolve(source, '../../..')
  const framework = 'Contents/Frameworks/Electron Framework.framework'
  const sourceBinary = join(sourceRoot, framework, 'Electron Framework')
  const before = await artifactHash(sourceBinary)
  const automation = await automationPackage(source)
  try {
    const target = resolve(automation.executable, '../../..')
    for (const link of ['Electron Framework', 'Resources', 'Versions/Current']) {
      assert.equal(
        await readlink(join(target, framework, link)),
        await readlink(join(sourceRoot, framework, link)),
      )
      assert.ok(
        (await realpath(join(target, framework, link))).startsWith(`${target}${sep}`),
        'Framework links must resolve inside the automation copy',
      )
    }
    const wire = await getCurrentFuseWire(target)
    assert.equal(wire[FuseV1Options.EnableNodeCliInspectArguments], 49)
    assert.equal(await artifactHash(sourceBinary), before)
    await promisify(execFile)('/usr/bin/codesign', ['--verify', '--deep', '--strict', target])
  } finally {
    await rm(automation.directory, { recursive: true, force: true })
  }
})
