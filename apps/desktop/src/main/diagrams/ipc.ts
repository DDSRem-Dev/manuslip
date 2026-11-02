import type { BrowserWindow } from 'electron'
import { diagramChannels, parseDiagramRequest } from '../../shared/diagram-contracts'
import { parseId } from '../../shared/file-contracts'
import { FileOperationError } from '../files/errors'
import type { FileSessions } from '../files/sessions'
import { withOwnedWindow } from '../owned-window'
import { DiagramBroker } from './broker'
import { ElectronDiagramFactory } from './host'

export class Diagrams {
  private readonly owners = new Map<
    number,
    { broker: DiagramBroker; factory: ElectronDiagramFactory }
  >()
  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly files: FileSessions,
  ) {}
  register(
    register: <T>(channel: string, operation: (input: unknown) => T | Promise<T>) => void,
  ): void {
    register(diagramChannels.render, (input) => {
      let request: ReturnType<typeof parseDiagramRequest>
      try {
        request = parseDiagramRequest(input)
      } catch (error) {
        if (error instanceof Error && ['diagram-limit', 'diagram-config'].includes(error.message))
          throw new FileOperationError(error.message as 'diagram-limit' | 'diagram-config')
        throw error
      }
      return withOwnedWindow(
        this.getWindow,
        async (owner) => this.closeOwner(owner),
        async (window) => {
          const owner = window.webContents.id
          this.files.describe(owner, request.documentId)
          const broker = this.owners.get(owner)?.broker || this.create(window)
          const svg = await broker.render(request)
          this.files.describe(owner, request.documentId)
          return svg
        },
      )
    })
    register(diagramChannels.cancel, (input) => {
      const jobId = parseId(input)
      const owner = this.getWindow()?.webContents.id
      if (owner !== undefined) this.owners.get(owner)?.broker.cancel(jobId)
      return null
    })
  }
  private create(window: BrowserWindow): DiagramBroker {
    const owner = window.webContents.id
    const factory = new ElectronDiagramFactory(owner, () =>
      window.isDestroyed() ? 0 : window.webContents.getOSProcessId(),
    )
    const broker = new DiagramBroker(factory, () => {
      if (!window.isDestroyed()) window.webContents.send(diagramChannels.capacity)
    })
    this.owners.set(owner, { broker, factory })
    return broker
  }
  closeDocument(owner: number, documentId: string): void {
    this.owners.get(owner)?.broker.closeDocument(documentId)
  }
  closeOwner(owner: number): void {
    const entry = this.owners.get(owner)
    if (!entry) return
    this.owners.delete(owner)
    entry.broker.dispose()
    entry.factory.dispose()
  }
}
