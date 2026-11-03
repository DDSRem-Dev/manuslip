import type { Result } from '../../../shared/contracts'
import { i18next } from '../i18n'
import type { WidgetBorrow } from './widget-borrow'
import { setWidgetState, type WidgetState } from './widget-state'

export function renderImageWidget(
  image: HTMLImageElement,
  signal: AbortSignal,
  measure: () => void,
  loadRemote?: (url: string) => Promise<Result<string>>,
  loadLocal?: (url: string) => Promise<Result<string>>,
  borrow?: WidgetBorrow,
): void {
  const local = image.getAttribute('data-local-image')
  const remote = image.getAttribute('data-remote-image')
  const reference = local || remote
  const loader = local ? loadLocal : loadRemote
  const source = image.getAttribute('src')
  const canRetry = Boolean((reference && loader) || source)
  const name = image.alt || i18next.t('image')
  const frame = document.createElement('span')
  frame.className = 'cm-image'
  const placeholder = document.createElement('span')
  placeholder.className = 'cm-image-placeholder'
  placeholder.setAttribute('role', 'img')
  placeholder.setAttribute('aria-label', name)
  const icon = document.createElement('span')
  icon.className = 'markdown-icon markdown-icon-image'
  icon.setAttribute('aria-hidden', 'true')
  const label = document.createElement('span')
  label.className = 'cm-image-alt'
  label.textContent = name
  placeholder.append(icon, label)
  const message = document.createElement('span')
  message.className = 'cm-live-render-error cm-live-image-error'
  message.id = `image-state-${crypto.randomUUID()}`
  message.setAttribute('role', 'status')
  placeholder.setAttribute('aria-describedby', message.id)
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.className = 'cm-live-image-retry'
  retry.textContent = i18next.t('retryImage', { alt: name })
  retry.hidden = true
  image.before(frame)
  frame.append(image, placeholder, message, retry)
  // These images already belong to a virtualized viewport. Hidden loading images
  // must load eagerly, or browser lazy loading can wait on their own placeholder.
  image.loading = 'eager'
  image.decoding = 'async'
  let pending = false
  let attempt = 0
  const state = (value: WidgetState, text = ''): void => {
    if (signal.aborted) return
    setWidgetState(frame, value)
    setWidgetState(image, value)
    image.hidden = value !== 'ready'
    placeholder.hidden = value === 'ready'
    message.hidden = value === 'ready'
    message.textContent = text
    retry.hidden = value !== 'error' || !canRetry
    retry.disabled = value === 'loading'
    icon.className = `markdown-icon markdown-icon-${value === 'error' ? 'imageError' : 'image'}`
    measure()
  }
  const failed = (code?: string): void => {
    const key =
      code === 'file-missing'
        ? 'imageMissing'
        : code === 'file-permission'
          ? 'imageUnreadable'
          : code === 'workspace-link'
            ? 'imageLinked'
            : code
    state('error', key && i18next.exists(key) ? i18next.t(key) : i18next.t('imageLoadError'))
  }
  const loaded = (): void => {
    if (!pending && image.naturalWidth > 0) state('ready')
  }
  image.addEventListener('load', loaded, { signal })
  image.addEventListener(
    'error',
    () => {
      if (!pending) failed()
    },
    { signal },
  )
  const load = (): void => {
    if (signal.aborted) return
    const current = ++attempt
    pending = true
    state('loading', i18next.t('imageLoading'))
    image.removeAttribute('src')
    const install = (url: string): void => {
      if (signal.aborted || current !== attempt) return
      pending = false
      image.src = url
      if (image.complete && image.naturalWidth > 0) loaded()
    }
    if (reference && loader) {
      let lease: WidgetBorrow | undefined
      let work: Promise<Result<string>>
      try {
        lease = borrow?.retain()
        work = loader(reference)
      } catch {
        pending = false
        lease?.release()
        failed()
        return
      }
      void work
        .then((result) => {
          if (signal.aborted || current !== attempt) return
          if (result.ok) install(result.value)
          else {
            pending = false
            failed(result.code)
          }
        })
        .catch(() => {
          if (current !== attempt) return
          pending = false
          failed()
        })
        .finally(() => lease?.release())
    } else if (source) install(source)
    else {
      pending = false
      failed('imageLinkError')
    }
  }
  retry.addEventListener(
    'click',
    (event) => {
      event.stopPropagation()
      load()
    },
    { signal },
  )
  if (reference && !loader)
    state('blocked', i18next.t(remote ? 'imageRemoteBlocked' : 'imageLocalBlocked'))
  else if (reference) load()
  else if (!source) failed('imageLinkError')
  else if (image.complete) {
    if (image.naturalWidth > 0) loaded()
    else failed()
  } else state('loading', i18next.t('imageLoading'))
}
