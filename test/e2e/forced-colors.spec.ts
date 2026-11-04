import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, type Locator, test } from '@playwright/test'
import axe from 'axe-core'
import { contrast, launchDesktop } from './helpers'

async function appearance(control: Locator) {
  return control.evaluate((element) => {
    const style = getComputedStyle(element)
    let parent: Element | null = element
    let background = ''
    while (parent) {
      const value = getComputedStyle(parent).backgroundColor
      const alpha = value.startsWith('rgba(')
        ? Number.parseFloat(value.slice(value.lastIndexOf(',') + 1))
        : Number(value !== 'transparent')
      if (alpha > 0) {
        background = value
        break
      }
      parent = parent.parentElement
    }
    if (!background) throw new Error('Missing painted background')
    return {
      color: style.color,
      background,
      marker: style.borderBottomColor,
      markerWidth: Number.parseFloat(style.borderBottomWidth),
      nonColorCue: [
        style.textDecorationLine,
        style.fontWeight,
        style.borderBottomStyle,
        style.borderBottomWidth,
      ].join('/'),
      outlineColor: style.outlineColor,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineStyle: style.outlineStyle,
      forcedColorAdjust: style.forcedColorAdjust,
    }
  })
}

for (const scheme of ['light', 'dark'] as const)
  test(`forced system colors keep selected tabs and modes visible in ${scheme}`, async () => {
    await mkdir('test/e2e/result', { recursive: true })
    const directory = await mkdtemp(resolve(`test/e2e/result/system-colors-${scheme}-`))
    test.info().annotations.push({ type: 'system-colors-evidence', description: directory })
    const first = join(directory, 'First notes.md'),
      second = join(directory, '第二个文档.md')
    await writeFile(first, '# First notes\n\nKeep these words.\n')
    await writeFile(second, '# 第二个文档\n\nKeep the second document.\n\n- [ ] Task control\n')
    const application = await launchDesktop(join(directory, 'profile'), [first, second])
    const observations = []
    try {
      const page = await application.firstWindow()
      await expect(page.getByRole('tab')).toHaveCount(2)
      await page.emulateMedia({ forcedColors: 'active', colorScheme: scheme })
      for (const [locale, width, zoom] of [
        ['en', 1160, 1],
        ['zh-CN', 320, 1],
        ['zh-CN', 1160, 2],
      ] as const) {
        await application.evaluate(
          ({ BrowserWindow }, { width, zoom }) => {
            const window = BrowserWindow.getAllWindows()[0]
            window?.setMinimumSize(0, 0)
            window?.setContentSize(width, 850)
            window?.webContents.setZoomFactor(zoom)
          },
          { width, zoom },
        )
        const preferences = page.getByRole('button', { name: /^(Preferences|偏好设置)$/ })
        await preferences.focus()
        await page.keyboard.press('Enter')
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        const theme = zoom === 2 ? (scheme === 'light' ? 'dark' : 'light') : scheme
        await page.getByLabel(/^(Appearance|外观)$/, { exact: true }).selectOption(theme)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await page
          .getByLabel(/^(Interface language|界面语言)$/, { exact: true })
          .selectOption(locale)
        await expect(page.locator('html')).toHaveAttribute('lang', locale)
        await page.getByRole('button', { name: /^(Close preferences|关闭偏好设置)$/ }).focus()
        await page.keyboard.press('Enter')
        await expect(dialog).toBeHidden()
        await expect(preferences).toBeFocused()
        expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
        const tabs = page.getByRole('tab')
        await page.getByRole('tab', { selected: true }).focus()
        await page.keyboard.press('Home')
        await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
        await page.keyboard.press('End')
        await expect(tabs.last()).toHaveAttribute('aria-selected', 'true')
        await page.getByRole('button', { name: /^(Source|源码)$/ }).focus()
        const selected = await appearance(page.getByRole('tab', { selected: true }))
        const inactive = await appearance(page.getByRole('tab', { selected: false }))
        expect(selected.marker).not.toBe(inactive.marker)
        expect(selected.markerWidth).toBeGreaterThanOrEqual(2)
        const markerContrast = contrast(selected.marker, selected.background)
        expect(markerContrast).toBeGreaterThanOrEqual(3)
        const modes = page.locator('.preview-toolbar button[aria-pressed]')
        await expect(modes).toHaveCount(3)
        const modeStates = []
        for (let index = 0; index < 3; index++) {
          const mode = modes.nth(index)
          await mode.focus()
          await page.keyboard.press('Enter')
          await expect(mode).toHaveAttribute('aria-pressed', 'true')
          const focus = await appearance(mode)
          expect(focus.outlineStyle).not.toBe('none')
          expect(focus.outlineWidth).toBeGreaterThanOrEqual(2)
          expect(contrast(focus.outlineColor, focus.background)).toBeGreaterThanOrEqual(3)
          // Move keyboard focus away: the current mode must retain its own visible cue.
          await page.getByRole('tab', { selected: true }).focus()
          const active = await appearance(mode)
          const textContrast = contrast(active.color, active.background)
          expect(textContrast).toBeGreaterThanOrEqual(4.5)
          const inactiveModes = []
          for (let other = 0; other < 3; other++)
            if (other !== index) {
              const inactive = await appearance(modes.nth(other))
              expect(active.nonColorCue).not.toBe(inactive.nonColorCue)
              inactiveModes.push(inactive)
            }
          expect(active.forcedColorAdjust).toBe('auto')
          modeStates.push({
            name: await mode.textContent(),
            active,
            focus,
            textContrast,
            inactiveModes,
          })
        }
        await modes.first().focus()
        await page.keyboard.press('Enter')
        const editor = page.getByRole('textbox', { name: /^(Markdown source|Markdown 源码)$/ })
        await expect(editor).toBeVisible()
        const original = await editor.textContent()
        await editor.focus()
        await page.keyboard.press('ControlOrMeta+End')
        await page.keyboard.type(' Keyboard editing remains available.')
        await expect(editor).toContainText('Keyboard editing remains available.')
        await page.keyboard.press('ControlOrMeta+z')
        await expect.poll(() => editor.textContent()).toBe(original)
        const name = `${locale}-${width}-${zoom}`
        await modes.first().focus()
        await modes.first().scrollIntoViewIfNeeded()
        const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
        expect(viewport.width).toBeCloseTo(width / zoom, 0)
        const capture = await application.evaluate(async ({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0]
          if (!window) throw new Error('Missing application window')
          // Capture the native content area: a page screenshot crops native Electron zoom.
          const image = await window.capturePage()
          return { png: image.toPNG().toString('base64'), size: image.getSize() }
        })
        expect(capture.size.width).toBeGreaterThanOrEqual(width)
        await writeFile(join(directory, `${name}.png`), Buffer.from(capture.png, 'base64'))
        await page.evaluate(axe.source)
        const audit = await page.evaluate(async () => {
          const checker = (window as unknown as { axe: typeof import('axe-core') }).axe
          const result = await checker.run(document, {
            runOnly: {
              type: 'tag',
              values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
            },
            // axe reads the original -webkit-text-fill-color under forced colors.
            // Check actual system-color contrast above and fully audit the theme below.
            rules: { 'color-contrast': { enabled: false } },
          })
          return {
            colorContrast: 'Measured rendered system colors separately',
            violations: result.violations,
            incomplete: result.incomplete,
          }
        })
        await writeFile(join(directory, `${name}-axe.json`), `${JSON.stringify(audit, null, 2)}\n`)
        expect(audit.violations).toEqual([])
        await page.emulateMedia({ forcedColors: 'none', colorScheme: scheme })
        try {
          const themeAudit = await page.evaluate(async () => {
            const checker = (window as unknown as { axe: typeof import('axe-core') }).axe
            const result = await checker.run(document, {
              runOnly: {
                type: 'tag',
                values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
              },
            })
            return { violations: result.violations, incomplete: result.incomplete }
          })
          await writeFile(
            join(directory, `${name}-theme-axe.json`),
            `${JSON.stringify(themeAudit, null, 2)}\n`,
          )
          expect(themeAudit.violations).toEqual([])
        } finally {
          await page.emulateMedia({ forcedColors: 'active', colorScheme: scheme })
        }
        const client = await page.context().newCDPSession(page)
        try {
          const tree = await client.send('Accessibility.getFullAXTree')
          expect(
            tree.nodes.some(
              (node) =>
                node.role?.value === 'tab' &&
                node.name?.value === '第二个文档.md' &&
                node.properties?.some(
                  (property) => property.name === 'selected' && property.value.value,
                ),
            ),
          ).toBe(true)
          await writeFile(join(directory, `${name}-ax.json`), `${JSON.stringify(tree, null, 2)}\n`)
        } finally {
          await client.detach()
        }
        observations.push({
          scheme,
          theme,
          locale,
          width,
          zoom,
          viewport,
          captureSize: capture.size,
          selected,
          inactive,
          markerContrast,
          modeStates,
        })
      }
    } finally {
      await writeFile(
        join(directory, 'observations.json'),
        `${JSON.stringify(observations, null, 2)}\n`,
      )
      await application
        .evaluate(({ BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows()) window.destroy()
        })
        .catch(() => {})
      await application.close()
    }
  })
