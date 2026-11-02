import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { parseMarkdown } from '@manuslip/core'
import { extractTranslation, type TranslationSettings } from '@manuslip/translate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TranslationFailure } from '../../../../src/main/translation/errors'
import { translateWithProvider } from '../../../../src/main/translation/providers'

const source =
  'Hello *world*, `SECRET_CODE`, $SECRET_MATH$, [label](https://secret.invalid/private "SECRET_TITLE")!'
const payload = extractTranslation(parseMarkdown(source).root, source).units[0]?.payload
if (!payload) throw new Error('Fixture did not extract')
const settings: TranslationSettings = {
  provider: {
    adapter: 'openai-compatible',
    version: '1',
    baseUrl: 'http://127.0.0.1:11434/v1/chat/completions',
    model: 'configured-model',
    profile: null,
    options: {},
  },
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  glossary: [{ source: 'world', target: '世界' }],
  formality: 'default',
  promptVersion: 'prose-translation/v1',
}
const translated = payload.text.replace('Hello', '你好').replace('world', '世界')
const signal = (): AbortSignal => new AbortController().signal
function response(value: unknown, status = 200, headers = {}) {
  return {
    status,
    headers,
    body: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
  }
}
const openai = (content = translated, reason = 'stop') =>
  response({ choices: [{ finish_reason: reason, message: { role: 'assistant', content } }] })
