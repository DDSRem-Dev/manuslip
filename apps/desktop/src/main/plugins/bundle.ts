import { createHash } from 'node:crypto'
import { record } from '../../shared/file-contracts'
import {
  type PluginManifest,
  parsePluginManifest,
  pluginLimits,
  pluginText,
} from '../../shared/plugin-contracts'
import { FileOperationError } from '../files/errors'

export interface PluginBundle {
  manifest: PluginManifest
  code: string
}
export function parsePluginBundle(input: unknown): PluginBundle {
  try {
    const value = record(input)
    if (Object.keys(value).length !== 2) throw new Error('Invalid bundle')
    const manifest = parsePluginManifest(value.manifest),
      code = pluginText(value.code, pluginLimits.code)
    if (!code.trim() || Buffer.byteLength(JSON.stringify({ manifest, code })) > pluginLimits.bundle)
      throw new Error('Bundle limit')
    return { manifest, code }
  } catch {
    throw new FileOperationError('plugin-invalid')
  }
}
export function pluginFingerprint(bundle: PluginBundle): string {
  return createHash('sha256').update(JSON.stringify(bundle)).digest('hex')
}
