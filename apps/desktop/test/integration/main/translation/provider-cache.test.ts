import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import type { IncomingHttpHeaders, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseMarkdown } from '@manuslip/core'
import {
  extractTranslation,
  type TranslationSettings,
  translationSettingsKey,
  translationUnitKey,
} from '@manuslip/translate'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { requestBody, startHttpServer } from '../../../../../../test/helpers/http-server'
import type { TranslationCache } from '../../../../src/main/translation/cache'
import {
  type CacheOperation,
  TranslationCacheStore,
} from '../../../../src/main/translation/cache-store'
import { TranslationConfiguration } from '../../../../src/main/translation/configuration'
import { TranslationCredentials } from '../../../../src/main/translation/credentials'
import { TranslationService } from '../../../../src/main/translation/service'
import {
  providerCapabilities,
  type TranslationRequest,
} from '../../../../src/shared/translation-contracts'

// The service uses its real SQLite store; Electron E2E covers the bundled worker bridge.
class PersistentCache implements TranslationCache {
  status: TranslationCache['status'] = 'idle'
  constructor(private readonly store: TranslationCacheStore) {}
  async request(operation: CacheOperation) {
    const reply = this.store.execute(operation)
    this.status = reply.status
    return reply
  }
  dispose(): void {
    this.store.close()
  }
}
const source =
  'Hello *world* with `PRIVATE_CODE` and [label](https://private.invalid/secret "PRIVATE_TITLE").'
let directory: string,
  server: Awaited<ReturnType<typeof startHttpServer>>,
  service: TranslationService,
  settings: TranslationSettings,
  respond: (text: string, response: ServerResponse) => void | Promise<void>
