import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { parseMarkdown } from '@manuslip/core'
import {
  extractTranslation,
  parseDeepLLanguages,
  type TranslationSettings,
} from '@manuslip/translate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deepLLimits,
  loadDeepLLanguages,
  translateDeepL,
} from '../../../../src/main/translation/deepl'
import { encodeDeepL } from '../../../../src/main/translation/deepl-xml'
import type { Exchange } from '../../../../src/main/translation/transport'
import {
  parseTranslationSettings,
  parseTranslationState,
} from '../../../../src/shared/translation-contracts'

const source =
  'Hello *world*, `PRIVATE_CODE`, $PRIVATE_MATH$ and [label](https://private.invalid "PRIVATE_TITLE").'
const payload = extractTranslation(parseMarkdown(source).root, source).units[0]?.payload
if (!payload) throw new Error('No fixture')
const settings: TranslationSettings = {
  provider: {
    adapter: 'deepl',
    version: '1',
    baseUrl: 'http://127.0.0.1:8123/custom/translate?deployment=a',
    model: null,
    profile: null,
    options: {},
  },
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  glossary: [],
  formality: 'default',
  promptVersion: 'prose-translation/v1',
}
const language = (
  lang: string,
  features = ['tag_handling', 'glossary'],
  source = true,
  target = true,
) => ({
  lang,
  usable_as_source: source,
  usable_as_target: target,
  status: 'stable',
  features: Object.fromEntries(features.map((feature) => [feature, { status: 'stable' }])),
})
const catalog = [
  language('en', undefined, true, false),
  language('en-US', undefined, false, true),
  language('zh', undefined, true, false),
  language('zh-Hans', undefined, false, true),
  language('de', ['tag_handling', 'glossary', 'formality']),
]
const supported = parseDeepLLanguages(catalog)
const signal = () => new AbortController().signal
const reply = (value: unknown, status = 200, headers = {}) => ({
  status,
  headers,
  body: Buffer.from(JSON.stringify(value)),
})
const answer = (text = encodeDeepL(payload).replace('Hello', '你好').replace('world', '世界')) =>
  reply({ translations: [{ text }] })
const servers: Server[] = []
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
})

