import { semanticLimits } from '@manuslip/core'
import {
  defaultMarkdownPlugins,
  type MarkdownPlugins,
  markdownPluginNames,
} from '@manuslip/core/conventions'
import { readingBudgets } from '@manuslip/core/reading-limits'
import { type EditorState, OccurrenceTracker, type Text, type Transaction } from '@manuslip/editor'
import type { RenderOptions } from '@manuslip/renderer'
import {
  type ReadingBlock,
  type ReadingLayout,
  type ReadingProjection,
  readingProjectionBytes,
} from '@manuslip/renderer/reading'
import { validateTranslation } from '@manuslip/translate'
import { createStore } from 'zustand/vanilla'
import { readingJsonBytes } from '../../../../../../packages/renderer/src/reading-bytes'
import type { ReadingExport } from '../../../shared/reading-export'
import type {
  TranslationBridge,
  TranslationRequest,
  TranslationState,
} from '../../../shared/translation-contracts'
import { i18next } from '../i18n'
import { ReadingWorker } from './browser'
import { readingCopy } from './copy'
import { defaultTranslationTarget } from './languages'
import { prepareReading, type ReadingCapture } from './prepare'
import { sharedReadingPrepared } from './prepared-wire'
import {
  type ReadingEngine,
  type ReadingOperation,
  type ReadingUnit,
  readingLimits,
  readingOperationBytes,
} from './protocol'
import { TranslationQueue } from './queue'

