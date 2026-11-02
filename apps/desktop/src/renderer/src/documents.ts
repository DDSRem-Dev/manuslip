import { createStore } from 'zustand/vanilla'
import type { AssetBridge } from '../../shared/asset-contracts'
import type { Result } from '../../shared/contracts'
import type { DiagramBridge } from '../../shared/diagram-contracts'
import type { ExportBridge } from '../../shared/export-contracts'
import type { DocumentCommand, FileBridge, FileSnapshot } from '../../shared/file-contracts'
import type { ImageBridge } from '../../shared/image-contracts'
import type { PluginBridge } from '../../shared/plugin-contracts'
import type { StyleBridge } from '../../shared/style-contracts'
import type { SyncBridge } from '../../shared/sync-contracts'
import type { TranslationBridge } from '../../shared/translation-contracts'
import type { RestoreFile } from '../../shared/workspace-contracts'
import { DocumentController } from './document'
import { i18next } from './i18n'

interface DocumentsStatus {
  documents: readonly DocumentController[]
  activeId: string | null
  busy: boolean
  error: string | null
}
type Bridge = FileBridge &
  Partial<
    ImageBridge &
      AssetBridge &
      DiagramBridge &
      ExportBridge &
      TranslationBridge &
      StyleBridge &
      PluginBridge &
      SyncBridge
  > & {
    openLink?(url: string): Promise<Result<null>>
  }

/** Owns tab lifetimes and close decisions; document bodies remain in each CodeMirror state. */
export class DocumentsController {
  readonly store = createStore<DocumentsStatus>(() => ({
    documents: [],
    activeId: null,
    busy: false,
    error: null,
  }))
  private readonly ordinals = new Map<string, number>()
  private ordinal = 0
  private queue: Promise<void> = Promise.resolve()
  private pending = 0
  private closed = false
  private closeRequested = false
  private selection = 0
  private selecting: Promise<boolean> | undefined
  private selectingId: string | undefined
  beforeWindowClose: (activeId: string | null) => Promise<void> = async () => {}
  constructor(private readonly bridge: Bridge) {}

