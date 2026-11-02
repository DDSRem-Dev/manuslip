import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { type SearchRequest, searchChannels } from '../../apps/desktop/src/shared/search-contracts'
import { clickDocumentAction, contrast, launchDesktop } from './helpers'
import { audit, capture, stop } from './recovery-helpers'

const states = [
  { theme: 'light', locale: 'en', width: 1160, zoom: 1, rtl: false, mode: 'filename' },
  { theme: 'dark', locale: 'en', width: 320, zoom: 1, rtl: false, mode: 'text' },
  { theme: 'light', locale: 'zh-CN', width: 320, zoom: 1, rtl: false, mode: 'filename' },
  { theme: 'dark', locale: 'zh-CN', width: 1160, zoom: 1, rtl: true, mode: 'text' },
  { theme: 'light', locale: 'en', width: 1160, zoom: 2, rtl: false, mode: 'text' },
  { theme: 'dark', locale: 'zh-CN', width: 1160, zoom: 2, rtl: false, mode: 'filename' },
] as const

for (const state of states)
  test(`workspace search retains keyboard context: ${state.theme}/${state.locale}/${state.width}/${state.zoom}/${state.rtl}/${state.mode}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'manuslip-search-ui-'))
    const root = join(directory, '写作 — خطط')
    await mkdir(root)
    await writeFile(join(root, 'notes.md'), 'Original saved writing.')
    const application = await launchDesktop(join(directory, 'profile'))
    const chinese = state.locale === 'zh-CN'
    try {
      const page = await application.firstWindow()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await expect(
        page.getByRole('button', { name: /^(New document|新建文档)$/ }).first(),
      ).toBeVisible()
      const saved = await page.evaluate(async (state) => {
        const bootstrap = await window.manuslip.bootstrap()
        if (!bootstrap.ok) throw new Error('Missing settings')
        return window.manuslip.updateSettings({
          ...bootstrap.value.settings,
          theme: state.theme,
          locale: state.locale,
        })
      }, state)
      expect(saved.ok).toBe(true)
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('lang', state.locale)
      await page
        .getByRole('button', { name: chinese ? '新建文档' : 'New document', exact: true })
        .first()
        .click()
      const editor = page.getByRole('textbox', {
        name: chinese ? 'Markdown 源码' : 'Markdown source',
        exact: true,
      })
      await editor.fill('Unsaved draft — 保留 😀')
      await application.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      }, root)
      await clickDocumentAction(page, chinese ? '打开文件夹…' : 'Open folder…')
      // Keep the production renderer, preload validation and IPC calls. Controlled main
      // replies make cancellation/retry/pagination reproducible without timing a disk scan.
      await application.evaluate(({ ipcMain }, channels) => {
        const jobs = new Map<
          string,
          {
            request: SearchRequest
            entries: { id: string; path: string; line: number; excerpt: string }[]
          }
        >()
        const probe = { cancelled: [] as string[], retries: 0 }
        Object.assign(globalThis, { searchUiProbe: probe })
        for (const channel of [channels.start, channels.poll, channels.cancel])
          ipcMain.removeHandler(channel)
        ipcMain.handle(channels.start, (_event, request: SearchRequest) => {
          if (request.query === 'retry') probe.retries++
          const count = request.query === 'many' ? 55 : request.query === 'partial' ? 3 : 0
          jobs.set(request.id, {
            request,
            entries: Array.from({ length: count }, (_, index) => ({
              id: crypto.randomUUID(),
              path: `章節/خطط/${index + 1} — ${'A long filename 世界 '.repeat(4)}.md`,
              line: request.mode === 'text' ? index + 1 : 0,
              excerpt:
                request.mode === 'text'
                  ? 'A complete searchable line — 中文 😀 العربية. '.repeat(8)
                  : '',
            })),
          })
          return { ok: true, value: null }
        })
        ipcMain.handle(channels.poll, (_event, { id, cursor }: { id: string; cursor: number }) => {
          const job = jobs.get(id)
          if (!job) throw new Error('Missing controlled search')
          const error = job.request.query === 'retry' && probe.retries === 1
          const entries = job.entries.slice(cursor, cursor + 50)
          return {
            ok: true,
            value: {
              id,
              cursor: cursor + entries.length,
              entries,
              total: job.entries.length,
              state: error
                ? 'error'
                : ['many', 'retry'].includes(job.request.query)
                  ? 'done'
                  : 'running',
              error: error ? 'search-io' : null,
              truncated: false,
              skipped: 0,
            },
          }
        })
        ipcMain.handle(channels.cancel, (_event, id: string) => {
          probe.cancelled.push(id)
          return { ok: true, value: null }
        })
      }, searchChannels)
      await application.evaluate(({ BrowserWindow, Menu }, state) => {
        const window = BrowserWindow.getAllWindows()[0]
        if (!window) throw new Error('Missing application window')
        window.setMinimumSize(0, 0)
        window.webContents.setZoomFactor(state.zoom)
        window.setContentSize(state.width, 900)
        const accelerator = state.mode === 'filename' ? 'CmdOrCtrl+P' : 'CmdOrCtrl+Shift+F'
        const command = Menu.getApplicationMenu()
          ?.items.flatMap((item) => item.submenu?.items ?? [])
          .find((item) => item.accelerator === accelerator)
        if (!command) throw new Error('Missing search command')
        command.click()
      }, state)
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(state.width / state.zoom)
      await page.evaluate((rtl) => {
        document.documentElement.dir = rtl ? 'rtl' : 'ltr'
      }, state.rtl)
      const panel = page.locator('.workspace-search')
      await expect(panel).toHaveAttribute('open', '')
      await expect(page.locator('#workspace-search-mode')).toHaveValue('filename')
      if (state.mode === 'text') {
        await page.locator('#workspace-search-mode').selectOption('text')
        await page.locator('#workspace-query').focus()
      }
      const query = page.locator('#workspace-query')
      const results = panel.locator('.search-results button')
      const status = panel.locator('[role=status]')
      const observations: { action: string; focused: boolean; status?: string }[] = []
      await capture(application, 'idle')
      await audit(page, 'search-idle')

      for (const value of ['hold', 'partial']) {
        await query.fill(value)
        const cancel = panel.getByRole('button', {
          name: chinese ? '停止搜索' : 'Stop search',
          exact: true,
        })
        await expect(cancel).toBeVisible()
        if (value === 'partial') await expect(results).toHaveCount(3)
        await cancel.focus()
        await page.keyboard.press('Enter')
        await expect(cancel).toHaveCount(0)
        await expect(status).toContainText(chinese ? '搜索已停止' : 'Search stopped')
        observations.push({
          action: value,
          focused: await query.evaluate((element) => document.activeElement === element),
          status: (await status.textContent()) ?? '',
        })
        if (value === 'hold') {
          await capture(application, 'stopped-empty')
          await audit(page, 'search-stopped-empty')
        } else await expect(results).toHaveCount(3)
      }

      await query.fill('retry')
      const retry = panel.getByRole('button', { name: chinese ? '重试' : 'Try again', exact: true })
      await expect(retry).toBeVisible()
      await retry.focus()
      await capture(application, 'error')
      await audit(page, 'search-error')
      await page.keyboard.press('Enter')
      await expect(panel.locator('[role=alert]')).toHaveCount(0)
      await expect(status).toContainText(chinese ? '没有找到' : 'No matches')
      observations.push({
        action: 'retry',
        focused: await query.evaluate((element) => document.activeElement === element),
      })

      await query.fill('many')
      await expect(results).toHaveCount(50)
      const more = panel.getByRole('button', {
        name: chinese ? '显示更多结果' : 'Show more results',
        exact: true,
      })
      await expect(more).toBeVisible()
      await more.focus()
      await page.keyboard.press('Enter')
      await expect(results).toHaveCount(55)
      await expect(more).toHaveCount(0)
      // Wait for React's post-commit focus effect, not an arbitrary timer.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      )
      observations.push({
        action: 'more',
        focused: await results.nth(50).evaluate((element) => document.activeElement === element),
      })
      await capture(application, 'expanded-results')
      await audit(page, 'search-flow')
      const metrics = await panel.evaluate((element) => {
        const query = element.querySelector<HTMLInputElement>('input[type=search]')
        if (!query) throw new Error('Missing query')
        const active = document.activeElement ?? query
        const focus = getComputedStyle(active)
        const bounds = active.getBoundingClientRect()
        let clipLeft = 0,
          clipRight = innerWidth,
          clipTop = 0,
          clipBottom = innerHeight
        for (let parent = active.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent)
          const rect = parent.getBoundingClientRect()
          if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
            clipLeft = Math.max(clipLeft, rect.left + parent.clientLeft)
            clipRight = Math.min(clipRight, rect.left + parent.clientLeft + parent.clientWidth)
          }
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
            clipTop = Math.max(clipTop, rect.top + parent.clientTop)
            clipBottom = Math.min(clipBottom, rect.top + parent.clientTop + parent.clientHeight)
          }
        }
        const outlineExtent =
          Number.parseFloat(focus.outlineWidth) + Number.parseFloat(focus.outlineOffset)
        const pairs = [
          ...element.querySelectorAll(
            'summary, label, input[type=search], select, p, button, bdi, small, span',
          ),
        ]
          .filter((node) => node.getBoundingClientRect().height > 0)
          .map((node) => {
            let background: Element | null = node
            while (
              background &&
              getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)'
            )
              background = background.parentElement
            return {
              text: node.textContent,
              foreground: getComputedStyle(node).color,
              background: getComputedStyle(background ?? document.documentElement).backgroundColor,
            }
          })
        return {
          width: innerWidth,
          height: innerHeight,
          rootWidth: document.documentElement.scrollWidth,
          panelWidth: element.clientWidth,
          panelScrollWidth: element.scrollWidth,
          queryHeight: query.getBoundingClientRect().height,
          outlineWidth: focus.outlineWidth,
          outlineColor: focus.outlineColor,
          focusBackground: focus.backgroundColor,
          focusVisible: active.matches(':focus-visible'),
          focusInlineVisible:
            bounds.left - outlineExtent >= clipLeft - 1 &&
            bounds.right + outlineExtent <= clipRight + 1,
          focusVisibleHeight: Math.min(bounds.bottom, clipBottom) - Math.max(bounds.top, clipTop),
          pairs,
        }
      })
      expect(metrics.rootWidth).toBeLessThanOrEqual(metrics.width)
      expect(metrics.panelScrollWidth).toBeLessThanOrEqual(metrics.panelWidth + 1)
      expect(metrics.queryHeight).toBeGreaterThanOrEqual(40)
      for (const pair of metrics.pairs)
        expect(contrast(pair.foreground, pair.background), pair.text ?? '').toBeGreaterThanOrEqual(
          4.5,
        )
      await writeFile(
        test.info().outputPath('observations.json'),
        JSON.stringify({ state, observations, metrics }, null, 2),
      )
      expect(observations.map((row) => row.focused)).toEqual([true, true, true, true])
      expect(observations[0]?.status).not.toContain(chinese ? '部分结果' : 'Partial results')
      expect(observations[1]?.status).toContain(chinese ? '部分结果' : 'Partial results')
      expect(metrics.outlineWidth).toBe('2px')
      expect(contrast(metrics.outlineColor, metrics.focusBackground)).toBeGreaterThanOrEqual(3)
      expect(metrics.focusVisible).toBe(true)
      expect(metrics.focusInlineVisible).toBe(true)
      expect(metrics.focusVisibleHeight).toBeGreaterThanOrEqual(24)
      expect(await editor.textContent()).toBe('Unsaved draft — 保留 😀')
      const probe = await application.evaluate(
        () =>
          (globalThis as unknown as { searchUiProbe: { cancelled: string[]; retries: number } })
            .searchUiProbe,
      )
      expect(probe.cancelled.length).toBeGreaterThanOrEqual(2)
      expect(probe.retries).toBe(2)
      expect(errors).toEqual([])
    } finally {
      await stop(application)
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  })
