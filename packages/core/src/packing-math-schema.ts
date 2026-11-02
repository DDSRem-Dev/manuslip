import type { PackedReadScope } from './packing-capture'
import type { ScalarLimits } from './packing-text'
import {
  equalPackedText,
  invalidPackedSemantic,
  packedKeys,
  packedSmall,
  packedString,
} from './packing-validation-read'
import type { PackedPath } from './packing-view'

function exact(scope: PackedReadScope, path: PackedPath, expected: string) {
  if (packedSmall(scope, path) !== expected) invalidPackedSemantic()
}
/** A tiny result can retain a very long base prefix. Never select its item by a synchronous
 * numeric path; keep its owning cursor alive throughout the nested check instead.
 */
function* onlyChild(
  scope: PackedReadScope,
  path: PackedPath,
  visit: (child: PackedReadScope) => Generator<void>,
): Generator<void> {
  if (scope.kind(path) !== 'array' || scope.length(path) !== 1) invalidPackedSemantic()
  let seen = false
  for (const child of scope.elementSteps(path)) {
    if (child === undefined) yield
    else {
      if (seen) invalidPackedSemantic()
      seen = true
      yield* visit(child)
    }
  }
  if (!seen) invalidPackedSemantic()
}
function* classes(scope: PackedReadScope, path: PackedPath, display: boolean): Generator<void> {
  packedKeys(scope, path, ['className'])
  const selected = scope.at(path)
  if (selected.kind(['className']) !== 'array' || selected.length(['className']) !== 2)
    invalidPackedSemantic()
  let index = 0
  for (const item of selected.elementSteps(['className'])) {
    if (item !== undefined) {
      if (index >= 2) invalidPackedSemantic()
      exact(item, [], index++ === 0 ? 'language-math' : display ? 'math-display' : 'math-inline')
    }
    yield
  }
  if (index !== 2) invalidPackedSemantic()
}

/** The exact pinned remark-math data schema, with progress through every nested array. */
export function* validateMathData(
  scope: PackedReadScope,
  path: PackedPath,
  display: boolean,
  budget: ScalarLimits,
): Generator<void> {
  const data = scope.at(path)
  packedKeys(data, [], display ? ['hName', 'hChildren'] : ['hName', 'hProperties', 'hChildren'])
  exact(data, ['hName'], display ? 'pre' : 'code')
  const text = function* (node: PackedReadScope): Generator<void> {
    packedKeys(node, [], ['type', 'value'])
    exact(node, ['type'], 'text')
    packedString(node, ['value'], scope.textLength(['value']))
    yield* equalPackedText(scope, ['value'], ['value'], budget, node)
  }
  if (display)
    yield* onlyChild(data, ['hChildren'], function* (code) {
      packedKeys(code, [], ['type', 'tagName', 'properties', 'children'])
      exact(code, ['type'], 'element')
      exact(code, ['tagName'], 'code')
      yield* classes(code, ['properties'], true)
      yield* onlyChild(code, ['children'], text)
    })
  else {
    yield* classes(data, ['hProperties'], false)
    yield* onlyChild(data, ['hChildren'], text)
  }
}
