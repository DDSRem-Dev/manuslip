import { useId } from 'react'
import type { PluginManifest, PluginPermission } from '../../shared/plugin-contracts'
import { pluginCopy } from './plugin-copy'

export function PluginPermissions({
  plugin,
  grants,
  change,
  disabled,
  locale,
}: {
  plugin: PluginManifest
  grants: PluginPermission[]
  change(value: PluginPermission[]): void
  disabled: boolean
  locale: string
}): React.JSX.Element {
  const copy = pluginCopy[locale === 'zh-CN' ? 'zh-CN' : 'en'],
    id = useId()
  return (
    <fieldset className="plugin-permissions" disabled={disabled} aria-describedby={`${id}-hint`}>
      <legend>{copy.permissions}</legend>
      <p id={`${id}-hint`} className="muted">
        {plugin.permissions.length ? copy.denied : copy.none}
      </p>
      {plugin.permissions.map((permission) => (
        <label key={permission}>
          <input
            type="checkbox"
            checked={grants.includes(permission)}
            onChange={(event) =>
              change(
                event.target.checked
                  ? [...grants, permission]
                  : grants.filter((value) => value !== permission),
              )
            }
          />
          {copy.permission[permission]}
        </label>
      ))}
      {plugin.networkOrigins.length > 0 && (
        <div className="plugin-origins">
          <strong>{copy.origins}</strong>
          <ul>
            {plugin.networkOrigins.map((origin) => (
              <li key={origin}>{origin}</li>
            ))}
          </ul>
        </div>
      )}
    </fieldset>
  )
}
