import { defaultMarkdownPlugins, markdownPluginNames } from '@manuslip/core/conventions'
import type { Locale, Settings } from '../../shared/contracts'

const labels = {
  opt: 'Opt',
  latex: 'LaTeX',
  mermaid: 'Mermaid',
  github: 'GitHub',
  typora: 'Typora',
}
const copy = {
  en: {
    title: 'Markdown conventions',
    base: 'CommonMark with tables, fenced code, footnotes, strikethrough, task lists, smart punctuation, heading attributes, superscript and subscript.',
    hint: 'Changes save automatically and apply to preview, new reading copies and export.',
    opt: 'Highlight with ==text==. Strikethrough with ~~text~~ is always available.',
    latex: 'Inline and display formulas, aligned equations, matrices and chemistry.',
    mermaid: 'Render fenced diagrams with Mermaid.',
    github: 'Autolink bare URLs and render Note, Tip, Important, Warning and Caution callouts.',
    typora: 'Recognize YAML front matter and generate a linked table of contents from [TOC].',
    reset: 'Reset Markdown plugins',
  },
  'zh-CN': {
    title: 'Markdown 约定',
    base: 'CommonMark 及表格、围栏代码块、脚注、删除线、任务列表、智能标点、标题属性、上标与下标。',
    hint: '更改会自动保存，并应用于预览、新建阅读副本和导出。',
    opt: '使用 ==文本== 高亮。~~文本~~ 删除线始终可用。',
    latex: '行内与独立公式、对齐方程、矩阵和化学式。',
    mermaid: '使用 Mermaid 渲染围栏图表。',
    github: '自动链接网址，并渲染 Note、Tip、Important、Warning 和 Caution 提示块。',
    typora: '识别 YAML 前置元数据，并使用 [TOC] 生成带链接的目录。',
    reset: '重置 Markdown 插件',
  },
} as const

export function MarkdownSettings({
  settings,
  locale,
  disabled,
  update,
}: {
  settings: Settings
  locale: Locale
  disabled: boolean
  update(patch: Partial<Settings>): Promise<void>
}): React.JSX.Element {
  const text = copy[locale]
  const plugins = settings.markdown ?? defaultMarkdownPlugins
  return (
    <fieldset className="preference-group markdown-settings" disabled={disabled}>
      <legend>{text.title}</legend>
      <p className="preference-hint">{text.base}</p>
      {markdownPluginNames.map((name) => (
        <div className="markdown-plugin" key={name}>
          <label className="spellcheck-preference">
            <input
              type="checkbox"
              checked={plugins[name]}
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
        onClick={() => void update({ markdown: { ...defaultMarkdownPlugins } })}
      >
        {text.reset}
      </button>
    </fieldset>
  )
}
