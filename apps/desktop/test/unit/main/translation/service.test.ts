import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  extractionVersion,
  type ProviderLanguage,
  type TranslationPayload,
  type TranslationSettings,
  translationSettingsKey,
  translationUnitKey,
} from '@manuslip/translate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as cacheHash from '../../../../../../packages/translate/src/cache-hash'
import type { TranslationCache } from '../../../../src/main/translation/cache'
import type { CacheOperation } from '../../../../src/main/translation/cache-store'
import { TranslationConfiguration } from '../../../../src/main/translation/configuration'
import { TranslationCredentials } from '../../../../src/main/translation/credentials'
import type { loadDeepLLanguages } from '../../../../src/main/translation/deepl'
import { TranslationService } from '../../../../src/main/translation/service'
import {
  providerCapabilities,
  type TranslationRequest,
} from '../../../../src/shared/translation-contracts'

const directories: string[] = [],
  services: TranslationService[] = []
const settings: TranslationSettings = {
  provider: {
    adapter: 'openai-compatible',
    version: '1',
    baseUrl: 'http://127.0.0.1:8080/chat',
    model: 'test-model',
    profile: null,
    options: {},
  },
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  glossary: [],
  formality: 'default',
  promptVersion: 'prose-translation/v1',
}
const payload = (text = 'Hello world'): TranslationPayload => ({
  schema: extractionVersion,
  kind: 'paragraph',
  text,
  tokens: [],
})
class MemoryCache implements TranslationCache {
  status: TranslationCache['status'] = 'ready'
  readonly entries = new Map<string, { scope: string; payload: string; output: string }>()
  readonly operations: CacheOperation[] = []
  async request(operation: CacheOperation) {
    this.operations.push(operation)
    if (operation.kind === 'clear') this.entries.clear()
    if (operation.kind === 'put' && this.status === 'ready')
      this.entries.set(operation.key, operation)
    const row = operation.kind === 'get' ? this.entries.get(operation.key) : null
    return {
      status: this.status,
      output:
        operation.kind === 'get' &&
        row?.scope === operation.scope &&
        row.payload === operation.payload
          ? row.output
          : null,
    }
  }
  dispose() {}
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Not initialized')
  }
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function setup(
  provider = vi.fn(async (_settings: TranslationSettings, input: TranslationPayload) =>
    input.text.replace('Hello', '你好'),
  ),
  cache = new MemoryCache(),
  languageLoader?: typeof loadDeepLLanguages,
) {
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-translation-service-'))
  directories.push(directory)
  const configuration = new TranslationConfiguration(join(directory, 'settings.json'))
  const credentials = new TranslationCredentials(join(directory, 'key.json'), {
    available: async () => false,
    encrypt: async () => Buffer.alloc(0),
    decrypt: async () => ({ result: '', shouldReEncrypt: false }),
  })
  const changed = vi.fn()
  const service = new TranslationService(
    configuration,
    credentials,
    cache,
    changed,
    provider,
    languageLoader,
  )
  services.push(service)
  await service.configure(settings)
  async function request(
    text = 'Hello world',
    overrides: Partial<TranslationRequest> = {},
  ): Promise<TranslationRequest> {
    const state = await service.state()
    if (!state.settings) throw new Error('No settings')
    const input = payload(text)
    return {
      requestId: randomUUID(),
      documentId: randomUUID(),
      occurrenceId: randomUUID(),
      sessionGeneration: 0,
      settingsRevision: state.settingsRevision,
      cacheGeneration: state.cacheGeneration,
      unitKey: await translationUnitKey(
        input,
        await translationSettingsKey(state.settings, providerCapabilities),
      ),
      payload: input,
      network: true,
      ...overrides,
    }
  }
  return { service, request, cache, provider, changed }
}
afterEach(async () => {
  for (const service of services.splice(0)) service.dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})
