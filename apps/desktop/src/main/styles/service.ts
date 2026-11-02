import { createHash } from 'node:crypto'
import { basename, extname } from 'node:path'
import { parseId } from '../../shared/file-contracts'
import {
  hasStyleControls,
  parseTypography,
  styleLimits,
  type WritingStyle,
  type WritingStyleState,
  type WritingTypography,
} from '../../shared/style-contracts'
import { readDisk } from '../files/disk'
import { FileOperationError } from '../files/errors'
import type { FileSessions } from '../files/sessions'
import { compileStylesheet } from './css'
import { defaultWritingStyle, type WritingStyleRepository } from './repository'

interface Binding {
  owner: number
  id: string
  path: string | null
  style: WritingStyle
  generation: number
  version: number
  storage: WritingStyleState['storage']
  error: WritingStyleState['error']
  migrate: boolean
}
const keyFor = (path: string): string =>
  createHash('sha256')
    .update(process.platform === 'win32' ? path.toLowerCase() : path)
    .digest('hex')
export class WritingStyles {
  private readonly bindings = new Map<string, Binding>()
  private readonly pickers = new Set<number>()
  constructor(
    private readonly files: Pick<FileSessions, 'describe'>,
    private readonly repository: WritingStyleRepository,
  ) {}
  private bind(owner: number, id: string): Binding {
    parseId(id)
    const info = this.files.describe(owner, id),
      key = `${owner}:${id}`
    let binding = this.bindings.get(key)
    if (!binding) {
      binding = {
        owner,
        id,
        path: info.displayPath,
        style: info.displayPath
          ? this.repository.get(keyFor(info.displayPath))
          : defaultWritingStyle(),
        generation: 0,
        version: 0,
        storage: this.repository.unavailable
          ? 'unavailable'
          : this.repository.readOnly
            ? 'read-only'
            : this.repository.recovered
              ? 'recovered'
              : info.displayPath
                ? 'saved'
                : 'session',
        error: this.repository.unavailable
          ? 'style-persist'
          : this.repository.readOnly
            ? 'style-readonly'
            : null,
        migrate: false,
      }
      this.bindings.set(key, binding)
    } else if (binding.path !== info.displayPath) {
      binding.path = info.displayPath
      binding.migrate = true
      binding.generation++
    }
    return binding
  }
  private state(binding: Binding): WritingStyleState {
    const root = `[data-style-document="${binding.id}"] :is(.cm-editor[data-mode="live"] .cm-content,.reading-article)`
    return {
      version: binding.version,
      typography: { ...binding.style.typography },
      name: binding.style.stylesheet?.name ?? null,
      css: binding.style.stylesheet ? compileStylesheet(binding.style.stylesheet.source, root) : '',
      storage: binding.storage,
      error: binding.error,
    }
  }
  private assertCurrent(binding: Binding, generation: number, authorize: () => void): void {
    authorize()
    if (
      this.bindings.get(`${binding.owner}:${binding.id}`) !== binding ||
      binding.generation !== generation ||
      this.files.describe(binding.owner, binding.id).displayPath !== binding.path
    )
      throw new FileOperationError('style-changed')
  }
  private async persist(
    binding: Binding,
    generation: number,
    authorize: () => void,
  ): Promise<WritingStyleState> {
    this.assertCurrent(binding, generation, authorize)
    binding.storage = 'session'
    binding.error = null
    if (binding.path) {
      try {
        await this.repository.set(keyFor(binding.path), binding.style, () =>
          this.assertCurrent(binding, generation, authorize),
        )
        this.assertCurrent(binding, generation, authorize)
        binding.storage = 'saved'
        binding.migrate = false
      } catch (error) {
        this.assertCurrent(binding, generation, authorize)
        binding.error =
          error instanceof FileOperationError &&
          ['style-capacity', 'style-readonly'].includes(error.code)
            ? (error.code as WritingStyleState['error'])
            : 'style-persist'
        binding.storage = binding.error === 'style-readonly' ? 'read-only' : 'unavailable'
      }
    }
    return this.state(binding)
  }
  async get(
    owner: number,
    id: string,
    authorize: () => void = () => {},
  ): Promise<WritingStyleState> {
    authorize()
    const binding = this.bind(owner, id)
    return binding.migrate
      ? this.persist(binding, ++binding.generation, authorize)
      : this.state(binding)
  }
  async set(
    owner: number,
    id: string,
    typography: WritingTypography,
    authorize: () => void = () => {},
  ): Promise<WritingStyleState> {
    authorize()
    const binding = this.bind(owner, id)
    binding.style = { ...binding.style, typography: parseTypography(typography) }
    binding.version++
    return this.persist(binding, ++binding.generation, authorize)
  }
  async reset(
    owner: number,
    id: string,
    stylesheetOnly: boolean,
    authorize: () => void = () => {},
  ): Promise<WritingStyleState> {
    authorize()
    const binding = this.bind(owner, id)
    binding.style = stylesheetOnly ? { ...binding.style, stylesheet: null } : defaultWritingStyle()
    binding.version++
    return this.persist(binding, ++binding.generation, authorize)
  }
  async import(
    owner: number,
    id: string,
    choose: () => Promise<string | null>,
    authorize: () => void = () => {},
  ): Promise<WritingStyleState | null> {
    authorize()
    if (this.pickers.has(owner)) throw new FileOperationError('style-busy')
    const binding = this.bind(owner, id),
      generation = ++binding.generation
    this.pickers.add(owner)
    try {
      const selected = await choose()
      this.assertCurrent(binding, generation, authorize)
      if (!selected) return null
      let source: string
      try {
        if (extname(selected).toLowerCase() !== '.css') throw new Error('Expected CSS file')
        source = new TextDecoder('utf-8', { fatal: true }).decode(
          (await readDisk(selected, styleLimits.input)).bytes,
        )
      } catch (error) {
        throw new FileOperationError(
          error instanceof FileOperationError && error.code === 'file-large'
            ? 'style-limit'
            : 'style-io',
        )
      }
      this.assertCurrent(binding, generation, authorize)
      compileStylesheet(source, 'article')
      const name =
        [...basename(selected)]
          .filter((character) => !hasStyleControls(character))
          .join('')
          .slice(0, 100) || 'document.css'
      binding.style = { ...binding.style, stylesheet: { name, source } }
      binding.version++
      return this.persist(binding, generation, authorize)
    } finally {
      this.pickers.delete(owner)
    }
  }
  capture(owner: number, id: string): WritingStyle {
    return structuredClone(this.bind(owner, id).style)
  }
  closeDocument(owner: number, id: string): void {
    this.bindings.delete(`${owner}:${id}`)
  }
  closeOwner(owner: number): void {
    for (const [key, binding] of this.bindings)
      if (binding.owner === owner) this.bindings.delete(key)
  }
}
