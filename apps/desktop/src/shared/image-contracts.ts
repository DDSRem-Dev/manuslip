import { parseExternalLink } from './contracts'
import { parseId, record } from './file-contracts'

export const imageChannels = {
  permission: 'manuslip:image:permission',
  load: 'manuslip:image:load',
} as const
export interface ImageBridge {
  remoteImages(id: string, enabled: boolean): Promise<import('./contracts').Result<boolean>>
  loadRemoteImage(id: string, url: string): Promise<import('./contracts').Result<string>>
}
export function parseImagePermission(input: unknown): { id: string; enabled: boolean } {
  const value = record(input)
  if (
    Object.keys(value).some((key) => !['id', 'enabled'].includes(key)) ||
    typeof value.enabled !== 'boolean'
  )
    throw new Error('Invalid image permission')
  return { id: parseId(value.id), enabled: value.enabled }
}
export function parseImageRequest(input: unknown): { id: string; url: string } {
  const value = record(input)
  if (Object.keys(value).some((key) => !['id', 'url'].includes(key)))
    throw new Error('Invalid image request')
  return { id: parseId(value.id), url: parseExternalLink(value.url) }
}
export function parseAssetUrl(input: unknown): string {
  if (typeof input !== 'string' || !/^manuslip-asset:\/\/image\/[0-9a-f-]{36}$/.test(input))
    throw new Error('Invalid image asset')
  parseId(input.slice('manuslip-asset://image/'.length))
  return input
}
