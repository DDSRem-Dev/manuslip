import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { fileChannels } from '../../apps/desktop/src/shared/file-contracts'
import { launchDesktop } from './helpers'
import { capture, draft, stop } from './recovery-helpers'

test('recovery reloads after real startup storage failure and restores exact writing without restarting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-recovery-flow-')),
    profile = join(directory, 'profile')
  await mkdir(profile)
  const storage = join(profile, 'recovery')
  await writeFile(storage, 'A blocked recovery directory')
  const application = await launchDesktop(profile)
  try {
    const page = await application.firstWindow(),
      panel = page.locator('.recovery-panel')
    await expect(panel.getByRole('alert')).toContainText('Recovery drafts could not be loaded')
    await expect(page.locator('.document-notice')).toHaveCount(0)
    await capture(application, 'storage-error')
    await rm(storage)
    const second = await draft(
      profile,
      'Second 世界.md',
      '# Retained writing\n\nExact recovery 界😀\n',
    )
    const first = await draft(profile, 'First draft.md', 'Discard this draft only.', 1)
    await writeFile(second.info.displayPath, 'Original disk version')
    const reload = panel.getByRole('button', { name: 'Reload drafts', exact: true })
    await reload.focus()
    await page.keyboard.press('Enter')
    const restoreSecond = panel.getByRole('button', {
      name: 'Restore draft: Second 世界.md',
      exact: true,
    })
    const discardFirst = panel.getByRole('button', {
      name: 'Discard draft: First draft.md',
      exact: true,
    })
    await expect(panel.locator('li')).toHaveCount(2)
    await expect(
      panel.getByRole('button', { name: 'Restore draft: First draft.md', exact: true }),
    ).toBeFocused()
    await discardFirst.focus()
    await page.keyboard.press('Enter')
    await expect(panel.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(discardFirst).toBeFocused()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(discardFirst).toBeFocused()
    expect(await readFile(first.path, 'utf8')).toBe(first.bytes)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Enter')
    await expect(panel.locator('li')).toHaveCount(1)
    await expect(restoreSecond).toBeFocused()
    await expect
      .poll(async () =>
        readFile(first.path).then(
          () => true,
          () => false,
        ),
      )
      .toBe(false)
    expect(await readFile(second.path, 'utf8')).toBe(second.bytes)
    await page.keyboard.press('Enter')
    const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
    await expect(editor).toContainText('Exact recovery 界😀')
    await expect(editor).toBeFocused()
    await expect(panel).toHaveCount(0)
    const saved = join(directory, 'restored.md')
    await application.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, saved)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect
      .poll(() =>
        readFile(saved, 'utf8').catch((error) => {
          if (error.code === 'ENOENT') return null
          throw error
        }),
      )
      .toBe('# Retained writing\n\nExact recovery 界😀\n')
    expect(await readFile(second.info.displayPath, 'utf8')).toBe('Original disk version')
  } finally {
    await stop(application)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('recovery operations expose failures, block duplicate deletion and preserve later editor focus', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-recovery-pending-')),
    profile = join(directory, 'profile')
  const retained = await draft(profile, 'Kept draft.md', 'Retained source')
  const application = await launchDesktop(profile)
  try {
    const page = await application.firstWindow(),
      panel = page.locator('.recovery-panel')
    await expect(panel.locator('li')).toHaveCount(1)
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    await application.evaluate(({ ipcMain }, channel) => {
      const probe = { calls: 0, resolve: null as ((value: unknown) => void) | null }
      Object.assign(globalThis, { recoveryProbe: probe })
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, () => {
        probe.calls++
        return new Promise((resolve) => {
          probe.resolve = resolve
        })
      })
    }, fileChannels.discardRecovery)
    const discard = panel.getByRole('button', { name: 'Discard draft: Kept draft.md', exact: true })
    await discard.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Enter')
    await expect(panel.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
    await expect(page.getByRole('status').filter({ hasText: 'Discarding draft…' })).toHaveCount(1)
    expect(
      await application.evaluate(
        () => (globalThis as unknown as { recoveryProbe: { calls: number } }).recoveryProbe.calls,
      ),
    ).toBe(1)
    const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
    await editor.fill('Continue writing while recovery waits.')
    await application.evaluate(() => {
      ;(
        globalThis as unknown as { recoveryProbe: { resolve(value: unknown): void } }
      ).recoveryProbe.resolve({ ok: false, code: 'recovery-io', error: 'PRIVATE_RECOVERY_FAILURE' })
    })
    await expect(panel.getByRole('alert')).toContainText('This draft could not be discarded')
    await expect(editor).toBeFocused()
    await expect(editor).toHaveText('Continue writing while recovery waits.')
    await expect(page.locator('body')).not.toContainText('PRIVATE_RECOVERY_FAILURE')
    expect(await readFile(retained.path, 'utf8')).toBe(retained.bytes)
    await panel.getByRole('button', { name: 'Cancel', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(discard).toBeFocused()
    await discard.press('Enter')
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Enter')
    await expect
      .poll(() =>
        application.evaluate(
          () => (globalThis as unknown as { recoveryProbe: { calls: number } }).recoveryProbe.calls,
        ),
      )
      .toBe(2)
    await application.evaluate(() => {
      ;(
        globalThis as unknown as { recoveryProbe: { resolve(value: unknown): void } }
      ).recoveryProbe.resolve({ ok: false, code: 'recovery-io', error: 'PRIVATE_RECOVERY_FAILURE' })
    })
    await expect(discard).toBeFocused()
    await capture(application, 'discard-error')
  } finally {
    await stop(application)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('slow recovery loading leaves file opening and editing available, with list and restore retry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-recovery-loading-'))
  const profile = join(directory, 'profile')
  const retained = await draft(profile, 'Recover later.md', 'Retained draft')
  const sourcePath = join(directory, 'editable.md')
  await writeFile(sourcePath, '# Editable while recovery loads\n')
  const application = await launchDesktop(profile)
  try {
    const page = await application.firstWindow(),
      panel = page.locator('.recovery-panel')
    await expect(panel.locator('li')).toHaveCount(1)
    const entries = await page.evaluate(() => window.manuslip.listRecoveries())
    if (!entries.ok) throw new Error('Missing recovery fixture')
    await application.evaluate(
      ({ ipcMain }, { channels, entries }) => {
        const probe = { calls: 0, resolve: null as ((value: unknown) => void) | null }
        Object.assign(globalThis, { recoveryListProbe: probe })
        ipcMain.removeHandler(channels.recoveries)
        ipcMain.handle(channels.recoveries, () => {
          if (++probe.calls > 1) return { ok: true, value: entries }
          return new Promise((resolve) => {
            probe.resolve = resolve
          })
        })
        ipcMain.removeHandler(channels.restoreRecovery)
        ipcMain.handle(channels.restoreRecovery, () => ({
          ok: false,
          code: 'recovery-io',
          error: 'PRIVATE_RESTORE_ERROR',
        }))
      },
      { channels: fileChannels, entries: entries.value },
    )
    await page.reload()
    await expect(panel.getByText('Loading recovery drafts…', { exact: true })).toBeVisible()
    await application.evaluate(
      ({ app }, path) => app.emit('open-file', { preventDefault() {} }, path),
      sourcePath,
    )
    const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
    await expect(editor).toContainText('Editable while recovery loads')
    await editor.fill('Typing remains available.')
    await capture(application, 'recovery-loading')
    await application.evaluate(() => {
      ;(
        globalThis as unknown as { recoveryListProbe: { resolve(value: unknown): void } }
      ).recoveryListProbe.resolve({ ok: false, code: 'recovery-io', error: 'PRIVATE_LIST_ERROR' })
    })
    await expect(panel.getByRole('alert')).toContainText('Recovery drafts could not be loaded')
    await expect(editor).toBeFocused()
    const reload = panel.getByRole('button', { name: 'Reload drafts', exact: true })
    await reload.focus()
    await page.keyboard.press('Enter')
    const restore = panel.getByRole('button', {
      name: 'Restore draft: Recover later.md',
      exact: true,
    })
    await expect(restore).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(panel.getByRole('alert')).toContainText('This draft could not be restored')
    await expect(restore).toBeFocused()
    await expect(page.getByRole('tab')).toHaveCount(1)
    await expect(editor).toHaveText('Typing remains available.')
    await expect(page.locator('body')).not.toContainText('PRIVATE_')
    expect(await readFile(retained.path, 'utf8')).toBe(retained.bytes)
    await capture(application, 'restore-error')
  } finally {
    await stop(application)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