const servers: Server[] = []
afterEach(async () => {
  vi.useRealTimers()
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

describe('bounded translation provider adapters', () => {
  it('sends only canonical prose and prompt settings over native transport, without protected data or browser headers', async () => {
    let received: { url?: string; headers?: object; body?: string } = {}
    const server = createServer(async (request, reply) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      received = {
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString(),
      }
      reply.setHeader('Content-Type', 'application/json')
      reply.end(openai().body)
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
        baseUrl: `http://localhost:${address.port}/custom/chat?deployment=a`,
      },
    }
    expect(await translateWithProvider(configured, payload, 'dummy-only-key', signal())).toBe(
      translated,
    )
    expect(received.url).toBe('/custom/chat?deployment=a')
    expect(received.headers).toMatchObject({
      authorization: 'Bearer dummy-only-key',
      'content-type': 'application/json',
    })
    expect(received.headers).not.toHaveProperty('cookie')
    expect(received.headers).not.toHaveProperty('referer')
    for (const hidden of [
      'SECRET_CODE',
      'SECRET_MATH',
      'secret.invalid',
      'SECRET_TITLE',
      'dummy-only-key',
      'bindings',
      'occurrenceId',
    ])
      expect(received.body).not.toContain(hidden)
    expect(JSON.parse(received.body ?? '{}')).toMatchObject({
      model: 'configured-model',
      stream: false,
      temperature: 0,
      max_completion_tokens: 8192,
    })
    expect(received.body).toContain('⟪M<number>⟫')
  })
  it('requests an installed Ollama model without streaming or a cloud credential', async () => {
    const send = vi.fn(async () =>
      response({
        done: true,
        done_reason: 'stop',
        message: { role: 'assistant', content: translated },
      }),
    )
    const config = {
      ...settings,
      provider: {
        ...settings.provider,
        adapter: 'ollama',
        options: { temperature: 0.3, maxOutputTokens: 1024 },
      },
    }
    expect(await translateWithProvider(config, payload, null, signal(), send)).toBe(translated)
    const request = send.mock.calls[0] as unknown as [string, Buffer, unknown, AbortSignal]
    expect(JSON.parse(request[1].toString())).toMatchObject({
      stream: false,
      options: { temperature: 0.3, num_predict: 1024 },
    })
    expect(request[2]).toBeNull()
  })
  it.each(['length', 'content_filter', 'tool_calls', null])(
    'rejects OpenAI partial/non-text completion %s without retry',
    async (reason) => {
      const send = vi.fn(async () => openai(translated, reason as string))
      await expect(
        translateWithProvider(settings, payload, null, signal(), send),
      ).rejects.toMatchObject({ code: 'translation-incomplete' })
      expect(send).toHaveBeenCalledTimes(1)
    },
  )
  it.each([
    response('{invalid JSON'),
    openai('Missing placeholders'),
    openai(`${translated} ⟪M0⟫`),
    response({
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: translated, refusal: 'refused' },
        },
      ],
    }),
    response({
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: translated, tool_calls: [{}] },
        },
      ],
    }),
  ])('rejects malformed structures and placeholders without retries', async (reply) => {
    const send = vi.fn(async () => reply)
    await expect(
      translateWithProvider(settings, payload, null, signal(), send),
    ).rejects.toBeInstanceOf(TranslationFailure)
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('rejects Ollama partial output and output limits', async () => {
    const config = { ...settings, provider: { ...settings.provider, adapter: 'ollama' } }
    for (const reply of [
      response({ done: false, message: { content: translated } }),
      response({
        done: true,
        done_reason: 'length',
        message: { role: 'assistant', content: translated },
      }),
      response({
        done: true,
        done_reason: 'stop',
        message: { role: 'assistant', content: 'x'.repeat(256 * 1024 + 1) },
      }),
    ]) {
      await expect(
        translateWithProvider(config, payload, null, signal(), async () => reply),
      ).rejects.toBeInstanceOf(TranslationFailure)
    }
  })
  it('retries transient statuses at most twice, honors Retry-After, and never retries credentials', async () => {
    const send = vi.fn(async () =>
      response({ error: 'PRIVATE PROVIDER ERROR' }, 429, { 'retry-after': '0' }),
    )
    await expect(
      translateWithProvider(settings, payload, null, signal(), send),
    ).rejects.toMatchObject({ code: 'translation-rate' })
    expect(send).toHaveBeenCalledTimes(3)
    const auth = vi.fn(async () => response('sensitive', 401))
    await expect(
      translateWithProvider(settings, payload, null, signal(), auth),
    ).rejects.toMatchObject({ code: 'translation-auth' })
    expect(auth).toHaveBeenCalledTimes(1)
    await expect(
      translateWithProvider(settings, payload, null, signal(), async () =>
        response('', 429, { 'retry-after': '3600' }),
      ),
    ).rejects.toMatchObject({ code: 'translation-rate' })
  })
  it('follows same-origin POST redirects but rejects other origins and method-changing redirects', async () => {
    let calls = 0
    const send = vi.fn(async () =>
      ++calls === 1 ? response('', 307, { location: '/other-route' }) : openai(),
    )
    expect(await translateWithProvider(settings, payload, 'dummy', signal(), send)).toBe(translated)
    expect(send.mock.calls.length).toBe(2)
    for (const reply of [
      response('', 307, { location: 'https://other.invalid/chat' }),
      response('', 302, { location: '/other-route' }),
      response('', 307, { location: '/other?api_key=secret' }),
    ]) {
      const rejected = vi.fn(async () => reply)
      await expect(
        translateWithProvider(settings, payload, 'dummy', signal(), rejected),
      ).rejects.toBeInstanceOf(TranslationFailure)
      expect(rejected).toHaveBeenCalledTimes(1)
    }
    const loop = vi.fn(async () => response('', 308, { location: '/loop' }))
    await expect(
      translateWithProvider(settings, payload, null, signal(), loop),
    ).rejects.toMatchObject({ code: 'translation-provider' })
    expect(loop).toHaveBeenCalledTimes(4)
  })
  it('aborts native transport on cancellation and rejects oversized replies', async () => {
    const server = createServer((request, reply) => {
      if (request.url === '/large') reply.end(Buffer.alloc(2 * 1024 * 1024 + 1, 65))
    })
    servers.push(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No server')
    const base = `http://127.0.0.1:${address.port}`
    const config = { ...settings, provider: { ...settings.provider, baseUrl: `${base}/hang` } }
    const controller = new AbortController()
    const pending = translateWithProvider(config, payload, null, controller.signal)
    const assertion = expect(pending).rejects.toMatchObject({ code: 'translation-cancelled' })
    controller.abort()
    await assertion
    config.provider.baseUrl = `${base}/large`
    await expect(translateWithProvider(config, payload, null, signal())).rejects.toMatchObject({
      code: 'translation-response',
    })
  })
})
