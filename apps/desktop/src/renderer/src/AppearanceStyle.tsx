import { typographyCss } from '@manuslip/renderer/typography'
import { useLayoutEffect } from 'react'
import { useStore } from 'zustand'
import type { DocumentAppearance } from './appearance'
import type { DocumentController } from './document'

export function AppearanceStyle({
  controller,
  document,
  path,
}: {
  controller: DocumentAppearance
  document: DocumentController
  path: string | null
}): React.JSX.Element {
  const status = useStore(controller.store)
  const root = `[data-style-document="${document.store.getState().info.id}"]`
  const css =
    typographyCss(
      status.style.typography,
      `${root} .cm-editor .cm-content,${root} .reading-article`,
    ) +
    '\n' +
    status.style.css
  // biome-ignore lint/correctness/useExhaustiveDependencies: Save/Save As changes the main-owned persistence key without replacing this controller.
  useLayoutEffect(() => {
    void controller.load()
  }, [controller, path])
  // biome-ignore lint/correctness/useExhaustiveDependencies: CSS changes editor geometry without changing source or the controller identity.
  useLayoutEffect(() => {
    document.measureAppearance()
  }, [document, css])
  return <style>{css}</style>
}