export interface ReadingStatus {
  visible: boolean
  navigation: { from: number } | null
  phase: 'idle' | 'preparing' | 'translating' | 'ready' | 'cancelled' | 'error'
  stale: boolean
  revision: number | null
  target: string
  total: number
  completed: number
  failed: number
  limited: number
  cached: number
  projection: ReadingProjection | null
  layout: ReadingLayout
  error: string | null
  unitError: string | null
  configuration: TranslationState | null
  configurationLoading: boolean
  configurationError: string | null
}
interface Access {
  id: string
  state(): EditorState
  revision(): number
  composing(): boolean
  capture(revision: number, signal: AbortSignal): Promise<ReadingCapture>
  options(): RenderOptions
}
interface Pending {
  request: TranslationRequest
  ids: Set<string>
}
interface TranslationGroup {
  key: string
  units: ReadingUnit[]
}
/** Owns immutable derived data only. It never dispatches an editor transaction. */
export class DocumentReading {
  readonly store = createStore<ReadingStatus>(() => ({
    visible: false,
    navigation: null,
    phase: 'idle',
    stale: false,
    revision: null,
    target: defaultTranslationTarget,
    total: 0,
    completed: 0,
    failed: 0,
    limited: 0,
    cached: 0,
    projection: null,
    layout: 'replace',
    error: null,
    unitError: null,
    configuration: null,
    configurationLoading: false,
    configurationError: null,
  }))
  private readonly occurrences = new OccurrenceTracker()
  private readonly blockOccurrences = new OccurrenceTracker()
  private blocks: ReadingBlock[] = []
  private engine: ReadingEngine | null = null
  private captureAbort: AbortController | null = null
  private source: Text | null = null
  private plugins: MarkdownPlugins = defaultMarkdownPlugins
  private units: ReadingUnit[] = []
  private readonly groups = new Map<string, TranslationGroup>()
  private readonly requests = new TranslationQueue<TranslationGroup>()
  private readonly buffer = new TranslationQueue<TranslationGroup>()
  private readonly outputs = new Map<string, string>()
  private readonly errors = new Map<string, string>()
  private readonly misses = new Set<string>()
  private readonly cached = new Set<string>()
  private readonly pending = new Map<string, Pending>()
  private readonly sent = new Set<string>()
  private generation = 0
  private semanticBytes = 0
  private descriptorBytes = 0
  private outputBytes = 0
  private renderBusy = false
  private renderAgain = false
  private renderDirty = false
  private renderTimer: ReturnType<typeof setTimeout> | null = null
  private progressTimer: ReturnType<typeof setTimeout> | null = null
  private enabled = false
  private network = false
  private restoring = false
  private layoutCustomized = false
  private allowed: Set<string> | null = null
  private disposed = false
  private active = true
  private unsubscribe: (() => void) | null = null
  private metadataSequence = 0
  constructor(
    private readonly document: Access,
    private readonly bridge: TranslationBridge,
    private readonly createEngine: () => ReadingEngine = () => new ReadingWorker(),
  ) {}
  attach(): void {
    this.active = true
    this.unsubscribe ??= this.bridge.onTranslationChanged(() => {
      void this.metadata()
    })
    if (this.store.getState().visible) void this.run(false, 'restore')
  }
  async metadata(): Promise<TranslationState | null> {
    if (this.disposed || !this.active) return null
    const sequence = ++this.metadataSequence
    this.store.setState({ configurationLoading: true, configurationError: null })
    try {
      const result = await this.bridge.translationState()
      if (this.disposed || !this.active || sequence !== this.metadataSequence) return null
      if (!result.ok) {
        this.store.setState({ configurationError: result.code ?? 'translation-settings' })
        return null
      }
      const previous = this.store.getState().configuration
      if (
        previous &&
        (previous.settingsRevision !== result.value.settingsRevision ||
          previous.cacheGeneration !== result.value.cacheGeneration)
      )
        this.release()
      this.store.setState({
        configuration: result.value,
        target: result.value.settings?.targetLanguage ?? defaultTranslationTarget,
      })
      return result.value
    } catch {
      if (!this.disposed && this.active && sequence === this.metadataSequence)
        this.store.setState({ configurationError: 'translation-settings' })
      return null
    } finally {
      if (!this.disposed && this.active && sequence === this.metadataSequence)
        this.store.setState({ configurationLoading: false })
    }
  }
  show(visible: boolean): void {
    const opening = visible && !this.store.getState().visible
    this.store.setState({ visible })
    if (opening) void this.run(false, 'restore')
    else if (!visible && this.restoring) this.release()
  }
  revealHeading(from: number): void {
    this.store.setState({ navigation: { from } })
  }
  changed(transactions: readonly Transaction[]): void {
    if (!transactions.some((transaction) => transaction.docChanged)) return
    for (const transaction of transactions)
      if (transaction.docChanged) {
        this.occurrences.map(transaction.changes)
        this.blockOccurrences.map(transaction.changes)
      }
    if (this.restoring) this.release()
    else if (this.source) this.store.setState({ stale: true })
    // Freeze the captured projection, even if provider responses for its old source arrive.
  }
  private matchingConventions(): boolean {
    const current = this.document.options().plugins ?? defaultMarkdownPlugins
    return markdownPluginNames.every((name) => current[name] === this.plugins[name])
  }
  conventionsChanged(): void {
    if (this.source && !this.matchingConventions()) this.store.setState({ stale: true })
  }
  async target(language: string): Promise<void> {
    const state = await this.metadata()
    if (
      !state?.settings ||
      state.configuration === 'read-only' ||
      language === state.settings.targetLanguage
    )
      return
    this.release()
    try {
      const result = await this.bridge.configureTranslation({
        ...state.settings,
        targetLanguage: language,
      })
      if (this.disposed) return
      if (result.ok)
        this.store.setState({
          configuration: result.value,
          target: result.value.settings?.targetLanguage ?? defaultTranslationTarget,
        })
      else this.store.setState({ error: result.code ?? 'translation-settings' })
    } catch {
      this.store.setState({ error: 'translation-settings' })
    }
  }
  async start(network: boolean, failedOnly = false): Promise<void> {
    await this.run(network, failedOnly ? 'retry' : 'translate')
  }
  private async run(network: boolean, mode: 'translate' | 'retry' | 'restore'): Promise<void> {
    const restore = mode === 'restore'
    const status = this.store.getState()
    if (this.disposed || !this.active || this.store.getState().phase === 'preparing') return
    if (restore && (!status.visible || status.phase !== 'idle' || status.projection)) return
    if (this.document.composing()) {
      if (!restore) this.store.setState({ error: 'translation-composing' })
      return
    }
    this.store.setState({ visible: true })
    const text = this.document.state().doc
    const revision = this.document.revision()
    const metadata = await this.metadata()
    if (this.disposed || !this.active) return
    if (!metadata) return
    if (restore && (!this.store.getState().visible || this.store.getState().phase !== 'idle'))
      return
    if (!metadata.settings) {
      if (!restore) this.store.setState({ error: 'translation-not-configured' })
      return
    }
    if (revision !== this.document.revision() || text !== this.document.state().doc) {
      if (!restore) this.store.setState({ error: 'translation-capture-changed' })
      return
    }
    const reusable =
      this.engine &&
      this.source === text &&
      this.matchingConventions() &&
      this.store.getState().revision === revision &&
      !this.store.getState().stale
    if (mode === 'retry' && !reusable) {
      this.store.setState({ error: 'translation-refresh-first' })
      return
    }
    this.enabled = false
    this.restoring = restore
    if (!reusable) {
      const generation = ++this.generation
      this.captureAbort?.abort()
      const abort = new AbortController()
      this.captureAbort = abort
      this.engine?.dispose()
      this.engine = null
      this.clearTimers()
      this.renderBusy = false
      this.renderAgain = false
      this.sent.clear()
      this.store.setState({ phase: 'preparing', error: null })
      try {
        const snapshot = await this.document.capture(revision, abort.signal)
        if (abort.signal.aborted || this.disposed || generation !== this.generation) {
          if (snapshot.kind === 'packed') snapshot.capture.release()
          return
        }
        let engine: ReadingEngine
        try {
          engine = this.createEngine()
        } catch (error) {
          if (snapshot.kind === 'packed') snapshot.capture.release()
          throw error
        }
        this.engine = engine
        const result = await prepareReading(
          engine,
          snapshot,
          text.toString(),
          metadata.settings,
          abort.signal,
        )
        if (abort.signal.aborted || this.disposed || generation !== this.generation) return
        if (result.kind !== 'prepared') throw new Error('translation-view-worker')
        const identities = this.occurrences.reconcile(
          result.units.map((unit) => ({
            kind: unit.kind,
            from: unit.from,
            to: unit.to,
            hash: unit.hash,
            lines: 1,
          })),
          text,
        )
        this.units = result.units.map((unit, index) => ({
          ...unit,
          occurrenceId: identities[index]?.id ?? crypto.randomUUID(),
        }))
        this.blocks = this.blockOccurrences
          .reconcile(
            result.blocks.map((block) => ({ ...block, lines: 1 })),
            text,
          )
          .map((block) => ({
            id: block.id,
            kind: block.kind,
            from: block.from,
            to: block.to,
            hash: block.hash,
          }))
        this.semanticBytes = Math.max(this.semanticBytes, snapshot.retainedBytes)
        this.descriptorBytes = sharedReadingPrepared({
          kind: 'prepared',
          units: this.units,
          blocks: this.blocks,
        }).bytes
        this.source = text
        this.plugins = { ...(snapshot.plugins ?? defaultMarkdownPlugins) }
        this.errors.clear()
        this.misses.clear()
        this.resetWork()
        for (const key of this.outputs.keys())
          if (!this.groups.has(key)) {
            this.outputBytes -= (this.outputs.get(key)?.length ?? 0) * 2
            this.outputs.delete(key)
            this.cached.delete(key)
          }
        if (this.descriptorBytes > readingLimits.descriptors || !this.fits(0))
          throw new Error('translation-view-limit')
        for (const [key, pending] of this.pending) {
          const current = this.groups.get(key)
          if (!current?.units.some((unit) => pending.ids.has(unit.occurrenceId)))
            this.cancelPending(key, pending)
        }
        this.store.setState({
          revision,
          stale: revision !== this.document.revision() || !this.matchingConventions(),
          projection: null,
          error: null,
        })
        if (!restore) await this.render(generation)
        if (generation !== this.generation || this.disposed) return
      } catch (error) {
        if (generation === this.generation && !this.disposed) this.failed(error)
        return
      }
    } else this.resetWork()
    if (this.disposed) return
    this.allowed = mode === 'retry' ? new Set(this.errors.keys()) : null
    this.errors.clear()
    if (mode !== 'retry') this.misses.clear()
    this.enabled = true
    this.network = network
    this.store.setState({ phase: 'translating', error: null })
    this.progress(true)
    this.pump()
  }
  private resetWork(): void {
    this.clearWork()
    for (const unit of this.units) {
      if (!unit.key) continue
      // Completed text is retained once for reuse/export; its request payload can expire.
      if (this.outputs.has(unit.key)) unit.payload = null
      if (this.sent.has(unit.key)) continue
      let group = this.groups.get(unit.key)
      if (!group) {
        group = { key: unit.key, units: [] }
        this.groups.set(unit.key, group)
      }
      group.units.push(unit)
    }
    this.requests.reset(this.groups.values())
    this.buffer.reset(this.groups.values())
  }
  private clearWork(): void {
    this.requests.clear()
    this.buffer.clear()
    this.groups.clear()
  }
  private fits(projectionBytes: number): boolean {
    return (
      this.semanticBytes + this.descriptorBytes + this.outputBytes + projectionBytes <=
      semanticLimits.snapshotBytes
    )
  }
  private pump(): void {
    if (!this.enabled || this.disposed || !this.engine) return
    // Opening restores a complete saved copy. A miss leaves new work behind Translate.
    if (this.restoring && (this.misses.size || this.errors.size || this.store.getState().stale)) {
      this.release()
      return
    }
    const state = this.store.getState().configuration
    if (!state?.settings) return
    while (this.pending.size < readingLimits.requests) {
      const group = this.requests.take()
      if (!group) break
      const { key, units } = group
      if (this.allowed && !this.allowed.has(key)) continue
      if (
        this.outputs.has(key) ||
        this.errors.has(key) ||
        this.misses.has(key) ||
        this.pending.has(key)
      )
        continue
      const unit = units[0]
      if (!unit?.payload) continue
      const request: TranslationRequest = {
        requestId: crypto.randomUUID(),
        documentId: this.document.id,
        occurrenceId: unit.occurrenceId,
        sessionGeneration: this.generation,
        settingsRevision: state.settingsRevision,
        cacheGeneration: state.cacheGeneration,
        unitKey: key,
        payload: unit.payload,
        network: this.network,
      }
      const pending: Pending = { request, ids: new Set(units.map((value) => value.occurrenceId)) }
      this.pending.set(key, pending)
      void this.bridge
        .translateUnit(request)
        .then((result) => {
          if (this.pending.get(key) !== pending || this.disposed) return
          const configuration = this.store.getState().configuration
          if (
            !configuration ||
            configuration.settingsRevision !== request.settingsRevision ||
            configuration.cacheGeneration !== request.cacheGeneration
          )
            return
          if (!result.ok) {
            this.errors.set(key, result.code ?? 'translation-network')
            return
          }
          const value = result.value
          if (
            value.requestId !== request.requestId ||
            value.documentId !== request.documentId ||
            value.occurrenceId !== request.occurrenceId ||
            value.sessionGeneration !== request.sessionGeneration ||
            value.settingsRevision !== request.settingsRevision ||
            value.cacheGeneration !== request.cacheGeneration ||
            value.unitKey !== key
          ) {
            this.errors.set(key, 'translation-response')
            return
          }
          if (value.output === null) {
            this.misses.add(key)
            return
          }
          validateTranslation(request.payload, value.output)
          const bytes = value.output.length * 2 - (this.outputs.get(key)?.length ?? 0) * 2
          const projection = this.store.getState().projection
          if (
            this.outputBytes + bytes > readingLimits.outputs ||
            !this.fits(bytes + (projection ? readingProjectionBytes(projection) : 0))
          ) {
            this.errors.set(key, 'translation-view-limit')
            return
          }
          this.outputs.set(key, value.output)
          for (const unit of this.groups.get(key)?.units ?? []) unit.payload = null
          this.outputBytes += bytes
          if (value.cached) this.cached.add(key)
          this.store.setState({ configuration: { ...configuration, cache: value.cache } })
        })
        .catch(() => {
          if (this.pending.get(key) === pending) this.errors.set(key, 'translation-response')
        })
        .finally(() => {
          if (this.pending.get(key) !== pending) return
          this.pending.delete(key)
          this.progress()
          this.pump()
          this.scheduleRender()
        })
    }
    if (!this.pending.size) {
      this.enabled = false
      if (this.restoring && !this.outputs.size) {
        this.release()
        return
      }
      this.restoring = false
      this.store.setState({ phase: 'ready' })
      this.progress(true)
      this.scheduleRender(true)
    }
  }
  private progress(immediate = false): void {
    if (!immediate && this.progressTimer) return
    const apply = (): void => {
      this.progressTimer = null
      let completed = 0,
        failed = 0,
        limited = 0,
        cached = 0
      for (const unit of this.units) {
        if (!unit.key) limited++
        else if (this.outputs.has(unit.key)) {
          completed++
          if (this.cached.has(unit.key)) cached++
        } else if (this.errors.has(unit.key)) failed++
      }
      this.store.setState({
        total: this.units.length,
        completed,
        failed,
        limited,
        cached,
        unitError: this.errors.values().next().value ?? null,
      })
    }
    if (immediate) {
      if (this.progressTimer) clearTimeout(this.progressTimer)
      apply()
    } else this.progressTimer = setTimeout(apply, readingLimits.progressMs)
  }
  private scheduleRender(immediate = false): void {
    if (this.restoring || this.store.getState().phase === 'preparing' || !this.engine) return
    if (this.renderTimer) {
      if (!immediate) return
      clearTimeout(this.renderTimer)
    }
    const generation = this.generation
    this.renderTimer = setTimeout(
      () => {
        this.renderTimer = null
        void this.render(generation).catch((error) => {
          if (generation === this.generation && !this.disposed) this.failed(error)
        })
      },
      immediate ? 0 : readingLimits.renderMs,
    )
  }
  private async render(generation: number): Promise<void> {
    if (this.restoring) return
    if (this.renderBusy) {
      this.renderAgain = true
      return
    }
    const engine = this.engine
    if (!engine) return
    const outputs: { key: string; output: string }[] = []
    // Requests run concurrently. Publish only the settled prefix in source order.
    const status = this.store.getState()
    const copy = readingCopy[i18next.language === 'zh-CN' ? 'zh-CN' : 'en']
    const operation: Extract<ReadingOperation, { kind: 'render' }> = {
      kind: 'render',
      outputs,
      options: { ...this.document.options(), plugins: this.plugins },
      layout: status.layout,
      blocks: this.blocks,
      labels: { original: copy.original, translation: copy.translation },
    }
    let bytes = readingOperationBytes(operation) + 1024
    while (this.buffer.first) {
      const { key } = this.buffer.first
      const output = this.outputs.get(key)
      if (output === undefined) {
        if (
          !this.errors.has(key) &&
          !this.misses.has(key) &&
          status.phase !== 'cancelled' &&
          status.phase !== 'ready'
        )
          break
      } else if (!this.sent.has(key)) {
        const entry = { key, output }
        const size = readingJsonBytes(entry) + 1
        if (bytes + size > readingLimits.message) {
          if (!outputs.length) throw new Error('translation-view-limit')
          this.renderAgain = true
          break
        }
        outputs.push(entry)
        bytes += size
      }
      this.buffer.take()
      this.groups.delete(key)
    }
    if (!outputs.length && !this.renderDirty && status.projection?.layout === status.layout) return
    this.renderBusy = true
    this.renderDirty = false
    try {
      const result = await engine.request(operation)
      if (generation !== this.generation || this.disposed) return
      if (result.kind !== 'rendered' || !this.fits(readingProjectionBytes(result.projection)))
        throw new Error('translation-view-limit')
      for (const output of outputs) this.sent.add(output.key)
      if (result.projection.layout === this.store.getState().layout)
        this.store.setState({ projection: result.projection })
      else this.renderAgain = true
    } finally {
      if (generation === this.generation) {
        this.renderBusy = false
        if (this.renderAgain) {
          this.renderAgain = false
          this.scheduleRender()
        }
      }
    }
  }
  refreshRendering(): void {
    this.renderDirty = true
    this.scheduleRender(true)
  }
  setLayout(layout: ReadingLayout): void {
    if (!['replace', 'side-by-side', 'interlinear'].includes(layout)) return
    this.layoutCustomized = true
    this.store.setState({ layout })
    this.scheduleRender(true)
  }
  setDefaultLayout(layout: ReadingLayout): void {
    if (
      this.layoutCustomized ||
      this.source ||
      !['replace', 'side-by-side', 'interlinear'].includes(layout)
    )
      return
    this.store.setState({ layout })
  }
  captureExport(): {
    source: string
    revision: number
    reading: ReadingExport
    missing: number
    plugins: MarkdownPlugins
  } {
    const status = this.store.getState()
    const settings = status.configuration?.settings
    if (!this.source || status.revision === null || !settings || !status.projection)
      throw new Error('export-reading-empty')
    const units = this.units.flatMap((unit, index) => {
      const output = unit.key && this.sent.has(unit.key) ? this.outputs.get(unit.key) : undefined
      return output === undefined ? [] : [{ index, output }]
    })
    const snapshot = {
      source: this.source.toString(),
      revision: status.revision,
      plugins: { ...this.plugins },
      missing: this.units.length - units.length,
      reading: {
        schema: 'mdast-reading/v1' as const,
        layout: status.layout,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        units,
        missing: 'reject' as const,
        stale: status.stale,
        confirmed: false,
      },
    }
    if (
      units.reduce((bytes, unit) => bytes + unit.output.length * 2, 0) > readingBudgets.outputs ||
      readingJsonBytes(snapshot) > readingBudgets.exportRequest
    )
      throw new Error('export-limit')
    return snapshot
  }
  /** New source semantics share the allowance with an older, visibly stale reading copy. */
  semanticChanged(retainedBytes: number): void {
    this.semanticBytes = retainedBytes
    const projection = this.store.getState().projection
    if (this.source && !this.fits(projection ? readingProjectionBytes(projection) : 0)) {
      this.release()
      this.store.setState({ phase: 'error', error: 'translation-view-limit' })
    }
  }
  private cancelPending(key: string, pending: Pending): void {
    this.pending.delete(key)
    void this.bridge.cancelTranslation(pending.request.requestId).catch(() => {})
  }
  cancel(): void {
    if (this.restoring) {
      this.release()
      return
    }
    this.enabled = false
    this.requests.clear()
    this.captureAbort?.abort()
    this.captureAbort = null
    for (const [key, pending] of this.pending) this.cancelPending(key, pending)
    if (this.store.getState().phase === 'preparing') {
      this.generation++
      this.engine?.dispose()
      this.engine = null
      this.renderBusy = false
      this.clearWork()
    }
    this.store.setState({ phase: 'cancelled', error: null })
    this.progress(true)
    this.scheduleRender(true)
  }
  private failed(error: unknown): void {
    this.enabled = false
    this.restoring = false
    for (const [key, pending] of this.pending) this.cancelPending(key, pending)
    this.engine?.dispose()
    this.engine = null
    this.clearWork()
    this.clearTimers()
    this.renderBusy = false
    this.store.setState({
      phase: 'error',
      error: error instanceof Error ? error.message : 'translation-view-worker',
    })
  }
  mountFailed(): void {
    this.release()
    this.store.setState({ phase: 'error', error: 'translation-view-limit' })
  }
  private clearTimers(): void {
    if (this.progressTimer) clearTimeout(this.progressTimer)
    if (this.renderTimer) clearTimeout(this.renderTimer)
    this.progressTimer = this.renderTimer = null
  }
  private release(): void {
    this.enabled = false
    this.restoring = false
    this.allowed = null
    this.generation++
    this.captureAbort?.abort()
    this.captureAbort = null
    for (const [key, pending] of this.pending) this.cancelPending(key, pending)
    this.engine?.dispose()
    this.engine = null
    this.clearTimers()
    this.source = null
    this.units = []
    this.blocks = []
    this.clearWork()
    this.outputs.clear()
    this.errors.clear()
    this.misses.clear()
    this.cached.clear()
    this.sent.clear()
    this.outputBytes = this.descriptorBytes = this.semanticBytes = 0
    this.renderBusy = this.renderAgain = this.renderDirty = false
    this.store.setState({
      phase: 'idle',
      stale: false,
      revision: null,
      projection: null,
      total: 0,
      completed: 0,
      failed: 0,
      limited: 0,
      cached: 0,
      error: null,
      unitError: null,
    })
  }
  suspend(): void {
    this.active = false
    this.metadataSequence++
    this.store.setState({ configurationLoading: false })
    this.unsubscribe?.()
    this.unsubscribe = null
    this.release()
    this.occurrences.reset()
    this.blockOccurrences.reset()
  }
  dispose(): void {
    this.disposed = true
    this.suspend()
  }
}
