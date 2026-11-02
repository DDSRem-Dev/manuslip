import type { Page } from '@playwright/test'

export async function instrumentInput(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.addEventListener(
      'keydown',
      (event) => {
        if (!(event.target instanceof Element) || !event.target.closest('.cm-content')) return
        const start = performance.now()
        const mode = (event.ctrlKey || event.metaKey) && ['1', '2'].includes(event.key)
        if (mode) {
          const label = event.key === '1' ? 'Source' : 'Live Preview'
          const frame = (): void => {
            const selected = [...document.querySelectorAll('button')].some(
              (button) =>
                button.textContent === label && button.getAttribute('aria-pressed') === 'true',
            )
            if (!selected && performance.now() - start < 5000) {
              requestAnimationFrame(frame)
              return
            }
            if (!selected) return
            requestAnimationFrame(() =>
              performance.measure('manuslip:benchmark-mode-paint', {
                start,
                end: performance.now(),
              }),
            )
          }
          requestAnimationFrame(frame)
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              performance.measure('manuslip:benchmark-input-paint', {
                start,
                end: performance.now(),
              }),
            ),
          )
        }
      },
      true,
    )
  })
}
