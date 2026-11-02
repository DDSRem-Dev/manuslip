import { defaultTypography } from '@manuslip/renderer/typography'
import { describe, expect, it, vi } from 'vitest'
import { DocumentAppearance } from '../../../../src/renderer/src/appearance'
import type { StyleBridge, WritingStyleState } from '../../../../src/shared/style-contracts'

function setup() {
  const style: WritingStyleState = {
    version: 0,
    typography: { ...defaultTypography },
    name: null,
    css: '',
    storage: 'session',
    error: null,
  }
  const bridge: StyleBridge = {
    writingStyle: vi.fn<StyleBridge['writingStyle']>(async () => ({ ok: true, value: style })),
    setWritingTypography: vi.fn<StyleBridge['setWritingTypography']>(async (_id, typography) => ({
      ok: true,
      value: { ...style, typography },
    })),
    importWritingStylesheet: vi.fn<StyleBridge['importWritingStylesheet']>(async () => ({
      ok: true,
      value: null,
    })),
    resetWritingStyle: vi.fn<StyleBridge['resetWritingStyle']>(async () => ({
      ok: true,
      value: style,
    })),
  }
  const access = { synchronizeInput: vi.fn(async () => {}), canChange: vi.fn(() => true) }
  return {
    style,
    bridge,
    access,
    controller: new DocumentAppearance('12345678-1234-1234-1234-123456789abc', bridge, access),
  }
}
describe('document appearance publication', () => {
  it('settles pending input before requests and before publishing layout changes', async () => {
    const { bridge, controller, access } = setup()
    await controller.typography({ ...defaultTypography, size: 24 })
    expect(access.synchronizeInput).toHaveBeenCalledTimes(2)
    expect(access.synchronizeInput.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(bridge.setWritingTypography).mock.invocationCallOrder[0] ?? 0,
    )
    expect(controller.store.getState().style.typography.size).toBe(24)
  })
  it('keeps previous appearance on invalid import and native picker cancellation', async () => {
    const { controller, bridge } = setup()
    await controller.typography({ ...defaultTypography, size: 20 })
    vi.mocked(bridge.importWritingStylesheet).mockResolvedValueOnce({
      ok: false,
      error: 'invalid',
      code: 'style-invalid',
    })
    await controller.import()
    expect(controller.store.getState()).toMatchObject({
      error: 'style-invalid',
      busy: false,
      style: { typography: { size: 20 } },
    })
    await controller.import()
    expect(controller.store.getState().style.typography.size).toBe(20)
  })
  it.each(['reset', 'dispose'])('does not publish a late result after %s', async (action) => {
    const { controller, bridge, style } = setup()
    let finish: (value: Awaited<ReturnType<StyleBridge['importWritingStylesheet']>>) => void =
      () => {}
    vi.mocked(bridge.importWritingStylesheet).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = controller.import()
    await Promise.resolve()
    if (action === 'reset') await controller.reset()
    else controller.dispose()
    finish({ ok: true, value: { ...style, name: 'late.css', css: 'article{color:red}' } })
    await pending
    expect(controller.store.getState().style.name).toBeNull()
  })
  it('keeps fallback controls available after input synchronization fails', async () => {
    const { controller, bridge, access } = setup()
    access.synchronizeInput.mockRejectedValueOnce(new Error('input'))
    await controller.open()
    expect(controller.store.getState()).toMatchObject({
      open: true,
      busy: false,
      error: 'appearance-unavailable',
    })
    expect(bridge.writingStyle).not.toHaveBeenCalled()
    await controller.reset()
    expect(controller.store.getState().error).toBeNull()
  })
})
