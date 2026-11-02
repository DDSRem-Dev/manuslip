export function safeLink(value: string): string | null {
  if (value.startsWith('#') && ![...value].some((character) => character.charCodeAt(0) <= 32))
    return value
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

/** A relative reference only; the privileged reader must still authorize its resolved path. */
export function localImagePath(value: string): string | null {
  if (!value || value.length > 8192) return null
  try {
    const path = decodeURIComponent(value.split(/[?#]/, 1)[0] || '')
    if (
      !path ||
      /^[a-z][a-z0-9+.-]*:/i.test(path) ||
      path.startsWith('/') ||
      /[\\:]/.test(path) ||
      [...path].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    )
      return null
    return path
  } catch {
    return null
  }
}

export function safeImage(value: string): string | null {
  if (/^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]+$/i.test(value))
    return value
  try {
    const url = new URL(value)
    return url.protocol === 'manuslip-asset:' &&
      url.host === 'image' &&
      /^\/[a-f0-9-]{36}$/.test(url.pathname) &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}
