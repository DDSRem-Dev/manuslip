import {
  deepLMetadataEndpoint,
  type ProviderLanguage,
  type TranslationSettings,
  translationSettingsKey,
  translationUnitKey,
  validateTranslation,
} from '@manuslip/translate'
import {
  parseCredentialRequest,
  parseTranslationRequest,
  parseTranslationSettings,
  providerCapabilities,
  type TranslationOutcome,
  type TranslationRequest,
  type TranslationState,
  transportLimits,
} from '../../shared/translation-contracts'
import type { TranslationCache } from './cache'
import type { TranslationConfiguration } from './configuration'
import { credentialBinding, type TranslationCredentials } from './credentials'
import { deepLLimits, loadDeepLLanguages } from './deepl'
import { TranslationFailure } from './errors'
import { translateWithProvider } from './providers'

interface Subscriber {
  owner: number
  request: TranslationRequest
  job: Job | null
  reject(error: TranslationFailure): void
  resolve(value: TranslationOutcome): void
}
interface Job {
  identity: string
  request: TranslationRequest
  settings: TranslationSettings
  controller: AbortController
  subscribers: Set<Subscriber>
  timer: ReturnType<typeof setTimeout>
  running: boolean
}
type Provider = typeof translateWithProvider
/** Main owns transport and generation barriers. Renderer owns occurrence/source reconciliation. */
export class TranslationService {
  private settingsRevision = 0
  private cacheGeneration = 0
  private controls = 0
  private controlQueue: Promise<unknown> = Promise.resolve()
  private readonly subscribers = new Map<string, Subscriber>()
  private readonly jobs = new Map<string, Job>()
  private readonly waiting: Job[] = []
  private active = 0
  private closed = false
  private catalog: { binding: string; expires: number; languages: ProviderLanguage[] } | null = null
  private metadata: AbortController | null = null
  private metadataGeneration = 0
  constructor(
    private readonly configuration: TranslationConfiguration,
    private readonly credentials: TranslationCredentials,
    private readonly cache: TranslationCache,
    private readonly changed: () => void,
    private readonly provider: Provider = translateWithProvider,
    private readonly languageLoader: typeof loadDeepLLanguages = loadDeepLLanguages,
  ) {}
  private control<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed || this.controls >= 8)
      return Promise.reject(new TranslationFailure('translation-busy'))
    this.controls++
    const result = this.controlQueue.then(operation).finally(() => {
      this.controls--
    })
    this.controlQueue = result.catch(() => {})
    return result
  }
  private catalogBinding(settings: TranslationSettings): string {
    return settings.provider.adapter === 'deepl'
      ? JSON.stringify([
          credentialBinding(settings.provider),
          deepLMetadataEndpoint(settings.provider),
        ])
      : ''
  }
  async state(): Promise<TranslationState> {
    await this.configuration.load()
    const settings = this.configuration.current
    return {
      settings: settings ? structuredClone(settings) : null,
      settingsRevision: this.settingsRevision,
      cacheGeneration: this.cacheGeneration,
      credential: await this.credentials.status(
        settings ? credentialBinding(settings.provider) : null,
      ),
      cache: this.cache.status,
      configuration: this.configuration.status,
      ...(settings &&
      this.catalog?.binding === this.catalogBinding(settings) &&
      this.catalog.expires > Date.now()
        ? { languages: structuredClone(this.catalog.languages) }
        : {}),
    }
  }
  /** An explicit command; state()/preferences never initiate discovery. */
  async loadLanguages(): Promise<TranslationState> {
    if (this.closed || this.controls || this.metadata)
      throw new TranslationFailure('translation-busy')
    const controller = new AbortController()
    this.metadata = controller
    try {
      await this.configuration.load()
      const settings = this.configuration.current
      if (settings?.provider.adapter !== 'deepl')
        throw new TranslationFailure('translation-settings')
      await this.languages(settings, controller.signal, true)
      return await this.state()
    } finally {
      if (this.metadata === controller) this.metadata = null
    }
  }
  private async languages(
    settings: TranslationSettings,
    signal: AbortSignal,
    refresh = false,
  ): Promise<ProviderLanguage[]> {
    const binding = this.catalogBinding(settings)
    if (!refresh && this.catalog?.binding === binding && this.catalog.expires > Date.now())
      return this.catalog.languages
    const generation = this.metadataGeneration
    const key = await this.credentials.get(credentialBinding(settings.provider))
    if (signal.aborted || generation !== this.metadataGeneration || this.closed)
      throw new TranslationFailure('translation-cancelled')
    const languages = await this.languageLoader(settings, key, signal)
    if (signal.aborted || generation !== this.metadataGeneration || this.closed)
      throw new TranslationFailure('translation-cancelled')
    this.catalog = { binding, languages, expires: Date.now() + deepLLimits.metadataAgeMs }
    this.changed()
    return languages
  }
  configure(input: unknown): Promise<TranslationState> {
    let settings: TranslationSettings
    try {
      settings = parseTranslationSettings(input)
    } catch {
      return Promise.reject(new TranslationFailure('translation-settings'))
    }
    return this.control(async () => {
      await this.configuration.load()
      if (
        this.configuration.current &&
        (await translationSettingsKey(this.configuration.current, providerCapabilities)) ===
          (await translationSettingsKey(settings, providerCapabilities))
      )
        return this.state()
      this.settingsRevision++
      this.invalidate('translation-stale')
      const previousBinding = this.configuration.current
        ? credentialBinding(this.configuration.current.provider)
        : null
      try {
        await this.configuration.save(settings)
      } finally {
        this.changed()
      }
      if (previousBinding !== credentialBinding(settings.provider)) {
        this.credentials.forgetSession()
        this.catalog = null
      }
      return this.state()
    })
  }
  setCredential(input: unknown): Promise<TranslationState> {
    const request = parseCredentialRequest(input)
    return this.control(async () => {
      await this.configuration.load()
      const settings = this.configuration.current
      if (!settings || request.settingsRevision !== this.settingsRevision)
        throw new TranslationFailure('translation-stale')
      // Invalidate admitted requests before credentials can change beneath them.
      this.invalidate('translation-cancelled')
      this.catalog = null
      try {
        await this.credentials.set(credentialBinding(settings.provider), request)
      } finally {
        this.changed()
      }
      return this.state()
    })
  }
  clear(): Promise<TranslationState> {
    return this.control(async () => {
      this.cacheGeneration++
      this.invalidate('translation-stale')
      this.changed()
      const result = await this.cache.request({ kind: 'clear' })
      if (result.status === 'unavailable' || result.status === 'future')
        throw new TranslationFailure('translation-storage')
      return this.state()
    })
  }
  request(owner: number, input: unknown): Promise<TranslationOutcome> {
    let request: TranslationRequest
    try {
      request = parseTranslationRequest(input)
    } catch {
      return Promise.reject(new TranslationFailure('translation-invalid'))
    }
    const identity = `${owner}:${request.requestId}`
    if (
      this.closed ||
      this.controls ||
      this.subscribers.size >= transportLimits.subscriptions ||
      this.subscribers.has(identity)
    )
      return Promise.reject(new TranslationFailure('translation-busy'))
    return new Promise((resolve, reject) => {
      const subscriber: Subscriber = { owner, request, job: null, resolve, reject }
      this.subscribers.set(identity, subscriber)
      void this.admit(subscriber).catch((error: unknown) => {
        if (this.subscribers.get(identity) !== subscriber) return
        this.subscribers.delete(identity)
        reject(
          error instanceof TranslationFailure
            ? error
            : new TranslationFailure('translation-invalid'),
        )
      })
    })
  }
  private current(subscriber: Subscriber): boolean {
    return (
      !this.closed &&
      this.subscribers.get(`${subscriber.owner}:${subscriber.request.requestId}`) === subscriber &&
      subscriber.request.settingsRevision === this.settingsRevision &&
      subscriber.request.cacheGeneration === this.cacheGeneration
    )
  }
  private async admit(subscriber: Subscriber): Promise<void> {
    await this.configuration.load()
    const settings = this.configuration.current
    if (!settings || !this.current(subscriber)) throw new TranslationFailure('translation-stale')
    const request = subscriber.request
    const key = await translationUnitKey(
      request.payload,
      await translationSettingsKey(settings, providerCapabilities),
    )
    if (!this.current(subscriber)) throw new TranslationFailure('translation-stale')
    if (key !== request.unitKey) throw new TranslationFailure('translation-invalid')
    const identity = `${request.network}:${key}`
    let job = this.jobs.get(identity)
    if (!job) {
      if (this.waiting.length >= transportLimits.waiting)
        throw new TranslationFailure('translation-busy')
      const controller = new AbortController()
      job = {
        identity,
        request,
        settings: structuredClone(settings),
        controller,
        subscribers: new Set(),
        running: false,
        timer: setTimeout(() => {
          if (job) this.failJob(job, new TranslationFailure('translation-timeout'))
        }, transportLimits.deadlineMs),
      }
      this.jobs.set(identity, job)
      this.waiting.push(job)
    }
    subscriber.job = job
    job.subscribers.add(subscriber)
    this.pump()
  }
  private pump(): void {
    while (!this.closed && this.active < transportLimits.active && this.waiting.length) {
      const job = this.waiting.shift()
      if (!job || job.controller.signal.aborted) continue
      job.running = true
      this.active++
      void this.run(job)
        .catch((error: unknown) =>
          this.failJob(
            job,
            error instanceof TranslationFailure
              ? error
              : new TranslationFailure('translation-response'),
          ),
        )
        .finally(() => {
          this.active--
          if (this.jobs.get(job.identity) === job) this.jobs.delete(job.identity)
          clearTimeout(job.timer)
          this.pump()
        })
    }
  }
  private valid(job: Job): boolean {
    return (
      !this.closed &&
      !job.controller.signal.aborted &&
      job.subscribers.size > 0 &&
      job.request.settingsRevision === this.settingsRevision &&
      job.request.cacheGeneration === this.cacheGeneration
    )
  }
  private async run(job: Job): Promise<void> {
    const payload = JSON.stringify(job.request.payload)
    const cached = await this.cache.request({ kind: 'get', key: job.request.unitKey, payload })
    if (!this.valid(job)) return
    let output = cached.output
    if (output !== null) {
      try {
        validateTranslation(job.request.payload, output)
      } catch {
        output = null
      }
    }
    const hit = output !== null
    if (output === null && job.request.network) {
      const key = await this.credentials.get(credentialBinding(job.settings.provider))
      if (!this.valid(job)) return
      if (job.settings.provider.adapter === 'deepl') {
        const languages = await this.languages(job.settings, job.controller.signal)
        if (!this.valid(job)) return
        output = await this.provider(
          job.settings,
          job.request.payload,
          key,
          job.controller.signal,
          undefined,
          languages,
        )
      } else
        output = await this.provider(job.settings, job.request.payload, key, job.controller.signal)
      if (!this.valid(job)) return
      try {
        validateTranslation(job.request.payload, output)
      } catch {
        throw new TranslationFailure('translation-response')
      }
      // No await between the generation check and posting the write. Clear is ordered after it.
      await this.cache.request({ kind: 'put', key: job.request.unitKey, payload, output })
      if (!this.valid(job)) return
    }
    for (const subscriber of job.subscribers) {
      if (!this.current(subscriber)) continue
      this.subscribers.delete(`${subscriber.owner}:${subscriber.request.requestId}`)
      const { payload: _payload, network: _network, ...context } = subscriber.request
      subscriber.resolve({ ...context, output, cached: hit, cache: this.cache.status })
    }
    job.subscribers.clear()
  }
  private failJob(job: Job, error: TranslationFailure): void {
    for (const subscriber of [...job.subscribers]) this.cancelSubscriber(subscriber, error)
    job.controller.abort()
    clearTimeout(job.timer)
    if (this.jobs.get(job.identity) === job) this.jobs.delete(job.identity)
    const index = this.waiting.indexOf(job)
    if (index >= 0) this.waiting.splice(index, 1)
  }
  private cancelSubscriber(subscriber: Subscriber, error: TranslationFailure): void {
    this.subscribers.delete(`${subscriber.owner}:${subscriber.request.requestId}`)
    const job = subscriber.job
    job?.subscribers.delete(subscriber)
    subscriber.reject(error)
    if (job && !job.subscribers.size) {
      job.controller.abort()
      clearTimeout(job.timer)
      if (this.jobs.get(job.identity) === job) this.jobs.delete(job.identity)
      const index = this.waiting.indexOf(job)
      if (index >= 0) this.waiting.splice(index, 1)
    }
  }
  cancel(owner: number, requestId: string): void {
    const subscriber = this.subscribers.get(`${owner}:${requestId}`)
    if (subscriber)
      this.cancelSubscriber(subscriber, new TranslationFailure('translation-cancelled'))
  }
  closeDocument(owner: number, documentId: string): void {
    for (const subscriber of [...this.subscribers.values()])
      if (subscriber.owner === owner && subscriber.request.documentId === documentId)
        this.cancelSubscriber(subscriber, new TranslationFailure('translation-cancelled'))
  }
  closeOwner(owner: number): void {
    this.metadata?.abort()
    for (const subscriber of [...this.subscribers.values()])
      if (subscriber.owner === owner)
        this.cancelSubscriber(subscriber, new TranslationFailure('translation-cancelled'))
  }
  private invalidate(code: 'translation-stale' | 'translation-cancelled'): void {
    this.metadataGeneration++
    this.metadata?.abort()
    for (const subscriber of [...this.subscribers.values()])
      this.cancelSubscriber(subscriber, new TranslationFailure(code))
  }
  dispose(): void {
    this.closed = true
    this.invalidate('translation-cancelled')
    this.credentials.forgetSession()
    this.cache.dispose()
  }
}
