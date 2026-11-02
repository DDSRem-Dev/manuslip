import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import axe from 'axe-core'
import { contrast, launchDesktop } from './helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

for (const state of [
  { name: 'wide English light', locale: 'en', theme: 'light', width: 1160, height: 800, zoom: 1 },
  { name: 'narrow English dark', locale: 'en', theme: 'dark', width: 320, height: 850, zoom: 1 },
  { name: 'narrow Chinese dark', locale: 'zh-CN', theme: 'dark', width: 320, height: 850, zoom: 1 },
  {
    name: 'zoomed Chinese light',
    locale: 'zh-CN',
    theme: 'light',
    width: 1160,
    height: 1000,
    zoom: 2,
  },
])
  test(`Find and Replace remains readable and keyboard operable: ${state.name}`, async () => {
    await mkdir('test/artifacts/logs', { recursive: true })
    const directory = await mkdtemp(resolve('test/artifacts/logs/editor-search-e2e-'))
    const profile = join(directory, 'profile')
    await mkdir(profile)
    await writeFile(
      join(profile, 'preferences.json'),
      JSON.stringify({ schemaVersion: 1, theme: state.theme, locale: state.locale }),
    )
    const path = join(directory, 'Notes α中文.md')
    const original =
      '\ufeff# Find α中文\r\n\r\nneedle needle\r\nNeedle needles\r\nKeep final line.\r\n'
    const source = original.replace(/^\ufeff/, '').replaceAll('\r\n', '\n')
    await writeFile(path, original)
    const application = await launchDesktop(profile, [path])
    try {
      const page = await application.firstWindow()
      const editor = page.getByRole('textbox', { name: /^(Markdown source|Markdown 源码)$/ })
      await expect(editor).toBeVisible()
      await page.getByRole('button', { name: /^(Source|源码)$/, exact: true }).click()
      const currentSource = async (): Promise<string> =>
        (await editor.locator('.cm-line').allTextContents()).join('\n')
      await expect.poll(currentSource).toBe(source)
      await application.evaluate(({ BrowserWindow }, state) => {
        const window = BrowserWindow.getAllWindows()[0]
        window?.setMinimumSize(0, 0)
        window?.webContents.setZoomFactor(state.zoom)
        window?.setContentSize(state.width, state.height)
      }, state)
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(state.width / state.zoom)
      await editor.focus()
      await page.keyboard.press(`${modifier}+Home`)
      await page.keyboard.press(`${modifier}+f`)
      const panel = page.locator('.cm-panel.cm-search')
      const find = panel.getByRole('textbox', { name: /^(Find|查找)$/, exact: true })
      await expect(find).toBeFocused()
      await expect(find).toBeInViewport({ ratio: 1 })
      const layout = await panel.evaluate((panel) => {
        const bounds = (element: Element) => {
          const rect = element.getBoundingClientRect()
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        }
        const targets = Array.from(panel.querySelectorAll('button, .cm-textfield, label')).map(
          (element) => ({
            name: element.getAttribute('aria-label') || element.textContent,
            tag: element.tagName,
            ...bounds(element),
            font: Number.parseFloat(getComputedStyle(element).fontSize),
          }),
        )
        return {
          viewport: { width: innerWidth, height: innerHeight },
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
          panelOverflow: panel.scrollWidth > panel.clientWidth + 1,
          scrollerHeight: panel.closest('.cm-editor')?.querySelector('.cm-scroller')?.clientHeight,
          targets,
        }
      })
      expect(layout.pageOverflow).toBe(false)
      expect(layout.panelOverflow).toBe(false)
      expect(layout.scrollerHeight).toBeGreaterThanOrEqual(160)
      for (const target of layout.targets) {
        expect(target.width, target.name || target.tag).toBeGreaterThanOrEqual(24)
        expect(target.height, target.name || target.tag).toBeGreaterThanOrEqual(40)
        if (target.tag !== 'LABEL') expect(target.font).toBeGreaterThanOrEqual(14)
      }
      for (const [index, target] of layout.targets.entries())
        for (const other of layout.targets.slice(index + 1)) {
          const overlap =
            Math.min(target.x + target.width, other.x + other.width) >
              Math.max(target.x, other.x) &&
            Math.min(target.y + target.height, other.y + other.height) > Math.max(target.y, other.y)
          expect(overlap, `${target.name} / ${other.name}`).toBe(false)
        }

      const placeholders = await panel.locator('.cm-textfield').evaluateAll((fields) =>
        fields.map((field) => {
          const style = getComputedStyle(field, '::placeholder')
          return {
            name: field.getAttribute('aria-label'),
            color: style.color,
            opacity: style.opacity,
            background: getComputedStyle(field).backgroundColor,
          }
        }),
      )
      for (const placeholder of placeholders) {
        expect(placeholder.opacity).toBe('1')
        expect(
          contrast(placeholder.color, placeholder.background),
          placeholder.name || 'Placeholder',
        ).toBeGreaterThanOrEqual(4.5)
      }

      await page.evaluate(axe.source)
      const accessibility = await page.evaluate(async () => {
        const checker = (window as unknown as { axe: typeof import('axe-core') }).axe
        const result = await checker.run(document, {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
          },
        })
        return { violations: result.violations, incomplete: result.incomplete }
      })
      await writeFile(join(directory, 'axe.json'), JSON.stringify(accessibility, null, 2))
      expect(accessibility.violations).toEqual([])

      // Walk the native panel in DOM order, including every option and Close.
      const focusObservations = []
      for (const selector of [
        'button[name=next]',
        'button[name=prev]',
        'button[name=select]',
        'input[name=case]',
        'input[name=re]',
        'input[name=word]',
        'input[name=replace]',
        'button[name=replace]',
        'button[name=replaceAll]',
        'button[name=close]',
      ]) {
        await page.keyboard.press('Tab')
        const control = panel.locator(selector)
        await expect(control).toBeFocused()
        await expect(control).toBeInViewport({ ratio: 1 })
        const visual = await control.evaluate((element) => {
          const paintedBackground = (element: Element | null): string => {
            while (element && getComputedStyle(element).backgroundColor === 'rgba(0, 0, 0, 0)')
              element = element.parentElement
            return getComputedStyle(element || document.documentElement).backgroundColor
          }
          const style = getComputedStyle(element)
          return {
            color: style.color,
            background: paintedBackground(element),
            adjacent: paintedBackground(element.parentElement),
            outline: style.outlineStyle,
            outlineWidth: Number.parseFloat(style.outlineWidth),
            outlineColor: style.outlineColor,
          }
        })
        expect(visual.outline).toBe('solid')
        expect(visual.outlineWidth).toBeGreaterThanOrEqual(2)
        expect(contrast(visual.outlineColor, visual.adjacent)).toBeGreaterThanOrEqual(3)
        if (
          !selector.startsWith('input[name=case]') &&
          !selector.startsWith('input[name=re]') &&
          !selector.startsWith('input[name=word]')
        )
          expect(contrast(visual.color, visual.background)).toBeGreaterThanOrEqual(4.5)
        focusObservations.push({ selector, visual })
      }
      const captured = await application.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        if (!window) throw new Error('Missing application window')
        const image = await window.webContents.capturePage()
        return {
          png: image.toPNG().toString('base64'),
          size: image.getSize(),
          zoom: window.webContents.getZoomFactor(),
        }
      })
      await writeFile(join(directory, 'search-native.png'), Buffer.from(captured.png, 'base64'))
      // The entire enlarged Close target is clickable, not an overlay on another action.
      expect(
        await panel.locator('button[name=close]').evaluate((element) => {
          const rect = element.getBoundingClientRect()
          return element.contains(
            document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
          )
        }),
      ).toBe(true)
      await page.keyboard.press('Enter')
      await expect(panel).toHaveCount(0)
      await expect(editor).toBeFocused()
      await expect.poll(currentSource).toBe(source)

      // Case + whole-word settings must reach the existing cancellable replace-all path.
      await page.keyboard.press(`${modifier}+f`)
      await find.fill('needle')
      for (let stop = 0; stop < 4; stop++) await page.keyboard.press('Tab')
      await expect(panel.locator('input[name=case]')).toBeFocused()
      await page.keyboard.press('Space')
      await expect(panel.locator('input[name=case]')).toBeChecked()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await expect(panel.locator('input[name=word]')).toBeFocused()
      await page.keyboard.press('Space')
      await expect(panel.locator('input[name=word]')).toBeChecked()
      await page.keyboard.press('Tab')
      await expect(panel.locator('input[name=replace]')).toBeFocused()
      await panel.locator('input[name=replace]').fill('thread α中文')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await expect(panel.locator('button[name=replaceAll]')).toBeFocused()
      await page.keyboard.press('Enter')
      const changed = source.replace('needle needle', 'thread α中文 thread α中文')
      await expect.poll(currentSource).toBe(changed)
      await page.keyboard.press('Escape')
      await expect(panel).toHaveCount(0)
      await expect(editor).toBeFocused()
      await page.keyboard.press(`${modifier}+s`)
      await expect
        .poll(() => readFile(path, 'utf8'))
        .toBe(original.replace('needle needle', 'thread α中文 thread α中文'))
      await page.keyboard.press(`${modifier}+z`)
      await expect.poll(currentSource).toBe(source)
      await page.keyboard.press(`${modifier}+s`)
      await expect.poll(() => readFile(path, 'utf8')).toBe(original)
      // CodeMirror's Escape-then-Tab path still leaves the editor without indenting.
      await page.keyboard.press('Escape')
      await page.keyboard.press('Tab')
      await expect(
        page.getByRole('button', { name: /^(Document details|文档详情)$/, exact: true }),
      ).toBeFocused()
      await expect.poll(currentSource).toBe(source)
      await writeFile(
        join(directory, 'report.json'),
        JSON.stringify(
          {
            state,
            layout,
            placeholders,
            focusObservations,
            native: { size: captured.size, zoom: captured.zoom },
            exactSourceAndUndo: true,
          },
          null,
          2,
        ),
      )
    } finally {
      await application
        .evaluate(({ BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows()) window.destroy()
        })
        .catch(() => {})
      await application.close()
    }
  })
