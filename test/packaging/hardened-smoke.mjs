import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium, expect } from '@playwright/test'
import { verifyPackage } from '../../scripts/verify-package.mjs'
import { packagedExecutable } from '../helpers/packaged-executable.mjs'

/** Exercise the unchanged production binary through its renderer, without a Node inspector. */
export async function smokePackage(executable) {
  const outputs = fileURLToPath(new URL('./result', import.meta.url))
  await mkdir(outputs, { recursive: true })
  const directory = await mkdtemp(join(outputs, 'hardened-smoke-'))
  const document = join(directory, 'hardened 世界.md')
  const text = '# Protected package\n\nEdited safely 世界 📝.\n'
  await writeFile(document, '# Protected package\n\nOriginal source.\n')
  let browser
  const child = spawn(executable, ['--remote-debugging-port=0', document], {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      MANUSLIP_TEST_PROFILE: join(directory, 'profile'),
      // These must be ignored by the production fuses, otherwise startup fails.
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--require=/manuslip-must-not-load-this.cjs',
    },
  })
  const exited = once(child, 'exit').catch(() => [])
  try {
    const endpoint = await new Promise((accept, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Hardened package startup timed out')),
        30000,
      )
      let stderr = ''
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-16384)
        const url =
          /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-f0-9-]+)/i.exec(
            stderr,
          )?.[1]
        if (url) {
          clearTimeout(timeout)
          accept(url)
        }
      })
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('exit', (code) => {
        clearTimeout(timeout)
        reject(new Error(`Hardened package exited before startup (${code})`))
      })
    })
    browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 })
    const context = browser.contexts()[0]
    assert.ok(context, 'Missing production browser context')
    const page = context.pages()[0] || (await context.waitForEvent('page', { timeout: 15000 }))
    await expect(page.getByRole('textbox', { name: 'Markdown source' })).toContainText(
      'Original source.',
    )
    assert.equal(new URL(page.url()).protocol, 'manuslip-app:')
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await editor.fill(text)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
    await expect.poll(() => readFile(document, 'utf8')).toBe(text)
    assert.equal(await page.evaluate(() => typeof Reflect.get(window, 'require')), 'undefined')
    console.log(
      'Unmodified hardened package opened, edited and saved with Node environment injection disabled',
    )
  } finally {
    await browser?.close().catch(() => {})
    if (child.exitCode === null) {
      if (process.platform === 'win32')
        await promisify(execFile)('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']).catch(
          () => {},
        )
      else child.kill('SIGTERM')
    }
    await Promise.race([
      exited,
      new Promise((accept) => {
        const timer = setTimeout(accept, 5000)
        timer.unref()
      }),
    ])
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyPackage(process.env.MANUSLIP_PACKAGE_DIRECTORY || resolve('apps/desktop/release'))
  await smokePackage(packagedExecutable())
}
