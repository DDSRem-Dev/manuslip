import type { ElectronApplication, Locator, Page, TestInfo } from '@playwright/test'
import { expect } from '@playwright/test'
import axe from 'axe-core'

export async function auditPluginInterface(
  application: ElectronApplication,
  page: Page,
  info: TestInfo,
  prefix: string,
  target?: Locator,
): Promise<void> {
  for (const [name, width, height] of [
    ['wide', 1144, 715],
    ['narrow', 400, 860],
  ] as const) {
    await application.evaluate(
      ({ BrowserWindow }, size) => {
        const window = BrowserWindow.getAllWindows().find(
          (window) => !window.webContents.getURL().startsWith('manuslip-plugin:'),
        )
        window?.setMinimumSize(360, 500)
        window?.setContentSize(size.width, size.height)
      },
      { width, height },
    )
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
    await target?.scrollIntoViewIfNeeded()
    await page.evaluate(axe.source)
    const audit = await page.evaluate(async () => ({
      violations: (
        await (window as unknown as { axe: typeof import('axe-core') }).axe.run(document, {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
          },
        })
      ).violations,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }))
    expect(audit.violations).toEqual([])
    expect(audit.overflow).toBe(false)
    await info.attach(`${prefix}-${name}-accessibility`, {
      body: JSON.stringify(audit),
      contentType: 'application/json',
    })
    await info.attach(`${prefix}-${name}-tree`, {
      body: await page.locator('body').ariaSnapshot(),
      contentType: 'text/plain',
    })
    await info.attach(`${prefix}-${name}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  }
}
