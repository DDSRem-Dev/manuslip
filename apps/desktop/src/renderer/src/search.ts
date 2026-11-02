import { createStore } from 'zustand/vanilla'
import type {
  SearchAnchor,
  SearchBridge,
  SearchEntry,
  SearchPage,
  SearchRequest,
} from '../../shared/search-contracts'
import type { DocumentsController } from './documents'

interface SearchStatus {
  expanded: boolean
  focusRequest: number
  rootId: string | null
  query: string
  mode: SearchRequest['mode']
  matchCase: boolean
  state: SearchPage['state'] | 'idle'
  entries: SearchEntry[]
  total: number
  error: string | null
  truncated: boolean
  skipped: number
}
export class SearchController {
  readonly store = createStore<SearchStatus>(() => ({
    expanded: false,
    focusRequest: 0,
    rootId: null,
    query: '',
    mode: 'filename',
    matchCase: false,
    state: 'idle',
    entries: [],
    total: 0,
    error: null,
    truncated: false,
    skipped: 0,
  }))
  private id: string | null = null
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  constructor(
    private readonly bridge: SearchBridge,
    private readonly documents: Pick<DocumentsController, 'openFile' | 'active'>,
  ) {}
  expand(expanded: boolean): void {
    this.store.setState({ expanded })
  }
  show(): void {
    if (this.store.getState().mode !== 'filename') this.mode('filename')
    this.store.setState((state) => ({ expanded: true, focusRequest: state.focusRequest + 1 }))
  }
  setRoot(rootId: string | null): void {
    if (this.store.getState().rootId === rootId) return
    this.store.setState({ rootId })
    this.schedule()
  }
  query(query: string): void {
    this.store.setState({ query })
    this.schedule()
  }
  mode(mode: SearchRequest['mode']): void {
    this.store.setState({ mode })
    this.schedule()
  }
  matchCase(matchCase: boolean): void {
    this.store.setState({ matchCase })
    this.schedule()
  }
  private stop(): void {
    this.generation++
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.id) void this.bridge.cancelSearch(this.id).catch(() => {})
    this.id = null
  }
  cancel(): void {
    const id = this.id
    this.stop()
    this.id = id
    this.store.setState({ state: 'cancelled' })
  }
  private schedule(): void {
    this.stop()
    this.store.setState({
      state: 'idle',
      entries: [],
      total: 0,
      error: null,
      truncated: false,
      skipped: 0,
    })
    const state = this.store.getState()
    if (state.rootId && state.query.length)
      this.timer = setTimeout(() => {
        this.timer = null
        void this.run()
      }, 200)
  }
  async run(): Promise<void> {
    this.stop()
    const state = this.store.getState()
    if (!state.rootId || !state.query.length) return
    const generation = this.generation,
      id = crypto.randomUUID()
    this.id = id
    this.store.setState({
      state: 'running',
      entries: [],
      total: 0,
      error: null,
      truncated: false,
      skipped: 0,
    })
    try {
      const result = await this.bridge.startSearch({
        id,
        rootId: state.rootId,
        query: state.query,
        mode: state.mode,
        matchCase: state.matchCase,
      })
      if (generation !== this.generation) {
        void this.bridge.cancelSearch(id).catch(() => {})
        return
      }
      if (!result.ok) throw new Error(result.code || 'search-io')
      await this.poll(id, generation)
    } catch (error) {
      this.failed(error, generation)
    }
  }
  private async poll(id: string, generation: number): Promise<void> {
    if (generation !== this.generation) return
    const cursor = this.store.getState().entries.length
    try {
      const result = await this.bridge.pollSearch(id, cursor)
      if (generation !== this.generation) return
      if (!result.ok) throw new Error(result.code || 'search-io')
      const page = result.value
      if (
        page.id !== id ||
        page.cursor !== cursor + page.entries.length ||
        page.total < page.cursor
      )
        throw new Error('search-io')
      this.store.setState({
        entries: [...this.store.getState().entries, ...page.entries],
        total: page.total,
        state: page.state,
        error: page.error,
        truncated: page.truncated,
        skipped: page.skipped,
      })
      if (page.state === 'running' || page.cursor < page.total)
        this.timer = setTimeout(
          () => {
            this.timer = null
            void this.poll(id, generation)
          },
          page.cursor < page.total ? 0 : 100,
        )
    } catch (error) {
      this.failed(error, generation)
    }
  }
  private failed(error: unknown, generation: number): void {
    if (generation !== this.generation) return
    const code =
      error instanceof Error && /^search-[a-z-]+$/.test(error.message) ? error.message : 'search-io'
    this.store.setState({ state: 'error', error: code })
  }
  async open(entry: SearchEntry): Promise<void> {
    const id = this.id,
      generation = this.generation
    if (!id) return
    let anchor: SearchAnchor | null = null,
      fileId = '',
      code = 'search-session'
    const opened = await this.documents.openFile(async () => {
      const result = await this.bridge.openSearchResult(id, entry.id)
      if (!result.ok) {
        code = result.code || 'search-session'
        return result
      }
      anchor = result.value.anchor
      fileId = result.value.file.info.id
      return { ok: true, value: result.value.file }
    }, false)
    if (opened === null) return
    if (!opened) {
      this.store.setState({ error: code })
      return
    }
    const document = this.documents.active
    if (!document || document.store.getState().info.id !== fileId) return
    document.focus()
    if (anchor && generation === this.generation && !document.revealSearch(anchor))
      this.store.setState({ error: 'search-stale' })
  }
}