describe('main-owned translation subscriptions', () => {
  it('does not merge different payloads when their MurmurHash keys collide', async () => {
    vi.spyOn(cacheHash, 'murmurHash128').mockResolvedValue('a'.repeat(32))
    const { service, request, provider } = await setup()
    const first = await request('Hello first')
    const second = await request('Hello second')
    const results = await Promise.all([service.request(1, first), service.request(1, second)])
    expect(results.map((result) => result.output)).toEqual(['你好 first', '你好 second'])
    expect(provider).toHaveBeenCalledTimes(2)
  })
  const languages: ProviderLanguage[] = [
    { tag: 'zh-Hans', source: false, target: true, formality: false, glossary: true, tags: true },
  ]
  const deepl: TranslationSettings = {
    ...settings,
    provider: { ...settings.provider, adapter: 'deepl', model: null },
  }
  async function deepLSetup(loader: typeof loadDeepLLanguages) {
    const context = await setup(undefined, undefined, loader)
    const state = await context.service.configure(deepl)
    await context.service.setCredential({
      settingsRevision: state.settingsRevision,
      key: 'dummy-deepl-key',
      persist: false,
    })
    return context
  }
  it('keeps state and cache lookup offline, reuses discovered capabilities, and clears metadata when a credential changes', async () => {
    const loader = vi.fn<typeof loadDeepLLanguages>(async () => languages)
    const { service, request, provider } = await deepLSetup(loader)
    await service.state()
    expect(
      await service.request(1, await request('Hello offline', { network: false })),
    ).toMatchObject({ output: null })
    expect(loader).not.toHaveBeenCalled()
    expect(provider).not.toHaveBeenCalled()
    expect((await service.loadLanguages()).languages).toEqual(languages)
    await service.request(1, await request())
    expect(loader).toHaveBeenCalledTimes(1)
    expect((provider.mock.calls[0] as unknown[])[5]).toEqual(languages)
    expect(await service.request(1, await request())).toMatchObject({ cached: true })
    const state = await service.state()
    await service.setCredential({
      settingsRevision: state.settingsRevision,
      key: null,
      persist: false,
    })
    expect((await service.state()).languages).toBeUndefined()
    expect(
      await service.request(1, await request('Hello world', { network: false })),
    ).toMatchObject({ cached: true })
    expect(loader).toHaveBeenCalledTimes(1)
  })
  it('fetches metadata inside an admitted translation only on a cache miss', async () => {
    const loader = vi.fn<typeof loadDeepLLanguages>(async () => languages)
    const { service, request } = await deepLSetup(loader)
    expect(await service.request(1, await request())).toMatchObject({ output: '你好 world' })
    expect((await service.state()).languages).toEqual(languages)
    expect(await service.request(1, await request())).toMatchObject({ cached: true })
    expect(loader).toHaveBeenCalledTimes(1)
  })
  it.each(['configure', 'credential', 'clear', 'owner', 'dispose'])(
    'aborts discovery and rejects ignored late output after %s',
    async (operation) => {
      const gate = deferred<ProviderLanguage[]>()
      const loader = vi.fn<typeof loadDeepLLanguages>(async () => gate.promise)
      const { service } = await deepLSetup(loader)
      const pending = service.loadLanguages().catch((error) => error)
      await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
      await expect(service.loadLanguages()).rejects.toMatchObject({ code: 'translation-busy' })
      if (operation === 'configure') await service.configure({ ...deepl, targetLanguage: 'ja' })
      if (operation === 'credential')
        await service.setCredential({
          settingsRevision: (await service.state()).settingsRevision,
          key: 'dummy-replacement',
          persist: false,
        })
      if (operation === 'clear') await service.clear()
      if (operation === 'owner') service.closeOwner(1)
      if (operation === 'dispose') service.dispose()
      expect(loader.mock.calls[0]?.[2].aborted).toBe(true)
      gate.resolve(languages)
      expect(await pending).toMatchObject({ code: 'translation-cancelled' })
      expect((await service.state()).languages).toBeUndefined()
    },
  )
  it('expires metadata and isolates an overridden metadata route without changing the credential binding', async () => {
    const now = vi.spyOn(Date, 'now')
    const loader = vi.fn<typeof loadDeepLLanguages>(async () => languages)
    const { service, request } = await deepLSetup(loader)
    await service.loadLanguages()
    await service.configure({
      ...deepl,
      provider: {
        ...deepl.provider,
        options: { languagesEndpoint: 'http://127.0.0.1:8080/other/languages' },
      },
    })
    expect((await service.state()).credential).toBe('session')
    expect((await service.state()).languages).toBeUndefined()
    await service.request(1, await request())
    expect(loader).toHaveBeenCalledTimes(2)
    now.mockReturnValue(Date.now() + 15 * 60_000 + 1)
    expect((await service.state()).languages).toBeUndefined()
    await service.request(1, await request('Hello different'))
    expect(loader).toHaveBeenCalledTimes(3)
  })
  it('deduplicates occurrences, resolves their own context and cancels transport only after the last subscriber', async () => {
    const gate = deferred<string>()
    const provider = vi.fn(async () => gate.promise)
    const { service, request } = await setup(provider)
    const first = await request(),
      second = await request()
    const a = service.request(1, first).catch((error) => error)
    const b = service.request(1, second)
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1))
    service.cancel(2, first.requestId) // Another owner cannot cancel it.
    service.cancel(1, first.requestId)
    expect(await a).toMatchObject({ code: 'translation-cancelled' })
    const args = provider.mock.calls[0] as unknown as [unknown, unknown, unknown, AbortSignal]
    expect(args[3].aborted).toBe(false)
    gate.resolve('你好世界')
    expect(await b).toMatchObject({
      requestId: second.requestId,
      occurrenceId: second.occurrenceId,
      output: '你好世界',
      cached: false,
    })
    expect(provider).toHaveBeenCalledTimes(1)
  })
  it('aborts on the last cancellation and never persists a late provider response', async () => {
    const gate = deferred<string>(),
      provider = vi.fn(async () => gate.promise)
    const { service, request, cache } = await setup(provider)
    const input = await request()
    const pending = service.request(1, input).catch((error) => error)
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1))
    service.cancel(1, input.requestId)
    expect(await pending).toMatchObject({ code: 'translation-cancelled' })
    expect(
      (provider.mock.calls[0] as unknown as [unknown, unknown, unknown, AbortSignal])[3].aborted,
    ).toBe(true)
    gate.resolve('Late text')
    await vi.waitFor(() =>
      expect(cache.operations.filter((operation) => operation.kind === 'put')).toHaveLength(0),
    )
    expect(cache.entries.size).toBe(0)
  })
  it('serves cache-only misses without networking and successful cached hits without credentials/provider calls', async () => {
    const { service, request, provider, cache } = await setup()
    const miss = await service.request(1, await request('Hello world', { network: false }))
    expect(miss.output).toBeNull()
    expect(provider).not.toHaveBeenCalled()
    expect((await service.request(1, await request())).output).toBe('你好 world')
    expect(cache.entries.size).toBe(1)
    expect(
      await service.request(1, await request('Hello world', { network: false })),
    ).toMatchObject({ output: '你好 world', cached: true })
    expect(provider).toHaveBeenCalledTimes(1)
  })
  it('makes cache clear a barrier for every owner and rejects old requests and late writes', async () => {
    const gate = deferred<string>(),
      provider = vi.fn(async () => gate.promise)
    const { service, request, cache, changed } = await setup(provider)
    const a = await request(),
      b = await request()
    const first = service.request(1, a).catch((error) => error),
      second = service.request(2, b).catch((error) => error)
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1))
    const cleared = await service.clear()
    expect(cleared.cacheGeneration).toBe(1)
    expect(await first).toMatchObject({ code: 'translation-stale' })
    expect(await second).toMatchObject({ code: 'translation-stale' })
    gate.resolve('Too late')
    await expect(service.request(1, a)).rejects.toMatchObject({ code: 'translation-stale' })
    expect(cache.entries.size).toBe(0)
    expect(changed).toHaveBeenCalled()
    expect(
      (await service.request(1, await request('Hello world', { network: false }))).output,
    ).toBeNull()
  })
  it('invalidates changed settings and closed documents while preserving other subscribers', async () => {
    const gate = deferred<string>(),
      provider = vi.fn(async () => gate.promise)
    const { service, request } = await setup(provider)
    const first = await request(),
      second = await request()
    const a = service.request(1, first).catch((error) => error),
      b = service.request(1, second).catch((error) => error)
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1))
    service.closeDocument(1, first.documentId)
    expect(await a).toMatchObject({ code: 'translation-cancelled' })
    const revision = (await service.state()).settingsRevision
    await service.configure({ ...settings, targetLanguage: 'ja' })
    expect(await b).toMatchObject({ code: 'translation-stale' })
    expect((await service.state()).settingsRevision).toBe(revision + 1)
    gate.resolve('Obsolete')
  })
  it('bounds concurrency, queued unique jobs and subscriptions', async () => {
    const gate = deferred<string>(),
      provider = vi.fn(async () => gate.promise)
    const { service, request } = await setup(provider)
    const inputs = await Promise.all(
      Array.from({ length: 38 }, (_, index) => request(`Hello ${index}`)),
    )
    const pending = inputs.map((input) => service.request(1, input).catch((error) => error))
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2))
    service.closeOwner(1)
    const results = await Promise.all(pending)
    expect(
      results.filter((value) => value.code === 'translation-busy').length,
    ).toBeGreaterThanOrEqual(4)
    expect(provider).toHaveBeenCalledTimes(2)
    gate.resolve('Done')
  })
  it('bounds duplicate subscriptions and rejects duplicate request ids', async () => {
    const gate = deferred<string>(),
      provider = vi.fn(async () => gate.promise)
    const { service, request } = await setup(provider)
    const input = await request()
    const requests = Array.from({ length: 130 }, () => ({
      ...input,
      requestId: randomUUID(),
      occurrenceId: randomUUID(),
    }))
    const pending = requests.map((item) => service.request(1, item).catch((error) => error))
    await expect(service.request(1, requests[0])).rejects.toMatchObject({
      code: 'translation-busy',
    })
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1))
    service.closeOwner(1)
    expect(
      (await Promise.all(pending)).filter((value) => value.code === 'translation-busy'),
    ).toHaveLength(2)
    gate.resolve('Done')
  })
  it('rejects forged cache keys, invalid settings/options, future generations and source/AST metadata', async () => {
    const { service, request, provider } = await setup()
    const input = await request()
    await expect(service.request(1, { ...input, unitKey: '0'.repeat(32) })).rejects.toMatchObject({
      code: 'translation-invalid',
    })
    await expect(service.request(1, { ...input, cacheGeneration: 99 })).rejects.toMatchObject({
      code: 'translation-stale',
    })
    await expect(service.request(1, { ...input, source: 'SECRET_SOURCE' })).rejects.toMatchObject({
      code: 'translation-invalid',
    })
    await expect(
      service.request(1, { ...input, payload: { ...input.payload, root: {} } }),
    ).rejects.toMatchObject({ code: 'translation-invalid' })
    for (const options of [
      { apiKey: 'secret' },
      { unsupported: true },
      { temperature: -1 },
      { maxOutputTokens: 999999 },
    ])
      await expect(
        service.configure({ ...settings, provider: { ...settings.provider, options } }),
      ).rejects.toMatchObject({ code: 'translation-settings' })
    expect(provider).not.toHaveBeenCalled()
  })
  it('keeps successful translations available when persistence fails and reports failed clear', async () => {
    const cache = new MemoryCache()
    cache.status = 'unavailable'
    const { service, request } = await setup(undefined, cache)
    expect(await service.request(1, await request())).toMatchObject({
      output: '你好 world',
      cache: 'unavailable',
    })
    await expect(service.clear()).rejects.toMatchObject({ code: 'translation-storage' })
    expect((await service.state()).cacheGeneration).toBe(1)
  })
  it('times out a stalled provider at its total job deadline without a late cache write', async () => {
    const gate = deferred<string>(),
      provider = vi.fn(async () => gate.promise)
    const { service, request, cache } = await setup(provider)
    const input = await request()
    vi.useFakeTimers()
    const pending = service.request(1, input).catch((error) => error)
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(60_001)
    expect(await pending).toMatchObject({ code: 'translation-timeout' })
    gate.resolve('Late completion')
    await vi.advanceTimersByTimeAsync(0)
    expect(cache.entries.size).toBe(0)
  })
  it('rejects malformed provider output without caching and exposes only credential status', async () => {
    const { service, request, cache } = await setup(vi.fn(async () => '⟪M999⟫'))
    await expect(service.request(1, await request())).rejects.toMatchObject({
      code: 'translation-response',
    })
    expect(cache.entries.size).toBe(0)
    const state = await service.state()
    const changed = await service.setCredential({
      settingsRevision: state.settingsRevision,
      key: 'dummy-private-key',
      persist: false,
    })
    expect(changed.credential).toBe('session')
    expect(JSON.stringify(changed)).not.toContain('dummy-private-key')
    await service.configure({
      ...settings,
      provider: { ...settings.provider, baseUrl: 'http://127.0.0.1:8081/chat' },
    })
    expect((await service.state()).credential).toBe('none')
  })
})
