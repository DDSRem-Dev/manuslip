import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  assetChannels,
  parseCaptureRequest,
  parseConvertedHtml,
  parseHtmlRequest,
  parseImportedImage,
  parseLocalRequest,
} from '../shared/asset-contracts'
import {
  channels,
  type DesktopBridge,
  parseBootstrap,
  parseClipboardAction,
  parseExternalLink,
  parseResult,
  parseSettings,
} from '../shared/contracts'
import { diagramChannels, parseDiagramRequest, parseDiagramSvg } from '../shared/diagram-contracts'
import { exportChannels, parseExportOutcome, parseExportRequest } from '../shared/export-contracts'
import {
  fileChannels,
  parseCheckpoint,
  parseCommand,
  parseId,
  parseRecoveries,
  parseRevision,
  parseSaveOutcome,
  parseSaveRequest,
  parseSnapshot,
} from '../shared/file-contracts'
import {
  imageChannels,
  parseAssetUrl,
  parseImagePermission,
  parseImageRequest,
} from '../shared/image-contracts'
import { incomingChannels, incomingLimit, parseIncomingState } from '../shared/incoming-contracts'
import { pandocChannels, parsePandocToolState } from '../shared/pandoc-contracts'
import {
  parsePluginCandidate,
  parsePluginGrants,
  parsePluginOutcome,
  parsePluginRun,
  parsePluginState,
  pluginChannels,
  pluginId,
} from '../shared/plugin-contracts'
import {
  parseSearchOpen,
  parseSearchOpened,
  parseSearchPage,
  parseSearchPoll,
  parseSearchRequest,
  searchChannels,
} from '../shared/search-contracts'
import {
  parseStyleReset,
  parseTypographyRequest,
  parseWritingStyleState,
  styleChannels,
} from '../shared/style-contracts'
import {
  parseSyncChoice,
  parseSyncConnect,
  parseSyncCredential,
  parseSyncRecoveryId,
  parseSyncState,
  syncChannels,
} from '../shared/sync-contracts'
import {
  parseCredentialRequest,
  parseTranslationOutcome,
  parseTranslationRequest,
  parseTranslationSettings,
  parseTranslationState,
  translationChannels,
} from '../shared/translation-contracts'
import {
  parseRememberDocuments,
  parseWorkspace,
  parseWorkspaceChange,
  parseWorkspaceList,
  parseWorkspacePage,
  workspaceChannels,
} from '../shared/workspace-contracts'

function parseNull(value: unknown): null {
  if (value !== null) throw new Error('Expected null')
  return null
}

