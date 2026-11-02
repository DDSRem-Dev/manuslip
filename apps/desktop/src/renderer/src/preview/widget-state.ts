export type WidgetState = 'loading' | 'ready' | 'error' | 'limited' | 'blocked'

/** Shared visual and accessibility state for asynchronous preview content. */
export function setWidgetState(element: HTMLElement, state: WidgetState): void {
  element.dataset.renderState = state
  if (state === 'loading') element.setAttribute('aria-busy', 'true')
  else element.removeAttribute('aria-busy')
}
