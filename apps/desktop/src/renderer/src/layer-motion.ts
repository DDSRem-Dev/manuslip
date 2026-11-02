/** Freeze the input method for each layer transition, including native light dismissal. */
export function trackLayerMotion(target: Window): () => void {
  const root = target.document.documentElement
  const method = (value: string): void => {
    if (root.dataset.inputMethod !== value) root.dataset.inputMethod = value
  }
  const pointer = (): void => {
    method('pointer')
  }
  const keyboard = (): void => {
    method('keyboard')
  }
  const toggle = (event: Event): void => {
    const layer = event.target
    if (!(layer instanceof HTMLElement) || !layer.matches('dialog, .toolbar-popover')) return
    const opening = (event as ToggleEvent).newState === 'open'
    layer.dataset.inputMethod = root.dataset.inputMethod ?? 'keyboard'
    // A closing layer may stay painted for its exit but must stop accepting input now.
    layer.inert = !opening
  }
  target.addEventListener('pointerdown', pointer, true)
  target.addEventListener('keydown', keyboard, true)
  target.document.addEventListener('beforetoggle', toggle, true)
  return () => {
    target.removeEventListener('pointerdown', pointer, true)
    target.removeEventListener('keydown', keyboard, true)
    target.document.removeEventListener('beforetoggle', toggle, true)
  }
}
