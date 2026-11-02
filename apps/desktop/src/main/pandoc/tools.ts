import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { type PandocToolState, pandocLimits } from '../../shared/pandoc-contracts'
import { FileOperationError } from '../files/errors'
import { assertPandocTool, inspectPandocBinary, type PandocTool } from './binary'
import { runPandocProcess } from './process'
import type { PandocRepository } from './repository'

/** Executable paths and fingerprints stay in main. Selection is always explicit. */
export class PandocTools {
  private tool: PandocTool | null
  private persisted = true
  private generation = 0
  private readonly pending = new Map<number, AbortController>()
  constructor(private readonly repository: PandocRepository) {
    this.tool = repository.get()
  }
  state(): PandocToolState {
    return {
      tool: this.tool ? { name: basename(this.tool.path), version: this.tool.version } : null,
      persisted: this.persisted,
      recovered: this.repository.recovered,
      readOnly: this.repository.readOnly,
    }
  }
  capture(): PandocTool {
    if (!this.tool) throw new FileOperationError('pandoc-tool')
    return { ...this.tool }
  }
  private invalidate(): number {
    this.generation++
    for (const controller of this.pending.values())
      controller.abort(new FileOperationError('export-cancelled'))
    return this.generation
  }
  private async save(current: () => void): Promise<PandocToolState> {
    try {
      await this.repository.set(this.tool, current)
      current()
      this.persisted = true
    } catch (error) {
      current()
      this.persisted = false
      if (error instanceof FileOperationError && error.code === 'file-session') throw error
    }
    return this.state()
  }
  async select(
    owner: number,
    choose: () => Promise<string | null>,
    authorize: () => void,
  ): Promise<PandocToolState | null> {
    authorize()
    if (this.pending.has(owner)) throw new FileOperationError('pandoc-busy')
    const generation = this.invalidate(),
      controller = new AbortController()
    this.pending.set(owner, controller)
    const current = (): void => {
      authorize()
      controller.signal.throwIfAborted()
      if (generation !== this.generation) throw new FileOperationError('export-cancelled')
    }
    let directory: string | undefined
    try {
      const selected = await choose()
      current()
      if (!selected) return null
      const binary = await inspectPandocBinary(selected, controller.signal)
      current()
      directory = await mkdtemp(join(tmpdir(), 'manuslip-pandoc-probe-'))
      const output = await runPandocProcess(
        binary.path,
        ['--version'],
        Buffer.alloc(0),
        directory,
        controller.signal,
        { output: pandocLimits.version, deadline: pandocLimits.versionMs },
      )
      const version = /^pandoc (3\.\d+(?:\.\d+){0,2})(?:\r?\n|$)/.exec(output.toString('utf8'))?.[1]
      if (!version) throw new FileOperationError('pandoc-tool')
      const tool = { ...binary, version }
      await assertPandocTool(tool, controller.signal)
      current()
      this.tool = tool
      this.persisted = false
      return await this.save(current)
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {})
      if (this.pending.get(owner) === controller) this.pending.delete(owner)
    }
  }
  async forget(authorize: () => void): Promise<PandocToolState> {
    authorize()
    const generation = this.invalidate()
    this.tool = null
    this.persisted = false
    return this.save(() => {
      authorize()
      if (generation !== this.generation) throw new FileOperationError('export-cancelled')
    })
  }
  async retry(authorize: () => void): Promise<PandocToolState> {
    authorize()
    const generation = this.invalidate()
    return this.save(() => {
      authorize()
      if (generation !== this.generation) throw new FileOperationError('export-cancelled')
    })
  }
  closeOwner(owner: number): void {
    this.pending.get(owner)?.abort(new FileOperationError('file-session'))
  }
}
