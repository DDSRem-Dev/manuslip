import type { BrowserWindow } from 'electron'
import { expect, it, vi } from 'vitest'
import { withOwnedWindow } from '../../../src/main/owned-window'

it('revokes late async grants when their originating frame changes', async () => {
  const fake = { webContents: { id: 10, mainFrame: {} }, isDestroyed: () => false }
  const window = fake as unknown as BrowserWindow
  const revoke = vi.fn(async () => {})
  let finish: (value: string) => void = () => {}
  const pending = withOwnedWindow(
    () => window,
    revoke,
    () =>
      new Promise<string>((resolve) => {
        finish = resolve
      }),
  )
  fake.webContents.mainFrame = {}
  finish('late file grant')
  await expect(pending).rejects.toMatchObject({ code: 'file-session' })
  expect(revoke).toHaveBeenCalledWith(10)
})
