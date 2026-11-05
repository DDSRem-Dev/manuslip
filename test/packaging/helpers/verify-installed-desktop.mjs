import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron, expect } from '@playwright/test'
import { automationPackage } from '../../helpers/automation-package.mjs'
import { smokePackage } from '../hardened-smoke.mjs'

/** Smoke test the installed binary, then instrument an isolated copy for deeper checks.
 * Opens through the CLI and saves through the editor. Wizard UI, physical keyboard/IME
 * and the OS Open With chooser retain their separate manual gates.
 */
export async function verifyInstalledDesktop(executable, directory) {
  await smokePackage(executable)
  const automation = await automationPackage(executable)
  try {
    executable = automation.executable
    const path = join(directory, 'installed 世界.md')
    const profile = join(directory, 'profile')
    const initial = Buffer.from('\ufeff# Installer 世界\r\n\r\nOriginal text.\r\n')
    const edited = Buffer.from('\ufeff# Installer 世界\r\nEdited 📝.\r\n')
    await writeFile(path, initial)
    const errors = []
    let launch
    const icons = []
    for (let pass = 0; pass < 2; pass++) {
      const application = await electron.launch({
        executablePath: executable,
        args: [path],
        env: { ...process.env, MANUSLIP_TEST_PROFILE: profile },
      })
      let verified = false
      try {
        const page = await application.firstWindow()
        page.on('pageerror', (error) => errors.push(error.message))
        const runtime = await application.evaluate(({ app }) => ({
          packaged: app.isPackaged,
          appPath: app.getAppPath(),
          executable: process.execPath,
          userData: app.getPath('userData'),
          versions: process.versions,
        }))
        assert.equal(runtime.packaged, true)
        assert.equal(resolve(runtime.executable), resolve(executable))
        assert.equal(
          resolve(runtime.appPath),
          resolve(join(executable, '..', 'resources', 'app.asar')),
        )
        assert.equal(resolve(runtime.userData), resolve(profile))
        const editor = page.getByRole('textbox', { name: 'Markdown source' })
        await expect(editor).toContainText(pass ? 'Edited 📝.' : 'Original text.')
        if (process.platform === 'win32') {
          const windowHandle = await application.evaluate(({ BrowserWindow }) => {
            const handle = BrowserWindow.getAllWindows()[0].getNativeWindowHandle()
            return handle.length === 8
              ? handle.readBigUInt64LE().toString()
              : handle.readUInt32LE().toString()
          })
          const result = await promisify(execFile)(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-ExecutionPolicy',
              'Bypass',
              '-File',
              resolve('test/packaging/helpers/verify-window-icon.ps1'),
              '-WindowHandle',
              windowHandle,
              '-ExpectedIcon',
              resolve('apps/desktop/build/icons/512x512.png'),
              '-Output',
              join(directory, `installed-window-icon-${pass}.png`),
            ],
            { windowsHide: true },
          )
          icons.push(JSON.parse(result.stdout.replace(/^\ufeff/, '')))
        }
        if (!pass) {
          await editor.fill('# Installer 世界\nEdited 📝.\n')
          await expect
            .poll(async () => (await readFile(path)).toString('hex'))
            .toBe(edited.toString('hex'))
          await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
          await page.screenshot({ path: join(directory, 'installed-editor.png') })
          launch = runtime
        } else assert.deepEqual(await readFile(path), edited)
        assert.deepEqual(errors, [])
        verified = true
      } finally {
        // A failing save can leave the editor dirty; its normal quit handshake then waits
        // for a user decision. Only this isolated test instance may be forced to exit.
        if (!verified) await application.evaluate(({ app }) => app.exit(1)).catch(() => {})
        await application.close()
      }
    }
    return {
      launches: 2,
      launch,
      sourceBytes: edited.length,
      exactBomCrlfUnicodeSave: true,
      errors,
      icons,
    }
  } finally {
    await rm(automation.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
