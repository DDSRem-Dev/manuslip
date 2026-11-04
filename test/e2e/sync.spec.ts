import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve, sep } from 'node:path'
import { expect, test } from '@playwright/test'
import { clickDocumentAction, launchDesktop } from './helpers'
import { auditPluginInterface } from './plugin-accessibility'

for (const locale of ['en', 'zh-CN'] as const) {
  test(`${locale} folder sync reviews both directions, keeps both versions and retains recovery after disconnect`, async () => {
    test.setTimeout(120_000)
    const directory = await mkdtemp(resolve('test/e2e/result/sync-native-'))
    if (!directory.startsWith(resolve('test/e2e/result') + sep)) throw new Error('Unsafe fixture')
    const profile = join(directory, 'profile'),
      path = join(directory, 'writing.md'),
      remote = join(directory, 'remote'),
      exported = join(directory, 'remote-original.md'),
      chinese = locale === 'zh-CN',
      original = Buffer.from('\ufeff# Hello 中文\r\n\r\nOriginal.\r\n')
    await mkdir(profile)
    await mkdir(remote)
    await writeFile(path, original)
    await writeFile(
      join(profile, 'preferences.json'),
      JSON.stringify({ schemaVersion: 1, locale, theme: chinese ? 'dark' : 'light' }),
    )
    let application = await launchDesktop(profile, [path])
    try {
      let page = await application.firstWindow()
      await expect(
        page.getByRole('button', { name: chinese ? '源码' : 'Source', exact: true }),
      ).toBeVisible()
      await application.evaluate(({ dialog }, folder) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
      }, remote)
      await clickDocumentAction(page, chinese ? '同步' : 'Sync')
      let modal = page.getByRole('dialog', { name: chinese ? '同步' : 'Sync', exact: true })
      await expect(
        modal.getByRole('textbox', { name: chinese ? '远程文件名' : 'Remote filename' }),
      ).toHaveValue('writing.md')
      await expect(
        modal.getByRole('button', { name: chinese ? '关闭' : 'Close', exact: true }),
      ).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(
        modal.getByRole('radio', { name: chinese ? '文件夹' : 'Folder', exact: true }),
      ).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(
        modal.getByRole('button', { name: chinese ? '关闭' : 'Close', exact: true }),
      ).toBeFocused()
      await auditPluginInterface(application, page, test.info(), `sync-connect-${locale}`, modal)
      await modal
        .getByRole('textbox', { name: chinese ? '远程文件名' : 'Remote filename' })
        .fill('copy.md')
      await modal
        .getByRole('button', { name: chinese ? '选择同步文件夹…' : 'Choose sync folder…' })
        .click()
      await modal
        .getByRole('button', { name: chinese ? '核对已保存版本' : 'Review saved versions' })
        .click()
      await expect(
        modal.getByText(chinese ? '远程文件不存在' : 'No remote file', { exact: true }),
      ).toBeVisible()
      await modal
        .getByRole('button', {
          name: chinese ? '发送已保存版本' : 'Send saved version',
          exact: true,
        })
        .click()
      await expect(
        modal.getByRole('region', { name: chinese ? '核对版本' : 'Review versions', exact: true }),
      ).toHaveCount(0)
      await expect.poll(() => readFile(join(remote, 'copy.md')).catch(() => null)).toEqual(original)
      await page.keyboard.press('Escape')
      await expect(modal).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: chinese ? '文档操作' : 'Document actions', exact: true }),
      ).toBeFocused()
      await page.getByRole('button', { name: chinese ? '源码' : 'Source', exact: true }).click()
      const editor = page.locator('.cm-content'),
        modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
      await editor.fill('# Local draft\n\nKept locally.\n')
      await editor.press(`${modifier}+s`)
      const local = Buffer.from('\ufeff# Local draft\r\n\r\nKept locally.\r\n'),
        other = '# Remote draft\r\n\r\nKept remotely.\r\n'
      await expect.poll(() => readFile(path)).toEqual(local)
      await writeFile(join(remote, 'copy.md'), other)
      await clickDocumentAction(page, chinese ? '同步' : 'Sync')
      await modal
        .getByRole('button', { name: chinese ? '核对已保存版本' : 'Review saved versions' })
        .click()
      await expect(
        modal.getByText(
          chinese
            ? '自上次同步以来，两端均有更改。请核对后选择。'
            : 'Both versions changed since the last sync. Review them before choosing.',
          { exact: true },
        ),
      ).toBeVisible()
      await auditPluginInterface(
        application,
        page,
        test.info(),
        `sync-conflict-${locale}`,
        modal.getByRole('region', { name: chinese ? '核对版本' : 'Review versions' }),
      )
      await application.evaluate(({ dialog }, target) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
      }, exported)
      await modal
        .getByRole('button', {
          name: chinese ? '保留本地并另存远程副本…' : 'Keep local and save remote copy…',
        })
        .click()
      await expect.poll(() => readFile(exported, 'utf8').catch(() => null)).toBe(other)
      await expect.poll(() => readFile(join(remote, 'copy.md'))).toEqual(local)
      await expect(
        modal.getByRole('region', { name: chinese ? '核对版本' : 'Review versions', exact: true }),
      ).toHaveCount(0)
      await page.keyboard.press('Escape')
      await application.close()
      application = await launchDesktop(profile, [path])
      page = await application.firstWindow()
      await clickDocumentAction(page, chinese ? '同步' : 'Sync')
      modal = page.getByRole('dialog', { name: chinese ? '同步' : 'Sync', exact: true })
      await expect(modal.getByText(join(remote, 'copy.md'), { exact: true })).toBeVisible()
      await writeFile(join(remote, 'copy.md'), '# Incoming\r\n')
      await modal
        .getByRole('button', { name: chinese ? '核对已保存版本' : 'Review saved versions' })
        .click()
      await modal
        .getByRole('button', { name: chinese ? '接收远程版本' : 'Receive remote version' })
        .click()
      await expect.poll(() => readFile(path, 'utf8')).toBe('# Incoming\r\n')
      await modal
        .getByRole('button', { name: chinese ? '断开连接' : 'Disconnect', exact: true })
        .click()
      await modal
        .getByRole('button', { name: chinese ? '断开文件连接' : 'Disconnect file', exact: true })
        .click()
      await expect(
        modal.getByRole('button', { name: chinese ? '选择同步文件夹…' : 'Choose sync folder…' }),
      ).toBeVisible()
      await modal.locator('details.sync-recoveries > summary').click()
      await expect(modal.locator('.sync-recoveries li')).toHaveCount(2)
      await auditPluginInterface(
        application,
        page,
        test.info(),
        `sync-recovery-${locale}`,
        modal.locator('.sync-recoveries'),
      )
      const recoveryExport = join(directory, 'recovered-local.md')
      await application.evaluate(({ dialog }, target) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
      }, recoveryExport)
      const firstCopy = modal.locator('.sync-recoveries li').first()
      await firstCopy
        .getByRole('button', { name: chinese ? '导出副本…' : 'Export copy…', exact: true })
        .click()
      await expect.poll(() => readFile(recoveryExport).catch(() => null)).toEqual(local)
      await firstCopy
        .getByRole('button', { name: chinese ? '移除' : 'Remove', exact: true })
        .click()
      await firstCopy
        .getByRole('button', { name: chinese ? '移除副本' : 'Remove copy', exact: true })
        .click()
      await expect(modal.locator('.sync-recoveries li')).toHaveCount(1)
      expect(await readFile(path, 'utf8')).toBe('# Incoming\r\n')
      expect(await readFile(join(remote, 'copy.md'), 'utf8')).toBe('# Incoming\r\n')
    } finally {
      await application.close()
      await rm(directory, { recursive: true, force: true, maxRetries: 3 })
    }
  })

  test(`${locale} WebDAV is explicit, uses conditional writes and session credentials, and retains offline edits`, async () => {
    test.setTimeout(120_000)
    const directory = await mkdtemp(resolve('test/e2e/result/sync-webdav-native-'))
    if (!directory.startsWith(resolve('test/e2e/result') + sep)) throw new Error('Unsafe fixture')
    const profile = join(directory, 'profile'),
      path = join(directory, 'writing.md'),
      chinese = locale === 'zh-CN'
    await mkdir(profile)
    await writeFile(path, '# Local\r\n')
    await writeFile(
      join(profile, 'preferences.json'),
      JSON.stringify({ schemaVersion: 1, locale, theme: chinese ? 'dark' : 'light' }),
    )
    let body: Buffer | null = null,
      version = 0,
      offline = false,
      gets = 0,
      puts = 0
    const server = createServer(async (request, response) => {
      if (offline) {
        request.socket.destroy()
        return
      }
      if (request.headers.authorization !== 'Basic dXNlcjpzZWNyZXQ=') {
        response.writeHead(401).end()
        return
      }
      if (request.method === 'GET') {
        gets++
        response.writeHead(body ? 200 : 404, body ? { ETag: `"${version}"` } : {}).end(body)
        return
      }
      if (request.method !== 'PUT') {
        response.writeHead(405).end()
        return
      }
      if (
        body
          ? request.headers['if-match'] !== `"${version}"`
          : request.headers['if-none-match'] !== '*'
      ) {
        response.writeHead(412).end()
        return
      }
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      body = Buffer.concat(chunks)
      version++
      puts++
      response.writeHead(204).end()
    }).listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server')
    const url = `http://127.0.0.1:${address.port}/writing.md`,
      application = await launchDesktop(profile, [path])
    try {
      const page = await application.firstWindow()
      await clickDocumentAction(page, chinese ? '同步' : 'Sync')
      const modal = page.getByRole('dialog', { name: chinese ? '同步' : 'Sync', exact: true })
      await modal.getByRole('radio', { name: 'WebDAV', exact: true }).check()
      await modal
        .getByRole('textbox', { name: chinese ? '文件网址' : 'File URL', exact: true })
        .fill(url)
      await modal
        .getByRole('button', { name: chinese ? '连接 WebDAV' : 'Connect WebDAV', exact: true })
        .click()
      expect(gets).toBe(0)
      expect(puts).toBe(0)
      await modal.locator('details.sync-credentials > summary').click()
      await modal
        .getByRole('textbox', { name: chinese ? '用户名' : 'Username', exact: true })
        .fill('user')
      await modal.getByLabel(chinese ? '密码' : 'Password', { exact: true }).fill('secret')
      await expect(
        modal.getByRole('checkbox', {
          name: chinese ? '在此设备上安全记住' : 'Remember securely on this device',
        }),
      ).not.toBeChecked()
      await modal.getByRole('button', { name: chinese ? '使用凭据' : 'Use credentials' }).click()
      await expect(modal.locator('details.sync-credentials > summary')).toContainText(
        chinese ? '仅本次使用凭据' : 'Credentials for this session',
      )
      expect(await readFile(join(profile, 'sync-connections.json'), 'utf8')).not.toContain('secret')
      await auditPluginInterface(
        application,
        page,
        test.info(),
        `sync-webdav-${locale}`,
        modal.locator('.sync-credentials'),
      )
      await modal
        .getByRole('button', { name: chinese ? '核对已保存版本' : 'Review saved versions' })
        .click()
      await modal
        .getByRole('button', {
          name: chinese ? '发送已保存版本' : 'Send saved version',
          exact: true,
        })
        .click()
      await expect.poll(() => puts).toBe(1)
      await expect(
        modal.getByRole('region', { name: chinese ? '核对版本' : 'Review versions', exact: true }),
      ).toHaveCount(0)
      expect(body).toEqual(Buffer.from('# Local\r\n'))
      body = Buffer.from('# Remote\r\n')
      version++
      await modal
        .getByRole('button', { name: chinese ? '核对已保存版本' : 'Review saved versions' })
        .click()
      await expect(modal.locator('.sync-versions textarea').nth(1)).toHaveValue('# Remote\n')
      body = Buffer.from('# Later remote\r\n')
      version++
      await modal
        .getByRole('button', { name: chinese ? '接收远程版本' : 'Receive remote version' })
        .click()
      await expect(modal.getByRole('alert')).toContainText(
        chinese ? '已保存版本发生更改' : 'A saved version changed',
      )
      expect(await readFile(path, 'utf8')).toBe('# Local\r\n')
      await modal
        .getByRole('button', { name: chinese ? '核对已保存版本' : 'Review saved versions' })
        .click()
      await modal
        .getByRole('button', { name: chinese ? '接收远程版本' : 'Receive remote version' })
        .click()
      await expect.poll(() => readFile(path, 'utf8')).toBe('# Later remote\r\n')
      offline = true
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: chinese ? '源码' : 'Source', exact: true }).click()
      const editor = page.locator('.cm-content'),
        modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
      await editor.fill('# Offline draft\n')
      await editor.press(`${modifier}+s`)
      await expect.poll(() => readFile(path, 'utf8')).toBe('# Offline draft\r\n')
      await clickDocumentAction(page, chinese ? '同步' : 'Sync')
      await modal
        .getByRole('button', { name: chinese ? '核对已保存版本' : 'Review saved versions' })
        .click()
      await expect(modal.getByRole('alert')).toContainText(
        chinese ? '同步目标暂不可用' : 'The sync destination is unavailable',
      )
      expect(await readFile(path, 'utf8')).toBe('# Offline draft\r\n')
      offline = false
      await modal
        .getByRole('button', { name: chinese ? '核对已保存版本' : 'Review saved versions' })
        .click()
      await modal
        .getByRole('button', {
          name: chinese ? '发送已保存版本' : 'Send saved version',
          exact: true,
        })
        .click()
      await expect.poll(() => puts).toBe(2)
      expect(body).toEqual(Buffer.from('# Offline draft\r\n'))
    } finally {
      await application.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true, maxRetries: 3 })
    }
  })
}