const services: TranslationService[] = []
const received: { path: string; body: string; headers: IncomingHttpHeaders }[] = []
function answer(response: ServerResponse, content: string, finish = 'stop'): void {
  response.writeHead(200, { 'Content-Type': 'application/json' }).end(
    JSON.stringify({
      choices: [{ finish_reason: finish, message: { role: 'assistant', content } }],
    }),
  )
}
async function start(): Promise<void> {
  const cache = new PersistentCache(new TranslationCacheStore(join(directory, 'cache.sqlite')))
  service = new TranslationService(
    new TranslationConfiguration(join(directory, 'settings.json')),
    new TranslationCredentials(join(directory, 'credentials.json'), {
      available: async () => false,
      encrypt: async () => {
        throw new Error('Session-only test key')
      },
      decrypt: async () => {
        throw new Error('Session-only test key')
      },
    }),
    cache,
    () => {},
  )
  services.push(service)
  await service.state()
}
async function request(text = source, network = true): Promise<TranslationRequest> {
  const state = await service.state()
  if (!state.settings) throw new Error('Missing provider settings')
  const payload = extractTranslation(parseMarkdown(text).root, text).units[0]?.payload
  if (!payload) throw new Error('Missing translatable unit')
  return {
    requestId: randomUUID(),
    documentId: randomUUID(),
    occurrenceId: randomUUID(),
    sessionGeneration: 0,
    settingsRevision: state.settingsRevision,
    cacheGeneration: state.cacheGeneration,
    unitKey: await translationUnitKey(
      payload,
      await translationSettingsKey(state.settings, providerCapabilities),
    ),
    payload,
    network,
  }
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'manuslip-provider-cache-'))
  received.length = 0
  respond = (text, response) => answer(response, text.replace('Hello', '你好'))
  server = await startHttpServer(async (incoming, response) => {
    const body = (await requestBody(incoming)).toString('utf8')
    received.push({ path: incoming.url || '', body, headers: incoming.headers })
    await respond(JSON.parse(body).messages[1].content, response)
  })
  settings = {
    provider: {
      adapter: 'openai-compatible',
      version: '1',
      baseUrl: `${server.url}/chat`,
      model: 'local-test',
      profile: null,
      options: {},
    },
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    glossary: [],
    formality: 'default',
    promptVersion: 'prose-translation/v1',
  }
  await start()
  await service.configure(settings)
})
afterEach(async () => {
  for (const instance of services.splice(0)) instance.dispose()
  try {
    await server.close()
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

it('deduplicates HTTP work across owners, strips private bindings and reopens SQLite results offline', async () => {
  expect(await service.request(1, await request(source, false))).toMatchObject({
    output: null,
    cached: false,
  })
  const state = await service.state()
  await service.setCredential({
    settingsRevision: state.settingsRevision,
    key: 'dummy-session-key',
    persist: false,
  })
  expect(received).toEqual([])
  const release = Promise.withResolvers<void>()
  respond = async (text, response) => {
    await release.promise
    answer(response, text.replace('Hello', '你好'))
  }
  const first = await request(),
    second = await request()
  const pending = Promise.all([service.request(1, first), service.request(2, second)])
  try {
    await expect.poll(() => received.length).toBe(1)
  } finally {
    release.resolve()
  }
  const results = await pending
  expect(results.map((result) => result.requestId)).toEqual([first.requestId, second.requestId])
  expect(results[0]?.output).toBe(first.payload.text.replace('Hello', '你好'))
  expect(results[1]?.output).toBe(results[0]?.output)
  expect(received[0]?.headers.authorization).toBe('Bearer dummy-session-key')
  expect(received[0]?.body).not.toMatch(/PRIVATE_|private\.invalid/)
  expect(received[0]?.body).toContain('⟪M')
  expect((await readFile(join(directory, 'cache.sqlite'))).subarray(0, 16).toString()).toBe(
    'SQLite format 3\0',
  )

  service.dispose()
  await start()
  expect((await service.state()).credential).toBe('none')
  expect(await service.request(1, await request(source, false))).toMatchObject({
    cached: true,
    output: results[0]?.output,
  })
  expect(received).toHaveLength(1)
})

it.each(['missing markers', 'incomplete response'] as const)(
  'never caches %s and allows an explicit valid retry',
  async (failure) => {
    respond = (text, response) =>
      answer(
        response,
        failure === 'missing markers' ? 'unsafe output' : text,
        failure === 'incomplete response' ? 'length' : 'stop',
      )
    await expect(service.request(1, await request())).rejects.toMatchObject({
      code: failure === 'missing markers' ? 'translation-response' : 'translation-incomplete',
    })
    expect(await service.request(1, await request(source, false))).toMatchObject({
      cached: false,
      output: null,
    })
    expect(received).toHaveLength(1)
    respond = (text, response) => answer(response, text.replace('Hello', '你好'))
    const retried = await service.request(1, await request())
    expect(retried).toMatchObject({ cached: false, output: expect.stringContaining('你好') })
    expect(await service.request(1, await request(source, false))).toMatchObject({
      cached: true,
      output: retried.output,
    })
    expect(received).toHaveLength(2)
  },
)

it('retries real HTTP rate limits with the original body and credentials, then caches only the complete response', async () => {
  await service.setCredential({
    settingsRevision: (await service.state()).settingsRevision,
    key: 'retry-key',
    persist: false,
  })
  respond = (text, response) => {
    if (received.length === 1) response.writeHead(429, { 'Retry-After': '0' }).end()
    else answer(response, text.replace('Hello', '你好'))
  }
  const result = await service.request(1, await request())
  expect(result.output).toContain('你好')
  expect(received).toHaveLength(2)
  expect(received.map((value) => value.body)).toEqual([received[0]?.body, received[0]?.body])
  expect(received.map((value) => value.headers.authorization)).toEqual([
    'Bearer retry-key',
    'Bearer retry-key',
  ])
  expect(await service.request(1, await request(source, false))).toMatchObject({
    cached: true,
    output: result.output,
  })
  expect(received).toHaveLength(2)
})

it('cancels an owner without aborting another owner subscribed to the same HTTP response', async () => {
  const release = Promise.withResolvers<void>()
  respond = async (text, response) => {
    await release.promise
    answer(response, text.replace('Hello', '你好'))
  }
  const first = await request(),
    second = await request()
  const cancelled = service.request(1, first)
  const rejected = expect(cancelled).rejects.toMatchObject({ code: 'translation-cancelled' })
  const retained = service.request(2, second)
  try {
    await expect.poll(() => received.length).toBe(1)
    service.closeOwner(1)
    await rejected
  } finally {
    release.resolve()
  }
  expect(await retained).toMatchObject({
    requestId: second.requestId,
    output: expect.stringContaining('你好'),
  })
  expect(received).toHaveLength(1)
})

it('clears SQLite while an HTTP response is in flight and never persists that late generation', async () => {
  const release = Promise.withResolvers<void>(),
    finished = Promise.withResolvers<void>()
  respond = async (text, response) => {
    await release.promise
    answer(response, text.replace('Hello', 'LATE'))
    finished.resolve()
  }
  const pending = service.request(1, await request())
  const rejected = expect(pending).rejects.toMatchObject({ code: 'translation-stale' })
  try {
    await expect.poll(() => received.length).toBe(1)
    await service.clear()
    await rejected
  } finally {
    release.resolve()
  }
  await finished.promise
  expect(await service.request(1, await request(source, false))).toMatchObject({
    cached: false,
    output: null,
  })
  service.dispose()
  await start()
  expect(await service.request(1, await request(source, false))).toMatchObject({
    cached: false,
    output: null,
  })
  expect(received).toHaveLength(1)
})

it('changes target language without reusing another language cache and restores its own entries when switched back', async () => {
  const chinese = await service.request(1, await request())
  await service.configure({ ...settings, targetLanguage: 'ja' })
  expect(await service.request(1, await request(source, false))).toMatchObject({ output: null })
  respond = (text, response) => answer(response, text.replace('Hello', 'こんにちは'))
  expect((await service.request(1, await request())).output).toContain('こんにちは')
  await service.configure(settings)
  expect(await service.request(1, await request(source, false))).toMatchObject({
    cached: true,
    output: chinese.output,
  })
  expect(received).toHaveLength(2)
})
