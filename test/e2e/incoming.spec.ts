import { type ChildProcess, spawn } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { contrast, launchDesktop } from './helpers'

test('OS launch paths and later launches open tabs without replacing a dirty draft', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'manuslip-native-open-')))
  const profile = join(directory, 'profile')
  const saved = join(directory, 'previous.md'),
    first = join(directory, '启动.md'),
    later = join(directory, 'later launch.md')
  await mkdir(profile)
  await writeFile(saved, '# Previous')
  await writeFile(first, '# First launch')
  await writeFile(later, '# Later launch')
  await writeFile(
    join(profile, 'workspace-state.json'),
    JSON.stringify({
      schemaVersion: 1,
      root: null,
      recents: [],
      documents: [saved],
      activePath: saved,
    }),
  )
  const application = await launchDesktop(profile, [first])
  let child: ChildProcess | null = null
  try {
    const page = await application.firstWindow()
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await expect(page.getByRole('tab')).toHaveCount(2)
    await expect(editor).toContainText('First launch')
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    await editor.fill('dirty draft survives another launch')
    const executable = await application.evaluate(({ app }) => app.getPath('exe'))
    child = spawn(
      executable,
      process.env.MANUSLIP_PACKAGED_EXECUTABLE ? [later] : [resolve('apps/desktop'), later],
      {
        env: { ...process.env, MANUSLIP_TEST_PROFILE: profile },
        stdio: 'ignore',
        windowsHide: true,
      },
    )
    await expect.poll(() => child?.exitCode).toBe(0)
    await expect(page.getByRole('tab')).toHaveCount(4)
    await expect(editor).toContainText('Later launch')
    await application.evaluate(({ app }, path) => {
      app.emit('open-file', { preventDefault() {} }, path)
    }, first)
    await expect(page.getByRole('tab', { name: '启动.md', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByRole('tab')).toHaveCount(4)
    await page.getByRole('tab', { name: 'Untitled 3', exact: false }).click()
    await expect(editor).toHaveText('dirty draft survives another launch')
    expect(
      await page.evaluate(() => Object.keys(window.manuslip).some((key) => /path|drop/i.test(key))),
    ).toBe(false)
    const denied = await page.evaluate(() =>
      window.manuslip.openIncomingFile('00000000-0000-0000-0000-000000000000'),
    )
    expect(denied.ok).toBe(false)
  } finally {
    if (child?.exitCode === null) child.kill()
    await application
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((window) => {
          window.destroy()
        }),
      )
      .catch(() => {})
    await application.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('trusted file drops open tabs; synthetic drops cannot grant paths; unavailable files offer retry and dismissal', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'manuslip-drop-')))
  const path = join(directory, 'dropped.md'),
    missing = join(directory, 'missing.md')
  await writeFile(path, '# Dropped document')
  const application = await launchDesktop(join(directory, 'profile'))
  try {
    const page = await application.firstWindow()
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    const editor = page.getByRole('textbox', { name: 'Markdown source' })
    await editor.fill('keep my draft')
    await page.evaluate(() => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(['synthetic content'], 'fake.md'))
      document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }))
    })
    await expect(page.getByRole('tab')).toHaveCount(1)
    await expect(editor).toHaveText('keep my draft')
    const session = await page.context().newCDPSession(page)
    const box = await editor.boundingBox()
    if (!box) throw new Error('Missing editor')
    const data = { items: [], files: [path], dragOperationsMask: 1 }
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const)
      await session.send('Input.dispatchDragEvent', { type, x: box.x + 20, y: box.y + 20, data })
    await expect(page.getByRole('tab')).toHaveCount(2)
    await expect(editor).toContainText('Dropped document')
    await page.getByRole('tab', { name: 'Untitled 1', exact: false }).click()
    await expect(editor).toHaveText('keep my draft')
    await application.evaluate(({ app }, path) => {
      app.emit('open-file', { preventDefault() {} }, path)
    }, missing)
    await expect(page.locator('.incoming-failure')).toContainText('missing.md')
    await writeFile(missing, '# Returned')
    await page.getByRole('button', { name: 'Try again: missing.md', exact: true }).click()
    await expect(page.getByRole('tab')).toHaveCount(3)
    await expect(editor).toContainText('Returned')
    const unavailableName = '写作计划 — Research notes and references for the next edition.md'
    await application.evaluate(
      ({ app }, path) => {
        app.emit('open-file', { preventDefault() {} }, path)
      },
      join(directory, unavailableName),
    )
    const dismiss = page.getByRole('button', {
      name: `Dismiss opening ${unavailableName}`,
      exact: true,
    })
    await expect(dismiss).toBeVisible()
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: 'Preferences', exact: true }).click()
      await page.getByLabel('Appearance', { exact: true }).selectOption(theme)
      await page.getByRole('button', { name: 'Close preferences' }).click()
      const pairs = await page
        .locator('.incoming-notices p, .incoming-notices button')
        .evaluateAll((elements) =>
          elements.map((element) => {
            let background: Element | null = element
            while (
              background &&
              getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)'
            )
              background = background.parentElement
            return {
              foreground: getComputedStyle(element).color,
              background: getComputedStyle(background || document.documentElement).backgroundColor,
            }
          }),
        )
      for (const pair of pairs)
        expect(contrast(pair.foreground, pair.background)).toBeGreaterThanOrEqual(4.5)
      await page.getByRole('button', { name: `Try again: ${unavailableName}`, exact: true }).focus()
      await page.keyboard.press('Tab')
      await expect(dismiss).toBeFocused()
      expect(await dismiss.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe(
        '2px',
      )
      await page.screenshot({ path: test.info().outputPath(`incoming-${theme}.png`) })
    }
    await page.getByRole('button', { name: 'Preferences', exact: true }).click()
    await page.getByLabel('Interface language').selectOption('zh-CN')
    await page.getByRole('button', { name: '关闭偏好设置' }).click()
    const chineseDismiss = page.getByRole('button', {
      name: `取消打开 ${unavailableName}`,
      exact: true,
    })
    for (const zoom of [2, 1]) {
      await application.evaluate(
        ({ BrowserWindow }, zoom) =>
          BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(zoom),
        zoom,
      )
      await chineseDismiss.scrollIntoViewIfNeeded()
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
    }
    await page.setViewportSize({ width: 320, height: 950 })
    await chineseDismiss.scrollIntoViewIfNeeded()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({ path: test.info().outputPath('incoming-narrow-chinese.png') })
    await page.locator('.editor-status').scrollIntoViewIfNeeded()
    expect(
      await page.evaluate(() => {
        const status = document.querySelector('.editor-status')?.getBoundingClientRect()
        return Boolean(status && status.top >= 0 && status.bottom <= innerHeight + 1)
      }),
    ).toBe(true)
    await chineseDismiss.click()
    await expect(page.locator('.incoming-failure')).toHaveCount(0)
  } finally {
    await application
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((window) => {
          window.destroy()
        }),
      )
      .catch(() => {})
    await application.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
