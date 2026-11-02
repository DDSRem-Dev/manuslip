import { defaultTypography } from '@manuslip/renderer/typography'
import { createStore } from 'zustand/vanilla'
import type { Result } from '../../shared/contracts'
import type {
  StyleBridge,
  WritingStyleState,
  WritingTypography,
} from '../../shared/style-contracts'

interface Access {
  synchronizeInput(): Promise<void>
  canChange(): boolean
}
export class DocumentAppearance {
  readonly store = createStore(() => ({
    open: false,
    busy: false,
    loaded: false,
    error: null as string | null,
    style: {
      version: 0,
      typography: { ...defaultTypography },
      name: null,
      css: '',
      storage: 'session',
      error: null,
    } as WritingStyleState,
  }))
  private generation = 0
  private disposed = false
  constructor(
    private readonly id: string,
    private readonly bridge: StyleBridge,
    private readonly access: Access,
  ) {}

  async open(): Promise<void> {
    if (this.disposed) return
    this.store.setState({ open: true })
    await this.load()
  }
  close(): void {
    this.store.setState({ open: false })
  }
  load(): Promise<void> {
    return this.run(() => this.bridge.writingStyle(this.id))
  }
  typography(value: WritingTypography): Promise<void> {
    return this.run(() => this.bridge.setWritingTypography(this.id, value))
  }
  import(): Promise<void> {
    return this.run(() => this.bridge.importWritingStylesheet(this.id))
  }
  reset(stylesheetOnly = false): Promise<void> {
    return this.run(() => this.bridge.resetWritingStyle(this.id, stylesheetOnly))
  }
  retry(): Promise<void> {
    return this.typography(this.store.getState().style.typography)
  }
  private async run(operation: () => Promise<Result<WritingStyleState | null>>): Promise<void> {
    if (this.disposed) return
    const generation = ++this.generation
    this.store.setState({ busy: true, error: null })
    try {
      await this.access.synchronizeInput()
      if (this.disposed || generation !== this.generation) return
      if (!this.access.canChange()) throw new Error('appearance-unavailable')
      const result = await operation()
      if (this.disposed || generation !== this.generation) return
      if (!result.ok) {
        this.store.setState({ error: result.code ?? 'appearance-unavailable' })
        return
      }
      if (result.value) {
        await this.access.synchronizeInput()
        if (this.disposed || generation !== this.generation) return
        if (!this.access.canChange()) throw new Error('appearance-unavailable')
        this.store.setState({ style: result.value, loaded: true, error: result.value.error })
      }
    } catch {
      if (!this.disposed && generation === this.generation)
        this.store.setState({ error: 'appearance-unavailable' })
    } finally {
      if (!this.disposed && generation === this.generation) this.store.setState({ busy: false })
    }
  }
  dispose(): void {
    this.disposed = true
    this.generation++
    this.store.setState({ open: false, busy: false })
  }
}