const bridge: DesktopBridge = {
  edit: async (action) =>
    parseResult(await ipcRenderer.invoke(channels.edit, parseClipboardAction(action)), parseNull),
  syncState: async (id) =>
    parseResult(await ipcRenderer.invoke(syncChannels.state, parseId(id)), parseSyncState),
  connectSync: async (request) =>
    parseResult(
      await ipcRenderer.invoke(syncChannels.connect, parseSyncConnect(request)),
      parseSyncState,
    ),
  setSyncCredential: async (request) =>
    parseResult(
      await ipcRenderer.invoke(syncChannels.credential, parseSyncCredential(request)),
      parseSyncState,
    ),
  reviewSync: async (id) =>
    parseResult(await ipcRenderer.invoke(syncChannels.review, parseId(id)), parseSyncState),
  resolveSync: async (token, choice) =>
    parseResult(
      await ipcRenderer.invoke(syncChannels.resolve, {
        token: parseId(token),
        choice: parseSyncChoice(choice),
      }),
      parseSyncState,
    ),
  cancelSync: async (id) =>
    parseResult(await ipcRenderer.invoke(syncChannels.cancel, parseId(id)), parseNull),
  disconnectSync: async (id) =>
    parseResult(await ipcRenderer.invoke(syncChannels.disconnect, parseId(id)), parseSyncState),
  exportSyncRecovery: async (id) =>
    parseResult(await ipcRenderer.invoke(syncChannels.export, parseSyncRecoveryId(id)), (value) => {
      if (typeof value !== 'boolean') throw new Error('sync-invalid')
      return value
    }),
  removeSyncRecovery: async (id) =>
    parseResult(await ipcRenderer.invoke(syncChannels.remove, parseSyncRecoveryId(id)), parseNull),
  plugins: async () =>
    parseResult(await ipcRenderer.invoke(pluginChannels.list, null), parsePluginState),
  choosePlugin: async () =>
    parseResult(await ipcRenderer.invoke(pluginChannels.choose, null), parsePluginCandidate),
  installPlugin: async (token, grants) =>
    parseResult(
      await ipcRenderer.invoke(pluginChannels.install, {
        token: parseId(token),
        grants: parsePluginGrants(grants),
      }),
      parsePluginState,
    ),
  enablePlugin: async (id, enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid plugin state')
    return parseResult(
      await ipcRenderer.invoke(pluginChannels.enable, { id: pluginId(id), enabled }),
      parsePluginState,
    )
  },
  grantPlugin: async (id, grants) =>
    parseResult(
      await ipcRenderer.invoke(pluginChannels.grant, {
        id: pluginId(id),
        grants: parsePluginGrants(grants),
      }),
      parsePluginState,
    ),
  removePlugin: async (id) =>
    parseResult(await ipcRenderer.invoke(pluginChannels.remove, pluginId(id)), parsePluginState),
  runPlugin: async (request) =>
    parseResult(
      await ipcRenderer.invoke(pluginChannels.run, parsePluginRun(request)),
      parsePluginOutcome,
    ),
  cancelPlugin: async (jobId) =>
    parseResult(await ipcRenderer.invoke(pluginChannels.cancel, parseId(jobId)), parseNull),
  pandocTool: async () =>
    parseResult(await ipcRenderer.invoke(pandocChannels.get, null), parsePandocToolState),
  selectPandocTool: async () =>
    parseResult(await ipcRenderer.invoke(pandocChannels.select, null), (value) =>
      value === null ? null : parsePandocToolState(value),
    ),
  forgetPandocTool: async () =>
    parseResult(await ipcRenderer.invoke(pandocChannels.forget, null), parsePandocToolState),
  retryPandocTool: async () =>
    parseResult(await ipcRenderer.invoke(pandocChannels.retry, null), parsePandocToolState),
  writingStyle: async (id) =>
    parseResult(await ipcRenderer.invoke(styleChannels.get, parseId(id)), parseWritingStyleState),
  setWritingTypography: async (id, typography) =>
    parseResult(
      await ipcRenderer.invoke(styleChannels.set, parseTypographyRequest({ id, typography })),
      parseWritingStyleState,
    ),
  importWritingStylesheet: async (id) =>
    parseResult(await ipcRenderer.invoke(styleChannels.import, parseId(id)), (value) =>
      value === null ? null : parseWritingStyleState(value),
    ),
  resetWritingStyle: async (id, stylesheetOnly) =>
    parseResult(
      await ipcRenderer.invoke(styleChannels.reset, parseStyleReset({ id, stylesheetOnly })),
      parseWritingStyleState,
    ),
  translationState: async () =>
    parseResult(await ipcRenderer.invoke(translationChannels.state, null), parseTranslationState),
  loadTranslationLanguages: async () =>
    parseResult(
      await ipcRenderer.invoke(translationChannels.languages, null),
      parseTranslationState,
    ),
  configureTranslation: async (settings) =>
    parseResult(
      await ipcRenderer.invoke(translationChannels.configure, parseTranslationSettings(settings)),
      parseTranslationState,
    ),
  setTranslationCredential: async (request) =>
    parseResult(
      await ipcRenderer.invoke(translationChannels.credential, parseCredentialRequest(request)),
      parseTranslationState,
    ),
  translateUnit: async (request) =>
    parseResult(
      await ipcRenderer.invoke(translationChannels.unit, parseTranslationRequest(request)),
      parseTranslationOutcome,
    ),
  cancelTranslation: async (id) =>
    parseResult(await ipcRenderer.invoke(translationChannels.cancel, parseId(id)), parseNull),
  clearTranslationCache: async () =>
    parseResult(await ipcRenderer.invoke(translationChannels.clear, null), parseTranslationState),
  onTranslationChanged: (listener) => {
    const handler = (): void => listener()
    ipcRenderer.on(translationChannels.changed, handler)
    return () => ipcRenderer.removeListener(translationChannels.changed, handler)
  },
  exportDocument: async (request) =>
    parseResult(
      await ipcRenderer.invoke(exportChannels.start, parseExportRequest(request)),
      parseExportOutcome,
    ),
  cancelExport: async (jobId) =>
    parseResult(await ipcRenderer.invoke(exportChannels.cancel, parseId(jobId)), parseNull),
  renderDiagram: async (request) =>
    parseResult(
      await ipcRenderer.invoke(diagramChannels.render, parseDiagramRequest(request)),
      parseDiagramSvg,
    ),
  cancelDiagram: async (jobId) =>
    parseResult(await ipcRenderer.invoke(diagramChannels.cancel, parseId(jobId)), parseNull),
  onDiagramCapacity: (listener) => {
    const handler = (): void => listener()
    ipcRenderer.on(diagramChannels.capacity, handler)
    return () => ipcRenderer.removeListener(diagramChannels.capacity, handler)
  },
  loadLocalImage: async (id, reference) =>
    parseResult(
      await ipcRenderer.invoke(assetChannels.load, parseLocalRequest({ id, reference })),
      parseAssetUrl,
    ),
  captureClipboardImage: async (id) =>
    parseResult(await ipcRenderer.invoke(assetChannels.capture, parseId(id)), parseId),
  importClipboardImage: async (id, captureId) =>
    parseResult(
      await ipcRenderer.invoke(assetChannels.import, parseCaptureRequest({ id, captureId })),
      parseImportedImage,
    ),
  discardClipboardImage: async (id, captureId) =>
    parseResult(
      await ipcRenderer.invoke(assetChannels.discard, parseCaptureRequest({ id, captureId })),
      parseNull,
    ),
  convertClipboardHtml: async (id, html) =>
    parseResult(
      await ipcRenderer.invoke(assetChannels.convert, parseHtmlRequest({ id, html })),
      parseConvertedHtml,
    ),
  startSearch: async (request) =>
    parseResult(
      await ipcRenderer.invoke(searchChannels.start, parseSearchRequest(request)),
      parseNull,
    ),
  pollSearch: async (id, cursor) =>
    parseResult(
      await ipcRenderer.invoke(searchChannels.poll, parseSearchPoll({ id, cursor })),
      parseSearchPage,
    ),
  cancelSearch: async (id) =>
    parseResult(await ipcRenderer.invoke(searchChannels.cancel, parseId(id)), parseNull),
  openSearchResult: async (id, entryId) =>
    parseResult(
      await ipcRenderer.invoke(searchChannels.open, parseSearchOpen({ id, entryId })),
      parseSearchOpened,
    ),
  incomingFiles: async () =>
    parseResult(await ipcRenderer.invoke(incomingChannels.list, null), parseIncomingState),
  openIncomingFile: async (id) =>
    parseResult(await ipcRenderer.invoke(incomingChannels.open, parseId(id)), parseSnapshot),
  dismissIncomingFile: async (id) =>
    parseResult(
      await ipcRenderer.invoke(incomingChannels.dismiss, id === null ? null : parseId(id)),
      parseNull,
    ),
  onIncomingFiles: (listener) => {
    const handler = (): void => listener()
    ipcRenderer.on(incomingChannels.changed, handler)
    return () => {
      ipcRenderer.removeListener(incomingChannels.changed, handler)
    }
  },
  workspace: async () =>
    parseResult(await ipcRenderer.invoke(workspaceChannels.bootstrap, null), parseWorkspace),
  chooseWorkspace: async () =>
    parseResult(await ipcRenderer.invoke(workspaceChannels.choose, null), (value) =>
      value === null ? null : parseWorkspace(value),
    ),
  recentWorkspace: async (id) =>
    parseResult(await ipcRenderer.invoke(workspaceChannels.recent, parseId(id)), parseWorkspace),
  closeWorkspace: async () =>
    parseResult(await ipcRenderer.invoke(workspaceChannels.close, null), parseWorkspace),
  refreshWorkspace: async () =>
    parseResult(await ipcRenderer.invoke(workspaceChannels.refresh, null), parseWorkspace),
  onWorkspaceChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      listener(parseWorkspaceChange(value))
    }
    ipcRenderer.on(workspaceChannels.changed, handler)
    return () => ipcRenderer.removeListener(workspaceChannels.changed, handler)
  },
  listWorkspace: async (id, offset = 0) =>
    parseResult(
      await ipcRenderer.invoke(workspaceChannels.list, parseWorkspaceList({ id, offset })),
      parseWorkspacePage,
    ),
  openWorkspaceFile: async (id) =>
    parseResult(await ipcRenderer.invoke(workspaceChannels.open, parseId(id)), parseSnapshot),
  restoreSessionFile: async (id) =>
    parseResult(await ipcRenderer.invoke(workspaceChannels.restore, parseId(id)), parseSnapshot),
  forgetSessionFile: async (id) =>
    parseResult(await ipcRenderer.invoke(workspaceChannels.forget, parseId(id)), parseNull),
  rememberDocuments: async (ids, activeId) =>
    parseResult(
      await ipcRenderer.invoke(
        workspaceChannels.remember,
        parseRememberDocuments({ ids, activeId }),
      ),
      parseNull,
    ),
  remoteImages: async (id, enabled) =>
    parseResult(
      await ipcRenderer.invoke(imageChannels.permission, parseImagePermission({ id, enabled })),
      (value) => {
        if (typeof value !== 'boolean') throw new Error('Invalid image permission')
        return value
      },
    ),
  loadRemoteImage: async (id, url) =>
    parseResult(
      await ipcRenderer.invoke(imageChannels.load, parseImageRequest({ id, url })),
      parseAssetUrl,
    ),
  openLink: async (url) =>
    parseResult(await ipcRenderer.invoke(channels.openLink, parseExternalLink(url)), parseNull),
  bootstrap: async () =>
    parseResult(await ipcRenderer.invoke(channels.bootstrap, null), parseBootstrap),
  updateSettings: async (input) =>
    parseResult(await ipcRenderer.invoke(channels.settings, parseSettings(input)), parseSettings),
  newDocument: async () =>
    parseResult(await ipcRenderer.invoke(fileChannels.create, null), parseSnapshot),
  openDocument: async () =>
    parseResult(await ipcRenderer.invoke(fileChannels.open, null), (value) =>
      value === null ? null : parseSnapshot(value),
    ),
  saveDocument: async (request) =>
    parseResult(
      await ipcRenderer.invoke(fileChannels.save, parseSaveRequest(request)),
      parseSaveOutcome,
    ),
  reloadDocument: async (id, encoding) =>
    parseResult(
      await ipcRenderer.invoke(fileChannels.reload, {
        id: parseId(id),
        ...(encoding ? { encoding } : {}),
      }),
      parseSnapshot,
    ),
  closeDocument: async (id) =>
    parseResult(await ipcRenderer.invoke(fileChannels.close, parseId(id)), parseNull),
  confirmDocumentClose: async (id) =>
    parseResult(await ipcRenderer.invoke(fileChannels.confirmClose, parseId(id)), (value) => {
      if (value !== 'save' && value !== 'discard' && value !== 'cancel')
        throw new Error('Invalid close decision')
      return value
    }),
  closeWindow: async (proceed = true) => {
    if (typeof proceed !== 'boolean') throw new Error('Invalid close decision')
    return parseResult(await ipcRenderer.invoke(fileChannels.closeWindow, proceed), parseNull)
  },
  checkpoint: async (request) =>
    parseResult(
      await ipcRenderer.invoke(fileChannels.checkpoint, parseCheckpoint(request)),
      parseNull,
    ),
  clearRecovery: async (id, revision) =>
    parseResult(
      await ipcRenderer.invoke(fileChannels.clearRecovery, {
        id: parseId(id),
        revision: parseRevision(revision),
      }),
      parseNull,
    ),
  listRecoveries: async () =>
    parseResult(await ipcRenderer.invoke(fileChannels.recoveries, null), parseRecoveries),
  restoreRecovery: async (id) =>
    parseResult(await ipcRenderer.invoke(fileChannels.restoreRecovery, parseId(id)), parseSnapshot),
  discardRecovery: async (id) =>
    parseResult(await ipcRenderer.invoke(fileChannels.discardRecovery, parseId(id)), parseNull),
  onFileChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      listener(parseId(value))
    }
    ipcRenderer.on(fileChannels.changed, handler)
    return () => {
      ipcRenderer.removeListener(fileChannels.changed, handler)
    }
  },
  onCommand: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      listener(parseCommand(value))
    }
    ipcRenderer.on(fileChannels.command, handler)
    return () => {
      ipcRenderer.removeListener(fileChannels.command, handler)
    }
  },
}

contextBridge.exposeInMainWorld('manuslip', Object.freeze(bridge))

// Native files never reach CodeMirror's text-drop handler or browser navigation. This
// private route accepts only trusted disk-backed drops, not renderer-provided paths.
window.addEventListener(
  'dragover',
  (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
  },
  true,
)
window.addEventListener(
  'drop',
  (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!event.isTrusted) return
    const paths = Array.from(event.dataTransfer.files)
      .slice(0, incomingLimit + 1)
      .map((file) => webUtils.getPathForFile(file))
      .filter(Boolean)
    if (paths.length) void ipcRenderer.invoke(incomingChannels.drop, paths).catch(() => {})
  },
  true,
)
