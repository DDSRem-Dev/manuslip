import { realpath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { type BrowserWindow, dialog } from 'electron'
import type { Locale } from '../../shared/contracts'
import { record } from '../../shared/file-contracts'
import {
  type PluginManifest,
  type PluginPermission,
  pluginLimits,
  pluginText,
  pluginUrl,
} from '../../shared/plugin-contracts'
import { atomicWrite, maybeDisk, readDisk } from '../files/disk'
import { FileOperationError } from '../files/errors'
import type { FileSessions } from '../files/sessions'

export class PluginCapabilities {
  private calls = 0
  private active = false
  constructor(
    private readonly window: BrowserWindow,
    private readonly manifest: PluginManifest,
    private readonly grants: PluginPermission[],
    private readonly files: FileSessions,
    private readonly signal: AbortSignal,
    private readonly authorize: () => void,
    private readonly locale: Locale = 'en',
  ) {}
  private current(): void {
    this.authorize()
    this.signal.throwIfAborted()
  }
  private require(permission: PluginPermission): void {
    this.current()
    if (!this.manifest.permissions.includes(permission) || !this.grants.includes(permission))
      throw new FileOperationError('plugin-permission')
  }
  async call(kind: string, input: unknown): Promise<unknown> {
    this.current()
    if (this.active || ++this.calls > pluginLimits.calls)
      throw new FileOperationError('plugin-limit')
    this.active = true
    try {
      if (kind === 'readTextFile') return await this.read(input)
      if (kind === 'writeTextFile') return await this.write(input)
      if (kind === 'fetchText') return await this.fetch(input)
      throw new FileOperationError('plugin-permission')
    } finally {
      this.active = false
    }
  }
  private async read(input: unknown): Promise<string | null> {
    this.require('files.read')
    if (input !== null) throw new FileOperationError('plugin-invalid')
    const result = await dialog.showOpenDialog(this.window, {
      title: `${this.manifest.name} — ${this.locale === 'zh-CN' ? '读取文本文件' : 'Read text file'}`,
      properties: ['openFile'],
      filters: [
        {
          name: this.locale === 'zh-CN' ? '文本' : 'Text',
          extensions: ['md', 'txt', 'json', 'csv'],
        },
      ],
    })
    this.current()
    if (result.canceled || !result.filePaths[0]) return null
    const disk = await readDisk(result.filePaths[0], pluginLimits.text)
    this.current()
    return pluginText(new TextDecoder('utf-8', { fatal: true }).decode(disk.bytes))
  }
  private async write(input: unknown): Promise<boolean> {
    this.require('files.write')
    const value = record(input)
    if (Object.keys(value).length !== 1) throw new FileOperationError('plugin-invalid')
    const text = pluginText(value.text)
    const result = await dialog.showSaveDialog(this.window, {
      title: `${this.manifest.name} — ${this.locale === 'zh-CN' ? '保存文本文件' : 'Save text file'}`,
      defaultPath: 'plugin-output.txt',
      filters: [
        {
          name: this.locale === 'zh-CN' ? '文本' : 'Text',
          extensions: ['txt', 'md', 'json', 'csv'],
        },
      ],
    })
    this.current()
    if (result.canceled || !result.filePath) return false
    const path = join(await realpath(dirname(result.filePath)), basename(result.filePath))
    this.current()
    await this.files.assertExportDestination(path)
    const expected = (await maybeDisk(path, pluginLimits.text))?.fingerprint || null
    this.current()
    await atomicWrite(path, Buffer.from(text), expected, {
      maximumBytes: pluginLimits.text,
      beforeWrite: async () => this.current(),
      beforeCommit: () => this.current(),
      beforeReplace: async () => {
        this.current()
        await this.files.assertExportDestination(path)
        this.current()
      },
    })
    this.current()
    return true
  }
  private async fetch(input: unknown): Promise<string> {
    this.require('network')
    const value = record(input)
    if (Object.keys(value).length !== 3 || !['GET', 'POST'].includes(value.method as string))
      throw new FileOperationError('plugin-invalid')
    const url = pluginUrl(value.url),
      body = pluginText(value.body, pluginLimits.request)
    if (!this.manifest.networkOrigins.includes(url.origin) || (value.method === 'GET' && body))
      throw new FileOperationError('plugin-permission')
    const response = await fetch(url, {
      method: value.method as string,
      redirect: 'error',
      signal: this.signal,
      headers: {
        Accept: 'text/plain, application/json',
        ...(value.method === 'POST' ? { 'Content-Type': 'text/plain; charset=utf-8' } : {}),
      },
      ...(value.method === 'POST' ? { body } : {}),
    })
    try {
      this.current()
    } catch (error) {
      await response.body?.cancel().catch(() => {})
      throw error
    }
    const declared = response.headers.get('content-length')
    if (
      !response.ok ||
      (declared && (!/^\d+$/.test(declared) || Number(declared) > pluginLimits.response))
    ) {
      await response.body?.cancel()
      throw new FileOperationError('plugin-failed')
    }
    const reader = response.body?.getReader()
    if (!reader) return ''
    const decoder = new TextDecoder('utf-8', { fatal: true }),
      chunks: string[] = []
    let total = 0
    try {
      while (true) {
        const next = await reader.read()
        this.current()
        if (next.done) break
        total += next.value.byteLength
        if (total > pluginLimits.response) throw new FileOperationError('plugin-limit')
        chunks.push(decoder.decode(next.value, { stream: true }))
      }
      chunks.push(decoder.decode())
      return pluginText(chunks.join(''), pluginLimits.response)
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }
}
