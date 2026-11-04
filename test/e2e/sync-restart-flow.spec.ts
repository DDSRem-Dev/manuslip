import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { startHttpServer } from '../helpers/http-server'
import { startWebDavServer } from '../helpers/webdav-server'
import { clickDocumentAction, launchDesktop } from './helpers'
import { stop } from './recovery-helpers'

async function exportedBytes(path: string): Promise<Buffer | null> {
  return readFile(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
}

async function connect(page: Page, url: string) {
  await clickDocumentAction(page, 'Sync')
  const modal = page.getByRole('dialog', { name: 'Sync', exact: true })
  await modal.getByRole('radio', { name: 'WebDAV', exact: true }).check()
  await modal.getByRole('textbox', { name: 'File URL', exact: true }).fill(url)
  await modal.getByRole('button', { name: 'Connect WebDAV', exact: true }).click()
  await expect(
    modal.getByRole('button', { name: 'Review saved versions', exact: true }),
  ).toBeEnabled()
  return modal
}

test('a conditional WebDAV conflict survives restart and both displaced versions remain exportable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-sync-restart-flow-'))
  const profile = join(directory, 'profile'),
    path = join(directory, 'writing.md'),
    original = Buffer.from('\ufeff# Original 世界\r\n')
  await writeFile(path, original)
  const server = await startWebDavServer(original)
  let application = await launchDesktop(profile, [path])
  try {
    let page = await application.firstWindow()
    let modal = await connect(page, server.resource)
    expect(server.remote.requests).toEqual([])
    await modal.getByRole('button', { name: 'Review saved versions', exact: true }).click()
    await expect(modal.locator('.sync-connection')).toContainText('Last synced')
    await expect(modal.getByRole('region', { name: 'Review versions', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    const local = Buffer.from('\ufeff# My newer local version 😀\r\n')
    await page
      .getByRole('textbox', { name: 'Markdown source' })
      .fill('# My newer local version 😀\n')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
    await expect.poll(() => readFile(path)).toEqual(local)
    await clickDocumentAction(page, 'Sync')
    await modal.getByRole('button', { name: 'Review saved versions', exact: true }).click()
    await expect(modal.getByRole('region', { name: 'Review versions', exact: true })).toBeVisible()
    const expected = server.remote.etag,
      competing = Buffer.from('# Concurrent remote 世界\r\n')
    server.remote.beforePut = () => server.remote.set(competing)
    await modal.getByRole('button', { name: 'Send saved version', exact: true }).click()
    await expect(modal.getByRole('alert')).toContainText('A saved version changed')
    expect(
      server.remote.requests.find((request) => request.method === 'PUT')?.headers['if-match'],
    ).toBe(expected)
    expect(server.remote.bytes).toEqual(competing)
    expect(await readFile(path)).toEqual(local)
    await page.keyboard.press('Escape')
    await application.close()

    const count = server.remote.requests.length
    application = await launchDesktop(profile, [path])
    page = await application.firstWindow()
    await clickDocumentAction(page, 'Sync')
    modal = page.getByRole('dialog', { name: 'Sync', exact: true })
    await expect(
      modal.getByText(
        'A previous transfer did not finish verification. Review the actual saved versions before retrying.',
        { exact: true },
      ),
    ).toBeVisible()
    expect(server.remote.requests).toHaveLength(count)
    await modal.locator('details.sync-recoveries > summary').click()
    await expect(modal.locator('.sync-recoveries li')).toHaveCount(1)
    const exported = join(directory, 'remote-before-conflict.md')
    await application.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
    }, exported)
    await modal.getByRole('button', { name: 'Export copy…', exact: true }).click()
    await expect.poll(() => exportedBytes(exported)).toEqual(original)
    await modal.getByRole('button', { name: 'Review saved versions', exact: true }).click()
    await expect(
      modal.getByText('Both versions changed since the last sync. Review them before choosing.', {
        exact: true,
      }),
    ).toBeVisible()
    await modal.getByRole('button', { name: 'Receive remote version', exact: true }).click()
    await expect(modal.getByRole('region', { name: 'Review versions', exact: true })).toHaveCount(0)
    await expect.poll(() => readFile(path)).toEqual(competing)
    await expect(modal.locator('.sync-recoveries li')).toHaveCount(2)
    const localExport = join(directory, 'local-before-download.md')
    await application.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
    }, localExport)
    await modal
      .locator('.sync-recoveries li')
      .filter({ hasText: 'Local' })
      .getByRole('button', { name: 'Export copy…', exact: true })
      .click()
    await expect.poll(() => exportedBytes(localExport)).toEqual(local)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Markdown source' })).toContainText(
      'Concurrent remote 世界',
    )
    expect(server.remote.bytes).toEqual(competing)
  } finally {
    await stop(application)
    try {
      await server.close()
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }
})

test('stopping a streaming WebDAV review closes its socket and a later explicit retry succeeds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-sync-stream-flow-'))
  const path = join(directory, 'writing.md'),
    original = '# Local saved version\n'
  await writeFile(path, original)
  const entered = Promise.withResolvers<void>(),
    closed = Promise.withResolvers<void>()
  let hold = true,
    gets = 0
  const server = await startHttpServer((_request, response) => {
    gets++
    response.writeHead(200, { ETag: '"remote-version"' })
    if (hold) {
      response.once('close', () => closed.resolve())
      response.write('# Partial remote')
      entered.resolve()
    } else response.end('# Complete remote\n')
  })
  const application = await launchDesktop(join(directory, 'profile'), [path])
  try {
    const page = await application.firstWindow(),
      modal = await connect(page, `${server.url}/writing.md`)
    await modal.getByRole('button', { name: 'Review saved versions', exact: true }).click()
    await entered.promise
    await modal.getByRole('button', { name: 'Stop sync', exact: true }).click()
    await expect(modal.getByRole('alert')).toContainText('Sync was stopped')
    await closed.promise
    expect(await readFile(path, 'utf8')).toBe(original)
    hold = false
    await modal.getByRole('button', { name: 'Review saved versions', exact: true }).click()
    await modal.locator('.sync-versions details').nth(1).locator('summary').click()
    await expect(modal.getByRole('textbox', { name: 'Remote version' })).toHaveValue(
      '# Complete remote\n',
    )
    expect(gets).toBe(2)
    await modal.getByRole('button', { name: 'Receive remote version', exact: true }).click()
    await expect.poll(() => readFile(path, 'utf8')).toBe('# Complete remote\n')
  } finally {
    await stop(application)
    try {
      await server.close()
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }
})