describe('DeepL native adapter', () => {
  it('discovers languages and sends XML prose with native auth, preserving the full custom route and private bindings', async () => {
    const received: { url?: string; method?: string; headers: object; body: string }[] = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks).toString()
      received.push({ url: request.url, method: request.method, headers: request.headers, body })
      response.setHeader('Content-Type', 'application/json')
      response.end(
        request.method === 'GET'
          ? JSON.stringify(catalog)
          : answer(JSON.parse(body).text[0].replace('Hello', '你好')).body,
      )
    })
    servers.push(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No server')
    const configured = {
      ...settings,
      provider: {
        ...settings.provider,
        baseUrl: `http://localhost:${address.port}/custom/translate?deployment=a`,
      },
    }
    expect(await translateDeepL(configured, payload, 'dummy-deepl-key', signal())).toBe(
      payload.text.replace('Hello', '你好'),
    )
    expect(received.map((item) => [item.method, item.url])).toEqual([
      ['GET', '/v3/languages?resource=translate_text'],
      ['POST', '/custom/translate?deployment=a'],
    ])
    for (const item of received) {
      expect(item.headers).toMatchObject({ authorization: 'DeepL-Auth-Key dummy-deepl-key' })
      expect(item.headers).not.toHaveProperty('cookie')
      expect(item.headers).not.toHaveProperty('referer')
      expect(item.body).not.toMatch(
        /PRIVATE_|private.invalid|dummy-deepl-key|occurrenceId|bindings/,
      )
    }
    expect(received[0]?.body).toBe('')
    expect(JSON.parse(received[1]?.body ?? '')).toMatchObject({
      target_lang: 'ZH-HANS',
      tag_handling: 'xml',
      tag_handling_version: 'v2',
      ignore_tags: ['x'],
      outline_detection: false,
    })
  })
  it('uses native formality/glossary with explicit source and never sends chat prompt or options', async () => {
    const send = vi.fn<Exchange>(async () => answer())
    const configured = {
      ...settings,
      sourceLanguage: 'en-GB',
      targetLanguage: 'de',
      formality: 'formal' as const,
      provider: {
        ...settings.provider,
        options: { glossaryId: '12345678-1234-1234-1234-123456789abc' },
      },
    }
    await translateDeepL(configured, payload, 'dummy', signal(), send, supported)
    const body = JSON.parse(send.mock.calls[0]?.[1].toString() ?? '')
    expect(body).toMatchObject({
      source_lang: 'EN',
      target_lang: 'DE',
      formality: 'more',
      glossary_id: configured.provider.options.glossaryId,
    })
    expect(Object.keys(body)).not.toEqual(
      expect.arrayContaining(['messages', 'model', 'temperature', 'stream']),
    )
  })
  it.each([
    { ...settings, targetLanguage: 'fr-XX' },
    { ...settings, formality: 'formal' as const },
    {
      ...settings,
      sourceLanguage: 'auto',
      provider: {
        ...settings.provider,
        options: { glossaryId: '12345678-1234-1234-1234-123456789abc' },
      },
    },
  ])(
    'rejects unsupported language or native options before a billable request',
    async (configured) => {
      const send = vi.fn<Exchange>(async () => answer())
      await expect(
        translateDeepL(configured, payload, 'dummy', signal(), send, supported),
      ).rejects.toMatchObject({ code: 'translation-settings' })
      expect(send).not.toHaveBeenCalled()
    },
  )
  it('requires a credential before discovery or translation', async () => {
    const send = vi.fn<Exchange>()
    await expect(loadDeepLLanguages(settings, null, signal(), send)).rejects.toMatchObject({
      code: 'translation-key-required',
    })
    await expect(
      translateDeepL(settings, payload, null, signal(), send, supported),
    ).rejects.toMatchObject({ code: 'translation-key-required' })
    expect(send).not.toHaveBeenCalled()
  })
  it.each([401, 403, 456])(
    'does not retry authentication/quota error %i or reveal provider error bodies',
    async (status) => {
      const send = vi.fn<Exchange>(async () => reply({ error: 'PRIVATE_SERVER_DETAILS' }, status))
      await expect(
        translateDeepL(settings, payload, 'dummy', signal(), send, supported),
      ).rejects.toMatchObject({ code: status === 456 ? 'translation-quota' : 'translation-auth' })
      expect(send).toHaveBeenCalledTimes(1)
    },
  )
  it('retries transient failures within the shared bounded policy', async () => {
    const send = vi
      .fn<Exchange>()
      .mockResolvedValueOnce(reply({}, 429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(reply({}, 503, { 'retry-after': '0' }))
      .mockResolvedValueOnce(answer())
    expect(await translateDeepL(settings, payload, 'dummy', signal(), send, supported)).toContain(
      '你好',
    )
    expect(send).toHaveBeenCalledTimes(3)
  })
  it('keeps native auth on same-origin metadata redirects and rejects another origin', async () => {
    const send = vi
      .fn<Exchange>()
      .mockResolvedValueOnce(reply({}, 307, { location: '/proxy/languages?version=3' }))
      .mockResolvedValueOnce(reply(catalog))
    expect(await loadDeepLLanguages(settings, 'dummy', signal(), send)).toEqual(supported)
    expect(send.mock.calls[1]?.[0]).toBe('http://127.0.0.1:8123/proxy/languages?version=3')
    expect(send.mock.calls[1]?.[4]).toMatchObject({ method: 'GET', authentication: 'deepl' })
    send
      .mockReset()
      .mockResolvedValue(reply({}, 308, { location: 'https://other.invalid/languages' }))
    await expect(loadDeepLLanguages(settings, 'dummy', signal(), send)).rejects.toMatchObject({
      code: 'translation-provider',
    })
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('bounds metadata bytes, language count, UTF-8 and translation response shape', async () => {
    for (const body of [
      Buffer.alloc(deepLLimits.metadata + 1, 32),
      Buffer.from([0xff]),
      Buffer.from(JSON.stringify(Array(513).fill(catalog[0]))),
      Buffer.from('{}'),
    ]) {
      await expect(
        loadDeepLLanguages(settings, 'dummy', signal(), async () => ({
          status: 200,
          headers: {},
          body,
        })),
      ).rejects.toMatchObject({ code: 'translation-response' })
    }
    for (const value of [
      { translations: [] },
      { translations: [{ text: '<r>Hello</r>' }, { text: '<r>Hello</r>' }] },
      { translations: [{ text: 5 }] },
    ]) {
      await expect(
        translateDeepL(settings, payload, 'dummy', signal(), async () => reply(value), supported),
      ).rejects.toMatchObject({ code: 'translation-response' })
    }
  })
  it('rejects XML escaping expansion over 128 KiB before POST', async () => {
    const send = vi.fn<Exchange>()
    await expect(
      translateDeepL(
        settings,
        { ...payload, text: '&'.repeat(30000), tokens: [] },
        'dummy',
        signal(),
        send,
        supported,
      ),
    ).rejects.toMatchObject({ code: 'translation-invalid' })
    expect(send).not.toHaveBeenCalled()
  })
  it('cancels discovery and its retry wait, with a separate ten-second deadline', async () => {
    const deadline = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    const send = vi.fn<Exchange>(
      async (_url, _body, _key, abort) =>
        new Promise((_resolve, reject) =>
          abort.addEventListener('abort', () => reject(abort.reason), { once: true }),
        ),
    )
    const timed = expect(
      loadDeepLLanguages(settings, 'dummy', signal(), send),
    ).rejects.toMatchObject({ code: 'translation-timeout' })
    expect(timeout).toHaveBeenCalledWith(10000)
    deadline.abort()
    await timed
    timeout.mockRestore()
    const controller = new AbortController()
    const cancelled = expect(
      loadDeepLLanguages(settings, 'dummy', controller.signal, async () =>
        reply({}, 429, { 'retry-after': '5' }),
      ),
    ).rejects.toMatchObject({ code: 'translation-cancelled' })
    controller.abort()
    await cancelled
  })
})

describe('DeepL settings and metadata boundary', () => {
  it('supports schema-safe native settings and same-origin custom metadata URLs', () => {
    expect(parseTranslationSettings(settings)).toEqual(settings)
    for (const options of [
      { temperature: 0 },
      { maxOutputTokens: 100 },
      { languagesEndpoint: 'https://other.invalid/languages' },
      { glossaryId: 'not-a-uuid' },
    ])
      expect(() =>
        parseTranslationSettings({ ...settings, provider: { ...settings.provider, options } }),
      ).toThrow()
    expect(() =>
      parseTranslationSettings({ ...settings, glossary: [{ source: 'a', target: 'b' }] }),
    ).toThrow()
    const configured = {
      ...settings,
      provider: {
        ...settings.provider,
        options: {
          languagesEndpoint: 'http://127.0.0.1:8123/proxy/languages?resource=translate_text',
        },
      },
    }
    expect(parseTranslationSettings(configured)).toEqual(configured)
  })
  it('keeps only stable language features and rejects malformed/duplicate metadata', () => {
    expect(
      parseDeepLLanguages([{ ...catalog[0], features: { tag_handling: { status: 'beta' } } }])[0]
        ?.tags,
    ).toBe(false)
    expect(parseDeepLLanguages([{ ...catalog[0], status: 'beta' }])).toEqual([])
    for (const value of [
      [catalog[0], catalog[0]],
      [{ ...catalog[0], lang: 'not a tag' }],
      [{ ...catalog[0], features: null }],
    ])
      expect(() => parseDeepLLanguages(value)).toThrow()
    const state = {
      settings,
      settingsRevision: 0,
      cacheGeneration: 0,
      cache: 'idle',
      credential: 'none',
      configuration: 'ready',
      languages: supported,
    }
    expect(parseTranslationState(state).languages).toEqual(supported)
    expect(() =>
      parseTranslationState({ ...state, languages: [{ ...supported[0], key: 'PRIVATE' }] }),
    ).toThrow()
  })
})
