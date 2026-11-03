import { realpath } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { typographyCss } from '@manuslip/renderer/typography'
import type { BrowserWindow } from 'electron'
import {
  type ExportOutcome,
  type ExportRequest,
  exportLimits,
  parseExportProjection,
} from '../../shared/export-contracts'
import { DiagramBroker } from '../diagrams/broker'
import { ElectronDiagramFactory } from '../diagrams/host'
import { atomicWrite, maybeDisk } from '../files/disk'
import { FileOperationError } from '../files/errors'
import type { FileSessions } from '../files/sessions'
import type { ImageRepository } from '../images/repository'
import { pandocExtension } from '../pandoc/arguments'
import { convertWithPandoc } from '../pandoc/converter'
import type { PandocTools } from '../pandoc/tools'
import { compileStylesheet } from '../styles/css'
import type { WritingStyles } from '../styles/service'
import { ExportAssets } from './assets'
import { exportFontStyle } from './fonts'
import { exportHtml } from './html'
import { PrintHost } from './print-host'
import { ExportWorker } from './worker'

interface Job {
  owner: number
  request: ExportRequest
  controller: AbortController
  dispose(): void
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
export class ExportManager {
  private readonly jobs = new Map<number, Job>()
  constructor(
    private readonly files: FileSessions,
    private readonly images: ImageRepository,
    private readonly styles?: Pick<WritingStyles, 'capture'>,
    private readonly pandoc?: Pick<PandocTools, 'capture'>,
  ) {}
  async start(
    window: BrowserWindow,
    request: ExportRequest,
    choose: (suggested: string) => Promise<string | null>,
  ): Promise<ExportOutcome> {
    const owner = window.webContents.id
    if (this.jobs.has(owner)) throw new FileOperationError('export-busy')
    const info = this.files.describe(owner, request.documentId)
    const pandocTool = request.format === 'pandoc' ? this.pandoc?.capture() : undefined
    if (request.format === 'pandoc' && (!pandocTool || !request.pandoc))
      throw new FileOperationError('pandoc-tool')
    const extension =
      request.format === 'pandoc' && request.pandoc
        ? pandocExtension(request.pandoc)
        : request.format
    const appearance = this.styles?.capture(owner, request.documentId)
    const appearanceRoot = '[data-document-style="export"]'
    const appearanceCss = appearance
      ? [
          typographyCss(appearance.typography, appearanceRoot),
          appearance.stylesheet
            ? compileStylesheet(appearance.stylesheet.source, appearanceRoot)
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      : ''
    const controller = new AbortController()
    const signal = controller.signal
    let worker: ExportWorker | null = null
    let print: PrintHost | null = null
    let factory: ElectronDiagramFactory | null = null
    let diagrams: DiagramBroker | null = null
    let assets: ExportAssets | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let conversion: Promise<Buffer> | undefined
    const job: Job = {
      owner,
      request,
      controller,
      dispose: () => {
        worker?.dispose()
        print?.dispose()
        diagrams?.dispose()
        factory?.dispose()
        assets?.dispose()
      },
    }
    this.jobs.set(owner, job)
    const run = async (): Promise<ExportOutcome> => {
      const context = info.displayPath
        ? await this.files.assetContext(owner, request.documentId)
        : null
      let destination: { path: string; expected: string | null } | null = null
      if (request.format !== 'present') {
        const selected = await choose(
          `${info.displayPath || info.name.replace(/[/\\]/g, '-')}.${extension}`.replace(
            /\.(?:md|markdown|mdown|txt)\.(html|pdf|png|jpeg|docx|epub|zip)$/i,
            '.$1',
          ),
        )
        signal.throwIfAborted()
        if (!selected) return { kind: 'cancelled' }
        const selectedExtension = extname(selected).toLowerCase()
        if (
          selectedExtension !== `.${extension}` &&
          !(request.format === 'jpeg' && selectedExtension === '.jpg')
        )
          throw new FileOperationError('export-target')
        const path = join(await realpath(dirname(selected)), basename(selected))
        await this.files.assertExportDestination(path)
        destination = {
          path,
          expected: (await maybeDisk(path, exportLimits.output))?.fingerprint || null,
        }
      }
      timer = setTimeout(
        () => controller.abort(new FileOperationError('export-timeout')),
        exportLimits.totalMs,
      )
      signal.throwIfAborted()
      worker = new ExportWorker()
      const projection = parseExportProjection(
        await worker.request(
          {
            kind: 'parse',
            source: request.source,
            reading: request.reading,
            locale: request.locale,
            options: {
              rawHtml: request.rawHtml,
              footnotesLabel: request.locale === 'zh-CN' ? '脚注' : 'Footnotes',
              plugins: request.plugins,
              footnoteBackLabel: request.locale === 'zh-CN' ? '返回引用' : 'Back',
            },
          },
          5000,
        ),
      )
      signal.throwIfAborted()
      const slots = []
      let markupBytes = Buffer.byteLength(projection.html)
      for (const slot of projection.slots) {
        signal.throwIfAborted()
        let svg: string
        if (slot.kind === 'math') {
          const value = await worker.request(
            { kind: 'math', source: slot.source, display: slot.display },
            2000,
          )
          if (typeof value !== 'string' || Buffer.byteLength(value) > exportLimits.html)
            throw new FileOperationError('export-render')
          svg = value
        } else {
          factory ??= new ElectronDiagramFactory(owner, () =>
            window.isDestroyed() ? 0 : window.webContents.getOSProcessId(),
          )
          diagrams ??= new DiagramBroker(factory, () => {})
          svg = await diagrams.render({
            jobId: crypto.randomUUID(),
            documentId: request.documentId,
            occurrenceId: crypto.randomUUID(),
            source: slot.source,
            ...(slot.syntax ? { syntax: slot.syntax } : {}),
            theme: 'light',
            priority: 'visible',
            retry: false,
          })
        }
        markupBytes += Buffer.byteLength(svg)
        if (markupBytes > exportLimits.html) throw new FileOperationError('export-limit')
        slots.push({
          id: slot.id,
          kind: slot.kind,
          display: slot.display,
          source: slot.source,
          svg,
        })
      }
      signal.throwIfAborted()
      assets = new ExportAssets(
        owner,
        request.documentId,
        context,
        this.files,
        this.images,
        request.remoteImages,
        signal,
      )
      print = new PrintHost(() => (window.isDestroyed() ? 0 : window.webContents.getOSProcessId()))
      const html = await print.render(
        {
          jobId: request.jobId,
          title: info.name,
          locale: request.locale,
          language:
            request.reading?.layout === 'replace' ? request.reading.targetLanguage : request.locale,
          html: projection.html,
          appearanceCss,
          slots,
          ...(request.format === 'present'
            ? { mode: 'presentation' as const, reading: Boolean(request.reading) }
            : request.format === 'png' || request.format === 'jpeg'
              ? { mode: 'raster' as const }
              : {}),
        },
        (reference) => {
          if (!assets) throw new FileOperationError('export-cancelled')
          return assets.resolve(reference)
        },
      )
      signal.throwIfAborted()
      if (request.format === 'present') {
        clearTimeout(timer)
        timer = undefined
        worker.dispose()
        worker = null
        diagrams?.dispose()
        diagrams = null
        factory?.dispose()
        factory = null
        assets.dispose()
        assets = null
        await print.present(window)
        signal.throwIfAborted()
        this.files.describe(owner, request.documentId)
        return { kind: 'presented', revision: request.revision }
      }
      let bytes: Buffer
      if (request.format === 'html')
        bytes = Buffer.from(
          exportHtml(
            info.name,
            request.locale,
            request.revision,
            html,
            await exportFontStyle(html),
            request.reading,
            appearanceCss,
          ),
        )
      else if (request.format === 'pandoc' && request.pandoc && pandocTool) {
        const pandocHtml = await print.pandocHtml(signal)
        signal.throwIfAborted()
        conversion = convertWithPandoc(
          pandocTool,
          exportHtml(
            info.name,
            request.locale,
            request.revision,
            pandocHtml,
            '',
            request.reading,
            appearanceCss,
          ),
          request.pandoc,
          signal,
          async (directory, format, bytes, images) => {
            if (!worker) throw new FileOperationError('export-cancelled')
            const transfer =
              bytes.buffer instanceof ArrayBuffer &&
              bytes.byteOffset === 0 &&
              bytes.byteLength === bytes.buffer.byteLength
                ? [bytes.buffer]
                : []
            const inspected = await worker.request(
              { kind: 'pandoc', directory, format, bytes, images: [...images] },
              exportLimits.resourceMs,
              transfer,
            )
            if (!(inspected instanceof Uint8Array) || inspected.length > exportLimits.output)
              throw new FileOperationError('pandoc-failed')
            return Buffer.from(inspected.buffer, inspected.byteOffset, inspected.byteLength)
          },
        )
        bytes = await conversion
      } else if (request.format === 'png' || request.format === 'jpeg') {
        bytes = await print.raster(request.format, signal)
      } else {
        bytes = await print.pdf()
        signal.throwIfAborted()
        if (bytes.length > exportLimits.output) throw new FileOperationError('export-limit')
        await worker.request({ kind: 'pdf', bytes }, exportLimits.resourceMs)
      }
      if (bytes.length > exportLimits.output) throw new FileOperationError('export-limit')
      signal.throwIfAborted()
      this.files.describe(owner, request.documentId)
      if (!destination) throw new FileOperationError('export-target')
      const { path, expected } = destination
      await atomicWrite(path, bytes, expected, {
        maximumBytes: exportLimits.output,
        beforeWrite: async () => signal.throwIfAborted(),
        beforeCommit: () => signal.throwIfAborted(),
        beforeReplace: async () => {
          signal.throwIfAborted()
          this.files.describe(owner, request.documentId)
          await this.files.assertExportDestination(path)
        },
      })
      return { kind: 'exported', path, revision: request.revision }
    }
    try {
      return await abortable(run(), signal)
    } catch (error) {
      if (
        signal.aborted &&
        signal.reason instanceof FileOperationError &&
        signal.reason.code === 'export-cancelled'
      )
        return { kind: 'cancelled' }
      if (signal.aborted) throw signal.reason
      throw error instanceof FileOperationError
        ? error
        : new FileOperationError(
            error instanceof Error && error.message === 'export-limit'
              ? 'export-limit'
              : 'export-render',
          )
    } finally {
      if (timer) clearTimeout(timer)
      job.dispose()
      await conversion?.catch(() => {})
      if (this.jobs.get(owner) === job) this.jobs.delete(owner)
    }
  }
  cancel(owner: number, jobId: string): void {
    const job = this.jobs.get(owner)
    if (job?.request.jobId === jobId)
      job.controller.abort(new FileOperationError('export-cancelled'))
  }
  closeDocument(owner: number, id: string): void {
    const job = this.jobs.get(owner)
    if (job?.request.documentId === id) this.cancel(owner, job.request.jobId)
  }
  closeOwner(owner: number): void {
    const job = this.jobs.get(owner)
    if (job) this.cancel(owner, job.request.jobId)
  }
}
