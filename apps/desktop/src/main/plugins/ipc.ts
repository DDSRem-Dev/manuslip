import { type BrowserWindow, dialog } from 'electron'
import type { Locale } from '../../shared/contracts'
import { parseId, record } from '../../shared/file-contracts'
import {
  parsePluginGrants,
  parsePluginRun,
  pluginChannels,
  pluginId,
} from '../../shared/plugin-contracts'
import { FileOperationError } from '../files/errors'
import type { Plugins } from './service'

export function registerPluginHandlers(
  register: <T>(channel: string, operation: (input: unknown) => Promise<T> | T) => void,
  getWindow: () => BrowserWindow | null,
  locale: () => Locale,
  plugins: Plugins,
): void {
  function owned(): { owner: number; window: BrowserWindow; authorize(): void } {
    const window = getWindow()
    if (!window || window.isDestroyed()) throw new FileOperationError('file-session')
    const frame = window.webContents.mainFrame
    return {
      owner: window.webContents.id,
      window,
      authorize: () => {
        if (
          getWindow() !== window ||
          window.isDestroyed() ||
          window.webContents.mainFrame !== frame
        )
          throw new FileOperationError('file-session')
      },
    }
  }
  register(pluginChannels.list, (input) => {
    if (input !== null) throw new FileOperationError('plugin-invalid')
    owned().authorize()
    return plugins.state()
  })
  register(pluginChannels.choose, (input) => {
    if (input !== null) throw new FileOperationError('plugin-invalid')
    const context = owned()
    return plugins.choose(
      context.owner,
      async () => {
        const result = await dialog.showOpenDialog(context.window, {
          title: locale() === 'zh-CN' ? '安装本地插件' : 'Install local plugin',
          properties: ['openFile'],
          filters: [{ name: 'Manuslip plugin', extensions: ['json'] }],
        })
        context.authorize()
        return result.canceled ? null : result.filePaths[0] || null
      },
      context.authorize,
    )
  })
  register(pluginChannels.install, (input) => {
    const context = owned(),
      value = record(input)
    if (Object.keys(value).length !== 2) throw new FileOperationError('plugin-invalid')
    return plugins.install(
      context.owner,
      parseId(value.token),
      parsePluginGrants(value.grants),
      context.authorize,
    )
  })
  register(pluginChannels.enable, (input) => {
    const context = owned(),
      value = record(input)
    if (Object.keys(value).length !== 2 || typeof value.enabled !== 'boolean')
      throw new FileOperationError('plugin-invalid')
    return plugins.change(pluginId(value.id), { enabled: value.enabled }, context.authorize)
  })
  register(pluginChannels.grant, (input) => {
    const context = owned(),
      value = record(input)
    if (Object.keys(value).length !== 2) throw new FileOperationError('plugin-invalid')
    return plugins.change(
      pluginId(value.id),
      { grants: parsePluginGrants(value.grants) },
      context.authorize,
    )
  })
  register(pluginChannels.remove, (input) =>
    plugins.change(pluginId(input), null, owned().authorize),
  )
  register(pluginChannels.run, (input) => {
    const context = owned()
    return plugins.run(context.window, parsePluginRun(input), context.authorize, locale())
  })
  register(pluginChannels.cancel, (input) => {
    const context = owned()
    plugins.cancel(context.owner, parseId(input))
    return null
  })
}
