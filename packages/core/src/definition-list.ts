import { defListFromMarkdown } from 'mdast-util-definition-list'
import { defList } from 'micromark-extension-definition-list'
import type { Plugin } from 'unified'

export const remarkDefinitionList: Plugin = function () {
  const data = this.data()
  data.micromarkExtensions ??= []
  data.fromMarkdownExtensions ??= []
  data.micromarkExtensions.push(defList)
  data.fromMarkdownExtensions.push(defListFromMarkdown)
}
