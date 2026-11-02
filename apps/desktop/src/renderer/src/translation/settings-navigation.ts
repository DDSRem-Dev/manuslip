import { type Ref, useImperativeHandle, useLayoutEffect, useRef } from 'react'

export type TranslationSettingsTarget = 'provider' | 'key' | 'languages'
export type ConfigureTranslation = (
  target?: TranslationSettingsTarget,
  afterClose?: () => void,
) => void
export interface TranslationSettingsHandle {
  reveal(target: TranslationSettingsTarget): void
  conceal(): void
}

/** Reveal only after the containing dialog opens, then focus once fields are ready. */
export function useTranslationSettingsNavigation(
  handle: Ref<TranslationSettingsHandle> | undefined,
  id: string,
  open: boolean,
  ready: boolean,
  setOpen: (open: boolean) => void,
) {
  const details = useRef<HTMLDetailsElement>(null)
  const requested = useRef<TranslationSettingsTarget | null>(null)
  const focusRequested = () => {
    const root = details.current
    const summary = root?.querySelector('summary')
    const target = requested.current
    if (!root || !summary || !target) return
    // Loading must not take focus back after the reader moves elsewhere.
    if (document.activeElement !== summary) {
      requested.current = null
      return
    }
    const name = target === 'languages' ? 'targetLanguage' : target
    const field =
      target === 'key'
        ? root.querySelector<HTMLElement>('[data-translation-key]')
        : root.querySelector<HTMLElement>(`#${CSS.escape(`${id}-${name}`)}`)
    if (field && !field.matches(':disabled')) {
      requested.current = null
      field.focus()
      field.scrollIntoView({ block: 'nearest' })
    }
  }
  useImperativeHandle(handle, () => ({
    conceal() {
      requested.current = null
      if (details.current) details.current.open = false
      setOpen(false)
    },
    reveal(target) {
      const root = details.current
      if (!root) return
      requested.current = target
      root.open = true
      root.querySelector('summary')?.focus()
      setOpen(true)
      if (open && ready) focusRequested()
    },
  }))
  useLayoutEffect(() => {
    if (!open) requested.current = null
    else if (ready) focusRequested()
  })
  return details
}
