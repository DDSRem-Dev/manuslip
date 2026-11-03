import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Locale } from '../../shared/contracts'
import type { DocumentController } from './document'
import { i18next } from './i18n'

interface RenderStatus {
  rawHtml: boolean
  remoteImages: boolean
  imagePermissionBusy: boolean
  imageError: boolean
  info: { name: string }
}

const noDocument = createStore<RenderStatus>(() => ({
  rawHtml: false,
  remoteImages: false,
  imagePermissionBusy: false,
  imageError: false,
  info: { name: '' },
}))

export function MarkdownRenderSettings({
  document,
  locale,
}: {
  document: DocumentController | null
  locale: Locale
}): React.JSX.Element {
  // Subscribe only to scalar options; settings never retain a borrowed outline.
  const store: Pick<
    StoreApi<RenderStatus>,
    'getState' | 'getInitialState' | 'subscribe'
  > = document?.store ?? noDocument
  const rawHtml = useStore(store, (state) => state.rawHtml)
  const remoteImages = useStore(store, (state) => state.remoteImages)
  const imagePermissionBusy = useStore(store, (state) => state.imagePermissionBusy)
  const imageError = useStore(store, (state) => state.imageError)
  const name = useStore(store, (state) => state.info.name)
  const t = i18next.t.bind(i18next)
  const scope = document
    ? locale === 'zh-CN'
      ? `以下选项应用于当前文档：${name}`
      : `These options apply to the current document: ${name}`
    : locale === 'zh-CN'
      ? '打开文档后可设置 HTML 渲染和远程图片。'
      : 'Open a document to configure HTML rendering and remote images.'
  return (
    <div className="markdown-render-settings">
      <p className="preference-hint" id="markdown-render-scope">
        {scope}
      </p>
      <label className="spellcheck-preference">
        <input
          type="checkbox"
          checked={rawHtml}
          disabled={!document}
          aria-describedby="markdown-render-scope"
          onChange={(event) => {
            document?.preview.setRawHtml(event.target.checked)
            document?.reading?.refreshRendering()
          }}
        />
        {t('renderHtml')}
      </label>
      <label className="spellcheck-preference">
        <input
          type="checkbox"
          checked={remoteImages}
          disabled={!document || imagePermissionBusy}
          aria-describedby="markdown-render-scope"
          onChange={(event) => void document?.preview.setRemoteImages(event.target.checked)}
        />
        {t('remoteImages')}
      </label>
      {imageError && (
        <p className="preference-error" role="status">
          {t('imagePermissionError')}
        </p>
      )}
    </div>
  )
}
