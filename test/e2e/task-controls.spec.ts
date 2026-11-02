import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchDesktop } from './helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('task targets replace unordered bullets and remain usable in light, dark and narrow layouts', async () => {
  await mkdir('test/artifacts/logs', { recursive: true })
  const directory = await mkdtemp(resolve('test/artifacts/logs/task-controls-layout-'))
  const application = await launchDesktop(resolve(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
    const source =
      '# Tasks\n\n- [ ] Read the draft\n- [x] Keep the source\n- Regular item\n  - [ ] Nested task\n\n1. [ ] Ordered task\n\n> - [ ] Quoted task\n\n- [not] Ordinary bracket text\n\nEnd\n'
    await editor.fill(source)
    await editor.press(`${modifier}+Home`)
    const checks = page.getByRole('checkbox', { name: 'Toggle task', exact: true })
    await expect(checks).toHaveCount(5)
    await expect(page.locator('.cm-live-bullet')).toHaveCount(2)
    const observations = []
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: 'Preferences', exact: true }).click()
      await page.getByLabel('Appearance', { exact: true }).selectOption(theme)
      await page.getByRole('button', { name: 'Close preferences', exact: true }).click()
      if (theme === 'dark')
        await application.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0]
          window?.setMinimumSize(0, 0)
          window?.setContentSize(360, 800)
        })
      const targets = await page.locator('.cm-live-task').evaluateAll((labels) =>
        labels.map((label) => {
          const bounds = label.getBoundingClientRect()
          const input = label.querySelector('input')?.getBoundingClientRect()
          return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, input }
        }),
      )
      expect(targets).toHaveLength(5)
      for (const target of targets) {
        expect(target.width).toBeGreaterThanOrEqual(24)
        expect(target.height).toBeGreaterThanOrEqual(24)
        expect(target.input?.width).toBe(18)
      }
      for (let index = 1; index < targets.length; index++) {
        const previous = targets[index - 1]
        const next = targets[index]
        expect(next?.y).toBeGreaterThanOrEqual((previous?.y || 0) + (previous?.height || 0))
      }
      observations.push({ theme, targets })
      await checks.first().uncheck()
      // The label edge is outside the visible 18px input, but remains a native target.
      await page
        .locator('.cm-live-task')
        .first()
        .click({ position: { x: 1, y: 12 } })
      await expect(checks.first()).toBeChecked()
      await page.getByRole('button', { name: 'Source', exact: true }).click()
      await expect
        .poll(async () => (await editor.locator('.cm-line').allTextContents()).join('\n'))
        .toBe(source.replace('- [ ] Read the draft', '- [x] Read the draft'))
      await editor.press(`${modifier}+Home`)
      await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
      await expect(checks).toHaveCount(5)
      await expect(page.locator('.cm-live-bullet')).toHaveCount(2)
    }
    await test.info().attach('task-targets', {
      body: JSON.stringify(observations),
      contentType: 'application/json',
    })
  } finally {
    await application
      .evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy()
      })
      .catch(() => {})
    await application.close()
  }
})

test('keyboard task toggles preserve focus and undo, and follow a pending document lock', async () => {
  await mkdir('test/artifacts/logs', { recursive: true })
  const directory = await mkdtemp(resolve('test/artifacts/logs/task-controls-keyboard-'))
  const application = await launchDesktop(resolve(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    const editor = page.getByRole('textbox', { name: 'Markdown source', exact: true })
    const source = '# Tasks\n\n- [ ] First task\n- [x] Second task\n\nEnd\n'
    await editor.fill(source)
    await editor.press(`${modifier}+Home`)
    const checks = page.getByRole('checkbox', { name: 'Toggle task', exact: true })
    await expect(checks).toHaveCount(2)
    await checks.first().focus()
    await page.keyboard.press('Space')
    await expect(checks.first()).toBeChecked()
    await expect(checks.first()).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(checks.nth(1)).toBeFocused()
    await page.keyboard.press('Space')
    await expect(checks.nth(1)).not.toBeChecked()
    await expect(checks.nth(1)).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(checks.first()).toBeFocused()
    await page.keyboard.press('Space')
    await expect(checks.first()).not.toBeChecked()
    await expect(checks.first()).toBeFocused()
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    const text = async () => (await editor.locator('.cm-line').allTextContents()).join('\n')
    await expect.poll(text).toBe(source.replace('[x] Second', '[ ] Second'))
    await editor.focus()
    await page.keyboard.press(`${modifier}+z`)
    await expect
      .poll(text)
      .toBe(source.replace('[ ] First', '[x] First').replace('[x] Second', '[ ] Second'))
    await page.keyboard.press(`${modifier}+z`)
    await expect.poll(text).toBe(source.replace('[ ] First', '[x] First'))
    await page.keyboard.press(`${modifier}+z`)
    await expect.poll(text).toBe(source)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y')
    const toggled = source.replace('[ ] First', '[x] First')
    await expect.poll(text).toBe(toggled)
    await editor.press(`${modifier}+Home`)
    await page.getByRole('button', { name: 'Live Preview', exact: true }).click()
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => {
        await new Promise<void>((resolve) => {
          ;(globalThis as typeof globalThis & { finishTaskClose?: () => void }).finishTaskClose =
            resolve
        })
        return { response: 2, checkboxChecked: false }
      }
    })
    await page.getByRole('button', { name: /^Close Untitled / }).click()
    await expect
      .poll(() =>
        application.evaluate(
          () =>
            typeof (globalThis as typeof globalThis & { finishTaskClose?: () => void })
              .finishTaskClose,
        ),
      )
      .toBe('function')
    for (const check of await checks.all()) await expect(check).toBeDisabled()
    await application.evaluate(() => {
      const state = globalThis as typeof globalThis & { finishTaskClose?: () => void }
      state.finishTaskClose?.()
      delete state.finishTaskClose
    })
    for (const check of await checks.all()) await expect(check).toBeEnabled()
    await expect(checks.first()).toBeChecked()
    await expect(checks.nth(1)).toBeChecked()
    await page.emulateMedia({ forcedColors: 'active' })
    await checks.first().focus()
    await page.keyboard.press('Tab')
    await expect(checks.nth(1)).toBeFocused()
    expect(
      await checks.nth(1).evaluate((element) => {
        const style = getComputedStyle(element)
        return (
          element.matches(':focus-visible') &&
          style.outlineStyle !== 'none' &&
          Number.parseFloat(style.outlineWidth) >= 2
        )
      }),
    ).toBe(true)
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await expect.poll(text).toBe(toggled)
  } finally {
    await application
      .evaluate(({ BrowserWindow }) => {
        const state = globalThis as typeof globalThis & { finishTaskClose?: () => void }
        state.finishTaskClose?.()
        delete state.finishTaskClose
        for (const window of BrowserWindow.getAllWindows()) window.destroy()
      })
      .catch(() => {})
    await application.close()
  }
})
