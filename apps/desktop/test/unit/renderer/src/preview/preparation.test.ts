import { parseDocumentMarkdown } from '@manuslip/core'
import { OccurrenceTracker, Text } from '@manuslip/editor'
import { renderMarkdown } from '@manuslip/renderer'
import { expect, it } from 'vitest'
import { preparePreview } from '../../../../../src/renderer/src/preview/preparation'

it('distinguishes a displayed inline-note destination from its source and each return reference', () => {
  const source = '# Start\n\nInline^[Body] and named[^n].\n\n- Again[^n].\n\n[^n]: Named body.'
  const document = parseDocumentMarkdown(source)
  const projection = renderMarkdown(document.root, {
    rawHtml: false,
    footnotesLabel: 'Footnotes',
    footnoteBackLabel: 'Back',
  })
  const work = preparePreview(
    { document, projection },
    Text.of(source.split('\n')),
    new OccurrenceTracker(),
  )
  let step = work.next()
  while (!step.done) step = work.next()
  const anchors = step.value.model.anchors
  expect(anchors?.find((anchor) => anchor.id === 'user-content-fn-inline-note-1')).toEqual({
    id: 'user-content-fn-inline-note-1',
    from: source.indexOf('^[Body]') + 1,
    rendered: true,
    placement: 'after-document',
  })
  for (const [id, from] of [
    ['user-content-fnref-inline-note-1', source.indexOf('^[Body]')],
    ['user-content-fnref-n', source.indexOf('[^n]')],
    ['user-content-fnref-n-2', source.indexOf('[^n]', source.indexOf('[^n]') + 1)],
    ['user-content-fn-n', source.indexOf('[^n]:')],
  ] as const)
    expect(anchors?.find((anchor) => anchor.id === id)).toEqual({ id, from, rendered: true })
  expect(anchors?.find((anchor) => anchor.id === 'start')).toEqual({ id: 'start', from: 0 })
})

it('keeps return references inside an inline-note body at the rendered document footer', () => {
  const source = 'Main^[Outer with named[^n].].\n\n[^n]: Named'
  const document = parseDocumentMarkdown(source)
  const projection = renderMarkdown(document.root, {
    rawHtml: false,
    footnotesLabel: 'Footnotes',
    footnoteBackLabel: 'Back',
  })
  const work = preparePreview(
    { document, projection },
    Text.of(source.split('\n')),
    new OccurrenceTracker(),
  )
  let step = work.next()
  while (!step.done) step = work.next()
  expect(step.value.model.anchors?.find((anchor) => anchor.id === 'user-content-fnref-n')).toEqual({
    id: 'user-content-fnref-n',
    from: source.indexOf('[^n]'),
    rendered: true,
    placement: 'after-document',
  })
})
