import { type FSWatcher, watch } from 'node:fs'

/** Watch only directories the user has browsed, without traversing the workspace. */
export class WorkspaceWatcher {
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>()
  private disposed = false
  constructor(private readonly changed: (id: string) => void) {}

  watch(id: string, path: string): void {
    if (this.disposed || this.watchers.has(id)) return
    try {
      const watcher = watch(path, { persistent: false }, () => this.schedule(id))
      this.watchers.set(id, watcher)
      watcher.on('error', () => {
        this.remove(id)
        this.schedule(id)
      })
    } catch {
      // Focus reconciliation still updates folders on filesystems without watch support.
    }
  }

  private schedule(id: string): void {
    if (this.disposed || this.pending.has(id)) return
    const timer = setTimeout(() => {
      this.pending.delete(id)
      this.changed(id)
    }, 100)
    timer.unref()
    this.pending.set(id, timer)
  }

  remove(id: string): void {
    this.watchers.get(id)?.close()
    this.watchers.delete(id)
    const timer = this.pending.get(id)
    if (timer) clearTimeout(timer)
    this.pending.delete(id)
  }

  dispose(): void {
    this.disposed = true
    for (const id of new Set([...this.watchers.keys(), ...this.pending.keys()])) this.remove(id)
  }
}
