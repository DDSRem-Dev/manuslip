import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import axe from 'axe-core'
export async function stop(application: ElectronApplication): Promise<void> {
  await application
    .evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    .catch(() => {})
  await application.close()
}
export async function draft(profile: string, name: string, text: string, order = 0) {
  const id = randomUUID(),
    directory = join(profile, 'recovery')
  await mkdir(directory, { recursive: true })
  const info = {
    id,
    name,
    displayPath: join(profile, name),
    fingerprint: 'disk',
    encoding: 'utf8',
    bom: false,
    newline: 'lf',
    unsafeDecoding: false,
  }
  const bytes =
    JSON.stringify({
      version: 1,
      info,
      revision: 2,
      savedAt: 1000000 + order,
      bytes: Buffer.byteLength(text),
    }) +
    '\n' +
    text
  const path = join(directory, `${id}.recovery`)
  await writeFile(path, bytes)
  return { id, path, bytes, info }
}
export async function capture(application: ElectronApplication, name: string) {
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()),
    )
    .toBe(true)
  const page = await application.firstWindow()
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
  const png = await application.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) throw new Error('Missing application window')
    return (await window.webContents.capturePage()).toPNG().toString('base64')
  })
  await writeFile(test.info().outputPath(`${name}.png`), Buffer.from(png, 'base64'))
}
export async function audit(page: Page, name: string) {
  await page.evaluate(axe.source)
  const result = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: typeof import('axe-core') }).axe.run(
      document,
      {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'],
        },
      },
    )
    return { violations: result.violations, incomplete: result.incomplete }
  })
  await writeFile(test.info().outputPath(`${name}-axe.json`), JSON.stringify(result, null, 2))
  expect(
    result.violations.map((row) => ({ id: row.id, nodes: row.nodes.map((node) => node.target) })),
  ).toEqual([])
}
