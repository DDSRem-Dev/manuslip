import { describe, expect, it, vi } from 'vitest'
import { createAuthorizedHandler } from '../../../src/main/ipc'
import { defaultSettings, parseSettings } from '../../../src/shared/contracts'

describe('main-owned IPC handlers', () => {
  const sender = {}
  const mainFrame = { url: 'file:///app/renderer/index.html' }
  const owner = { sender, mainFrame, rendererUrl: mainFrame.url }

  it('rejects a forged sender frame from a subframe even when its URL and webContents match', async () => {
    const operation = vi.fn()
    const invoke = createAuthorizedHandler(() => owner, operation)
    expect(await invoke({ sender, senderFrame: { url: mainFrame.url } }, null)).toMatchObject({
      ok: false,
    })
    expect(operation).not.toHaveBeenCalled()
  })

  it('rejects other windows, detached frames, wrong URLs, and revoked owners', async () => {
    const operation = vi.fn()
    const invoke = createAuthorizedHandler(() => owner, operation)
    expect(await invoke({ sender: {}, senderFrame: mainFrame }, null)).toMatchObject({ ok: false })
    expect(await invoke({ sender, senderFrame: null }, null)).toMatchObject({ ok: false })
    const navigated = { url: 'https://example.com' }
    expect(
      await createAuthorizedHandler(() => ({ ...owner, mainFrame: navigated }), operation)(
        { sender, senderFrame: navigated },
        null,
      ),
    ).toMatchObject({ ok: false })
    expect(
      await createAuthorizedHandler(() => null, operation)(
        { sender, senderFrame: mainFrame },
        null,
      ),
    ).toMatchObject({ ok: false })
    expect(operation).not.toHaveBeenCalled()
  })

  it('rejects malformed payloads and argument counts from an otherwise authorized frame', async () => {
    const invoke = createAuthorizedHandler(() => owner, parseSettings)
    const context = { sender, senderFrame: mainFrame }
    expect(await invoke(context, {})).toMatchObject({ ok: false })
    expect(await invoke(context)).toMatchObject({ ok: false })
    expect(await invoke(context, defaultSettings, 'extra')).toMatchObject({ ok: false })
    expect(await invoke(context, defaultSettings)).toEqual({ ok: true, value: defaultSettings })
  })

  it('returns a bounded safe error without disclosing storage errors or paths', async () => {
    const invoke = createAuthorizedHandler(
      () => owner,
      () => {
        throw new Error('/private/path sensitive details')
      },
    )
    const result = await invoke({ sender, senderFrame: mainFrame }, null)
    expect(result).toEqual({ ok: false, error: 'Unable to complete this action. Try again.' })
  })
})
