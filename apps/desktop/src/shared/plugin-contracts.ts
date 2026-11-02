import { utf8Bytes } from '@manuslip/core/text'
import type { Result } from './contracts'
import { parseId, parseRevision, record } from './file-contracts'

export const pluginLimits = {
  bundle: 256 * 1024,
  code: 128 * 1024,
  repository: 8 * 1024 * 1024,
  installed: 32,
  commands: 20,
  text: 2 * 1024 * 1024,
  request: 64 * 1024,
  response: 1024 * 1024,
  calls: 16,
  totalMs: 15_000,
} as const
export type PluginPermission =
  | 'document.read'
  | 'document.write'
  | 'files.read'
  | 'files.write'
  | 'network'
export const pluginPermissions: readonly PluginPermission[] = [
  'document.read',
  'document.write',
  'files.read',
  'files.write',
  'network',
]
export interface PluginCommand {
  id: string
  title: string
  kind: 'inspect' | 'transform'
}
export interface PluginManifest {
  apiVersion: 1
  id: string
  name: string
  version: string
  description: string
  commands: PluginCommand[]
  permissions: PluginPermission[]
  networkOrigins: string[]
}
export interface PluginSummary extends PluginManifest {
  fingerprint: string
}
export interface InstalledPlugin extends PluginSummary {
  enabled: boolean
  grants: PluginPermission[]
}
export interface PluginState {
  plugins: InstalledPlugin[]
  recovered: boolean
  readOnly: boolean
}
export interface PluginCandidate {
  token: string
  plugin: PluginSummary
}
export interface PluginRunRequest {
  jobId: string
  documentId: string
  revision: number
  pluginId: string
  commandId: string
  text: string
  selections: { anchor: number; head: number }[]
}
export interface PluginOutcome {
  pluginId: string
  fingerprint: string
  kind: 'inspect' | 'transform'
  text: string
  revision: number
}
export interface PluginBridge {
  plugins(): Promise<Result<PluginState>>
  choosePlugin(): Promise<Result<PluginCandidate | null>>
  installPlugin(token: string, grants: PluginPermission[]): Promise<Result<PluginState>>
  enablePlugin(id: string, enabled: boolean): Promise<Result<PluginState>>
  grantPlugin(id: string, grants: PluginPermission[]): Promise<Result<PluginState>>
  removePlugin(id: string): Promise<Result<PluginState>>
  runPlugin(request: PluginRunRequest): Promise<Result<PluginOutcome>>
  cancelPlugin(jobId: string): Promise<Result<null>>
}
export const pluginChannels = {
  list: 'manuslip:plugins:list',
  choose: 'manuslip:plugins:choose',
  install: 'manuslip:plugins:install',
  enable: 'manuslip:plugins:enable',
  grant: 'manuslip:plugins:grant',
  remove: 'manuslip:plugins:remove',
  run: 'manuslip:plugins:run',
  cancel: 'manuslip:plugins:cancel',
} as const
export const pluginHostChannels = {
  ready: 'manuslip:plugin-host:ready',
  job: 'manuslip:plugin-host:job',
  result: 'manuslip:plugin-host:result',
  call: 'manuslip:plugin-host:call',
  reply: 'manuslip:plugin-host:reply',
} as const
function invalid(): never {
  throw new Error('plugin-invalid')
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid()
}
export function pluginText(value: unknown, maximum = pluginLimits.text): string {
  if (
    typeof value !== 'string' ||
    value.length > maximum ||
    !value.isWellFormed() ||
    utf8Bytes(value) > maximum
  )
    invalid()
  return value
}
function label(value: unknown, maximum: number, empty = false): string {
  const text = pluginText(value, maximum)
  if (
    (!empty && !text.trim()) ||
    [...text].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    invalid()
  return text
}
export function pluginId(input: unknown): string {
  if (
    typeof input !== 'string' ||
    !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(input) ||
    input.length > 80
  )
    invalid()
  return input
}
export function parsePluginGrants(input: unknown): PluginPermission[] {
  if (
    !Array.isArray(input) ||
    input.length > pluginPermissions.length ||
    new Set(input).size !== input.length ||
    input.some((value) => !pluginPermissions.includes(value))
  )
    invalid()
  return [...input] as PluginPermission[]
}
export function pluginUrl(input: unknown): URL {
  const text = pluginText(input, 2048)
  const url = new URL(text)
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    invalid()
  return url
}
export function parsePluginManifest(input: unknown): PluginManifest {
  const value = record(input)
  keys(value, [
    'apiVersion',
    'id',
    'name',
    'version',
    'description',
    'commands',
    'permissions',
    'networkOrigins',
  ])
  if (
    value.apiVersion !== 1 ||
    typeof value.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(value.version) ||
    value.version.length > 48
  )
    invalid()
  if (
    !Array.isArray(value.commands) ||
    !value.commands.length ||
    value.commands.length > pluginLimits.commands
  )
    invalid()
  const commands = value.commands.map((input): PluginCommand => {
    const command = record(input)
    keys(command, ['id', 'title', 'kind'])
    if (command.kind !== 'inspect' && command.kind !== 'transform') invalid()
    return { id: pluginId(command.id), title: label(command.title, 120), kind: command.kind }
  })
  if (new Set(commands.map((command) => command.id)).size !== commands.length) invalid()
  const permissions = parsePluginGrants(value.permissions)
  if (
    commands.some((command) => command.kind === 'transform') &&
    !permissions.includes('document.write')
  )
    invalid()
  if (
    !Array.isArray(value.networkOrigins) ||
    value.networkOrigins.length > 8 ||
    value.networkOrigins.some((origin) => pluginUrl(origin).origin !== origin) ||
    new Set(value.networkOrigins).size !== value.networkOrigins.length
  )
    invalid()
  if (permissions.includes('network') !== value.networkOrigins.length > 0) invalid()
  return {
    apiVersion: 1,
    id: pluginId(value.id),
    name: label(value.name, 120),
    version: value.version,
    description: label(value.description, 500, true),
    commands,
    permissions,
    networkOrigins: [...value.networkOrigins],
  }
}
export function parsePluginSummary(input: unknown): PluginSummary {
  const value = record(input),
    { fingerprint, ...manifest } = value
  if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) invalid()
  return { ...parsePluginManifest(manifest), fingerprint }
}
export function parsePluginState(input: unknown): PluginState {
  const value = record(input)
  keys(value, ['plugins', 'recovered', 'readOnly'])
  if (
    !Array.isArray(value.plugins) ||
    value.plugins.length > pluginLimits.installed ||
    typeof value.recovered !== 'boolean' ||
    typeof value.readOnly !== 'boolean'
  )
    invalid()
  const plugins = value.plugins.map((input) => {
    const value = record(input),
      { enabled, grants, ...summary } = value
    if (typeof enabled !== 'boolean') invalid()
    const plugin = parsePluginSummary(summary),
      parsed = parsePluginGrants(grants)
    if (parsed.some((permission) => !plugin.permissions.includes(permission))) invalid()
    return { ...plugin, enabled, grants: parsed }
  })
  if (new Set(plugins.map((plugin) => plugin.id)).size !== plugins.length) invalid()
  return { plugins, recovered: value.recovered, readOnly: value.readOnly }
}
export function parsePluginCandidate(input: unknown): PluginCandidate | null {
  if (input === null) return null
  const value = record(input)
  keys(value, ['token', 'plugin'])
  return { token: parseId(value.token), plugin: parsePluginSummary(value.plugin) }
}
export function parsePluginRun(input: unknown): PluginRunRequest {
  const value = record(input)
  keys(value, ['jobId', 'documentId', 'revision', 'pluginId', 'commandId', 'text', 'selections'])
  const text = pluginText(value.text)
  if (!Array.isArray(value.selections) || !value.selections.length || value.selections.length > 256)
    invalid()
  const selections = value.selections.map((input) => {
    const range = record(input)
    keys(range, ['anchor', 'head'])
    if (
      ![range.anchor, range.head].every(
        (position) =>
          Number.isSafeInteger(position) &&
          (position as number) >= 0 &&
          (position as number) <= text.length,
      )
    )
      invalid()
    return { anchor: range.anchor as number, head: range.head as number }
  })
  return {
    jobId: parseId(value.jobId),
    documentId: parseId(value.documentId),
    revision: parseRevision(value.revision),
    pluginId: pluginId(value.pluginId),
    commandId: pluginId(value.commandId),
    text,
    selections,
  }
}
export function parsePluginOutcome(input: unknown): PluginOutcome {
  const value = record(input)
  keys(value, ['kind', 'text', 'revision', 'pluginId', 'fingerprint'])
  if (typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)) invalid()
  if (value.kind !== 'inspect' && value.kind !== 'transform') invalid()
  return {
    kind: value.kind,
    text: pluginText(value.text),
    revision: parseRevision(value.revision),
    pluginId: pluginId(value.pluginId),
    fingerprint: value.fingerprint,
  }
}