  get active(): DocumentController | null {
    return (
      this.store
        .getState()
        .documents.find(
          (document) => document.store.getState().info.id === this.store.getState().activeId,
        ) || null
    )
  }
  title(document: DocumentController): string {
    const info = document.store.getState().info
    return info.displayPath
      ? info.name
      : i18next.t('untitledNumber', { number: this.ordinals.get(info.id) || 1 })
  }
  async activate(id: string): Promise<void> {
    if (this.closed || this.store.getState().busy) return
    const selecting = this.select(id)
    this.selecting = selecting
    this.selectingId = id
    try {
      await selecting
    } catch {
      this.store.setState({ error: 'file-io' })
    } finally {
      if (this.selecting === selecting) {
        this.selecting = undefined
        this.selectingId = undefined
      }
    }
  }
  private cycle(direction: -1 | 1): Promise<void> {
    const state = this.store.getState()
    if (state.documents.length < 2) return Promise.resolve()
    const index = state.documents.findIndex(
      (document) => document.store.getState().info.id === (this.selectingId ?? state.activeId),
    )
    if (index < 0) return Promise.resolve()
    const target =
      state.documents[(index + direction + state.documents.length) % state.documents.length]
    return target ? this.activate(target.store.getState().info.id) : Promise.resolve()
  }
  private async synchronizeSelection(): Promise<boolean> {
    const selection = ++this.selection
    await this.active?.synchronizeInput()
    return !this.closed && selection === this.selection
  }
  private async select(id: string): Promise<boolean> {
    if (
      !this.store.getState().documents.some((document) => document.store.getState().info.id === id)
    )
      return false
    if (!(await this.synchronizeSelection())) return false
    if (
      !this.store.getState().documents.some((document) => document.store.getState().info.id === id)
    )
      return false
    this.store.setState({ activeId: id })
    return true
  }
  private operation(action: () => Promise<void>, closing = false): Promise<void> {
    if (this.closed || (this.pending && !closing)) return Promise.resolve()
    const selecting = this.selecting
    this.pending++
    this.store.setState({ busy: true, error: null })
    const operation = this.queue
      .then(async () => {
        if (selecting) await selecting
        if (!this.closed) await action()
      })
      .catch((error: unknown) => {
        this.store.setState({
          error:
            error instanceof Error && /^(?:file|recovery|workspace)-[a-z-]+$/.test(error.message)
              ? error.message
              : 'file-io',
        })
      })
      .finally(() => {
        this.pending--
        if (!this.pending) this.store.setState({ busy: false })
      })
    this.queue = operation
    return operation
  }
  private async add(snapshot: FileSnapshot, recovered = false, activate = true): Promise<void> {
    if (activate && !(await this.synchronizeSelection())) return
    const id = snapshot.info.id
    const state = this.store.getState()
    if (state.documents.some((document) => document.store.getState().info.id === id)) {
      if (activate) this.store.setState({ activeId: id })
      return
    }
    const remoteImages = this.bridge.remoteImages?.bind(this.bridge)
    const loadRemoteImage = this.bridge.loadRemoteImage?.bind(this.bridge)
    const assets =
      this.bridge.loadLocalImage &&
      this.bridge.captureClipboardImage &&
      this.bridge.importClipboardImage &&
      this.bridge.discardClipboardImage &&
      this.bridge.convertClipboardHtml
        ? {
            loadLocalImage: this.bridge.loadLocalImage.bind(this.bridge),
            captureClipboardImage: this.bridge.captureClipboardImage.bind(this.bridge),
            importClipboardImage: this.bridge.importClipboardImage.bind(this.bridge),
            discardClipboardImage: this.bridge.discardClipboardImage.bind(this.bridge),
            convertClipboardHtml: this.bridge.convertClipboardHtml.bind(this.bridge),
          }
        : undefined
    const document = new DocumentController(
      snapshot,
      this.bridge,
      i18next.t('sourceLabel'),
      recovered,
      (url) => {
        void this.bridge.openLink?.(url)
      },
      remoteImages && loadRemoteImage ? { remoteImages, loadRemoteImage } : undefined,
      assets,
      this.bridge.renderDiagram && this.bridge.cancelDiagram && this.bridge.onDiagramCapacity
        ? {
            renderDiagram: this.bridge.renderDiagram.bind(this.bridge),
            cancelDiagram: this.bridge.cancelDiagram.bind(this.bridge),
            onDiagramCapacity: this.bridge.onDiagramCapacity.bind(this.bridge),
          }
        : undefined,
      this.bridge.exportDocument && this.bridge.cancelExport
        ? {
            exportDocument: this.bridge.exportDocument.bind(this.bridge),
            cancelExport: this.bridge.cancelExport.bind(this.bridge),
          }
        : undefined,
      this.bridge.translationState &&
        this.bridge.configureTranslation &&
        this.bridge.setTranslationCredential &&
        this.bridge.translateUnit &&
        this.bridge.cancelTranslation &&
        this.bridge.clearTranslationCache &&
        this.bridge.onTranslationChanged
        ? {
            translationState: this.bridge.translationState.bind(this.bridge),
            configureTranslation: this.bridge.configureTranslation.bind(this.bridge),
            setTranslationCredential: this.bridge.setTranslationCredential.bind(this.bridge),
            translateUnit: this.bridge.translateUnit.bind(this.bridge),
            cancelTranslation: this.bridge.cancelTranslation.bind(this.bridge),
            clearTranslationCache: this.bridge.clearTranslationCache.bind(this.bridge),
            onTranslationChanged: this.bridge.onTranslationChanged.bind(this.bridge),
          }
        : undefined,
      this.bridge.writingStyle &&
        this.bridge.setWritingTypography &&
        this.bridge.importWritingStylesheet &&
        this.bridge.resetWritingStyle
        ? {
            writingStyle: this.bridge.writingStyle.bind(this.bridge),
            setWritingTypography: this.bridge.setWritingTypography.bind(this.bridge),
            importWritingStylesheet: this.bridge.importWritingStylesheet.bind(this.bridge),
            resetWritingStyle: this.bridge.resetWritingStyle.bind(this.bridge),
          }
        : undefined,
      this.bridge.runPlugin &&
        this.bridge.cancelPlugin &&
        this.bridge.plugins &&
        this.bridge.choosePlugin &&
        this.bridge.installPlugin &&
        this.bridge.enablePlugin &&
        this.bridge.grantPlugin &&
        this.bridge.removePlugin
        ? {
            runPlugin: this.bridge.runPlugin.bind(this.bridge),
            cancelPlugin: this.bridge.cancelPlugin.bind(this.bridge),
            plugins: this.bridge.plugins.bind(this.bridge),
            choosePlugin: this.bridge.choosePlugin.bind(this.bridge),
            installPlugin: this.bridge.installPlugin.bind(this.bridge),
            enablePlugin: this.bridge.enablePlugin.bind(this.bridge),
            grantPlugin: this.bridge.grantPlugin.bind(this.bridge),
            removePlugin: this.bridge.removePlugin.bind(this.bridge),
          }
        : undefined,
      this.bridge.syncState &&
        this.bridge.connectSync &&
        this.bridge.setSyncCredential &&
        this.bridge.reviewSync &&
        this.bridge.resolveSync &&
        this.bridge.cancelSync &&
        this.bridge.disconnectSync &&
        this.bridge.exportSyncRecovery &&
        this.bridge.removeSyncRecovery
        ? {
            syncState: this.bridge.syncState.bind(this.bridge),
            connectSync: this.bridge.connectSync.bind(this.bridge),
            setSyncCredential: this.bridge.setSyncCredential.bind(this.bridge),
            reviewSync: this.bridge.reviewSync.bind(this.bridge),
            resolveSync: this.bridge.resolveSync.bind(this.bridge),
            cancelSync: this.bridge.cancelSync.bind(this.bridge),
            disconnectSync: this.bridge.disconnectSync.bind(this.bridge),
            exportSyncRecovery: this.bridge.exportSyncRecovery.bind(this.bridge),
            removeSyncRecovery: this.bridge.removeSyncRecovery.bind(this.bridge),
          }
        : undefined,
    )
    this.ordinals.set(id, ++this.ordinal)
    this.store.setState({
      documents: [...state.documents, document],
      activeId: activate || !state.activeId ? id : state.activeId,
    })
  }
  command(
    command: Exclude<DocumentCommand, 'open-folder' | 'find-file' | 'search-workspace'>,
  ): Promise<void> {
    if (command === 'next-document' || command === 'previous-document')
      return this.cycle(command === 'next-document' ? 1 : -1)
    if (command === 'export-html' || command === 'export-pdf') {
      return (
        this.active?.exporter?.start(command === 'export-html' ? 'html' : 'pdf') ||
        Promise.resolve()
      )
    }
    if (command === 'close-window') {
      if (this.closeRequested) return Promise.resolve()
      this.closeRequested = true
      return this.operation(() => this.closeWindow(), true).finally(() => {
        this.closeRequested = false
      })
    }
    return this.operation(async () => {
      if (command === 'close-document') {
        if (this.active) await this.close(this.active)
        else await this.bridge.closeWindow()
        return
      }
      if (command === 'save' || command === 'save-as' || command === 'save-copy') {
        await this.active?.save(command)
        return
      }
      const result =
        command === 'new' ? await this.bridge.newDocument() : await this.bridge.openDocument()
      if (!result.ok) throw new Error(result.code || 'file-io')
      if (result.value) await this.add(result.value)
    })
  }
  async restore(id: string, reportError = true): Promise<boolean> {
    let restored = false
    await this.operation(async () => {
      try {
        const result = await this.bridge.restoreRecovery(id)
        if (!result.ok) throw new Error(result.code || 'file-io')
        await this.add(result.value, true)
        restored = true
      } catch (error) {
        if (reportError) throw error
      }
    })
    return restored
  }
  /** null means a file/close operation is already pending; the caller keeps its request. */
  async openFile(
    load: () => Promise<Result<FileSnapshot>>,
    reportError = true,
  ): Promise<boolean | null> {
    let opened: boolean | null = null
    await this.operation(async () => {
      try {
        const result = await load()
        if (!result.ok) throw new Error(result.code || 'file-io')
        await this.add(result.value)
        opened = true
      } catch (error) {
        opened = false
        if (reportError) throw error
      }
    })
    return opened
  }
  async restoreFiles(
    entries: readonly RestoreFile[],
    load: (id: string) => Promise<Result<FileSnapshot>>,
  ): Promise<(RestoreFile & { code: string })[]> {
    const failures: (RestoreFile & { code: string })[] = []
    if (this.pending || this.closed)
      return entries.map((entry) => ({ ...entry, code: 'workspace-session' }))
    await this.operation(async () => {
      const previous = this.store.getState().activeId
      let wanted: string | null = null
      for (const entry of entries) {
        try {
          const result = await load(entry.id)
          if (!result.ok) {
            failures.push({ ...entry, code: result.code || 'file-io' })
            continue
          }
          await this.add(result.value, false, false)
          if (entry.active) wanted = result.value.info.id
        } catch {
          failures.push({ ...entry, code: 'file-io' })
        }
      }
      if (previous || wanted) await this.select(previous || wanted || '')
    })
    return failures
  }
  closeTab(id: string): Promise<void> {
    return this.operation(async () => {
      const document = this.store
        .getState()
        .documents.find((document) => document.store.getState().info.id === id)
      if (document) await this.close(document)
    })
  }
  private async close(document: DocumentController): Promise<void> {
    const id = document.store.getState().info.id
    const previousActiveId = this.store.getState().activeId
    if (!(await this.select(id))) return
    document.lock(true)
    try {
      if (!(await document.prepareClose())) return
      await document.dispose()
      const state = this.store.getState()
      const index = state.documents.indexOf(document)
      const documents = state.documents.filter((item) => item !== document)
      const next = documents[Math.min(index, documents.length - 1)]
      this.ordinals.delete(id)
      this.store.setState({
        documents,
        activeId:
          previousActiveId !== id ? previousActiveId : next?.store.getState().info.id || null,
      })
    } finally {
      document.lock(false)
    }
  }
  private async closeWindow(): Promise<void> {
    await this.active?.synchronizeInput()
    const activeId = this.store.getState().activeId
    const documents = this.store.getState().documents
    for (const document of documents) document.lock(true)
    let proceed = false
    try {
      for (const document of documents) {
        if (!(await this.select(document.store.getState().info.id))) return
        if (!(await document.prepareClose())) return
      }
      await this.beforeWindowClose(activeId)
      for (const document of documents) await document.dispose()
      this.closed = true
      proceed = true
    } finally {
      if (!proceed) for (const document of documents) document.lock(false)
      await this.bridge.closeWindow(proceed)
    }
  }
}
