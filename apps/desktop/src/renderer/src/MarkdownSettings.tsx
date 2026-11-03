import { defaultMarkdownPlugins, markdownPluginNames } from '@manuslip/core/conventions'
import type { Locale, Settings } from '../../shared/contracts'
import type { DocumentController } from './document'
import { MarkdownRenderSettings } from './MarkdownRenderSettings'

const labels = {
  opt: 'Opt',
  latex: 'LaTeX',
  mermaid: 'Mermaid',
  github: 'GitHub',
  typora: 'Typora',
}
const copy = {
  en: {
    title: 'Markdown extensions',
    base: 'CommonMark · Tables · Tasks · Footnotes · Smart punctuation · Heading attributes · Superscript · Subscript',
    hint: 'Applies to preview, new reading copies and export.',
    opt: 'Highlight · Strikethrough',
    latex: 'Inline & display math · Matrices · Chemistry',
    mermaid: 'Diagrams',
    github: 'Autolinks · Callouts',
    typora: 'Front matter · Table of contents',
    reset: 'Reset extensions',
  },
  'zh-CN': {
    title: 'Markdown 扩展',
    base: 'CommonMark · 表格 · 任务列表 · 脚注 · 智能标点 · 标题属性 · 上标 · 下标',
    hint: '应用于预览、新阅读副本与导出。',
    opt: '高亮 · 删除线',
    latex: '行内与独立公式 · 矩阵 · 化学式',
    mermaid: '图表',
    github: '网址自动链接 · 提示块',
    typora: '前置元数据 · 目录',
    reset: '重置扩展',
  },
} as const

export function MarkdownSettings({
  settings,
  locale,
  disabled,
  update,
  document,
}: {
  settings: Settings
  locale: Locale
  disabled: boolean
  update(patch: Partial<Settings>): Promise<void>
  document: DocumentController | null
}): React.JSX.Element {
  const text = copy[locale]
  const plugins = settings.markdown ?? defaultMarkdownPlugins
  return (
    <fieldset className="preference-group markdown-settings">
      <legend>{text.title}</legend>
      <p className="preference-hint">{text.base}</p>
      {markdownPluginNames.map((name) => (
        <div className="markdown-plugin" key={name}>
          <label className="spellcheck-preference">
            <input
              type="checkbox"
              checked={plugins[name]}
              disabled={disabled}
              aria-describedby={`markdown-${name}-hint`}
              onChange={(event) =>
                void update({ markdown: { ...plugins, [name]: event.target.checked } })
              }
            />
            {labels[name]}
          </label>
          <p className="preference-hint" id={`markdown-${name}-hint`}>
            {text[name]}
          </p>
        </div>
      ))}
      <p className="preference-hint">{text.hint}</p>
      <button
        type="button"
        disabled={disabled}
        onClick={() => void update({ markdown: { ...defaultMarkdownPlugins } })}
      >
        {text.reset}
      </button>
      <MarkdownRenderSettings document={document} locale={locale} />
    </fieldset>
  )
}
