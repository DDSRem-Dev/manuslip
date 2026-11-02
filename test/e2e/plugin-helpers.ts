import { writeFile } from 'node:fs/promises'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import type {
  PluginManifest,
  PluginPermission,
} from '../../apps/desktop/src/shared/plugin-contracts'

export const pluginManifest = (
  id: string,
  permissions: PluginPermission[] = [],
  origins: string[] = [],
): PluginManifest => ({
  apiVersion: 1,
  id,
  name: 'Isolated test commands',
  version: '1.0.0',
  description: 'Local native isolation fixture',
  commands: [{ id: 'probe', title: 'Probe isolation', kind: 'inspect' }],
  permissions,
  networkOrigins: origins,
})
export async function installTestPlugin(
  application: ElectronApplication,
  page: Page,
  path: string,
  manifest: PluginManifest,
  code: string,
  grants: PluginPermission[],
): Promise<void> {
  await writeFile(path, JSON.stringify({ manifest, code }))
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, path)
  const chosen = await page.evaluate(() => window.manuslip.choosePlugin())
  if (!chosen.ok || !chosen.value) throw new Error('Native plugin selection failed')
  const installed = await page.evaluate(
    ({ token, grants }) => window.manuslip.installPlugin(token, grants),
    { token: chosen.value.token, grants },
  )
  expect(installed).toMatchObject({ ok: true })
}
export async function runTestPlugin(page: Page, pluginId: string) {
  const documentId = await page.locator('.document-workspace').getAttribute('data-style-document')
  if (!documentId) throw new Error('Missing open document')
  return page.evaluate((request) => window.manuslip.runPlugin(request), {
    jobId: crypto.randomUUID(),
    documentId,
    revision: 0,
    pluginId,
    commandId: 'probe',
    text: 'Private source 中文',
    selections: [{ anchor: 0, head: 7 }],
  })
}
