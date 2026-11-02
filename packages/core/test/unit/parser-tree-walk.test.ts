import { CONTINUE, EXIT, SKIP, visitParents } from 'unist-util-visit-parents'
import { expect, it } from 'vitest'

interface Tree {
  type: string
  id: number
  children?: Tree[]
}
type Result = undefined | boolean | number | [boolean | 'skip', number?] | 'skip'
type Visitor = (node: Tree, parents: Tree[]) => Result
const walk = (tree: Tree, visitor: Visitor, reverse = false): void =>
  visitParents(tree, (node, parents) => visitor(node as Tree, parents as Tree[]), reverse)

/** Independent preorder oracle: preserve ancestor arrays and honor explicit sibling indices
 * after the callback has changed a parent's child array. No upstream implementation copy.
 */
function oracle(tree: Tree, visitor: Visitor, reverse = false): void {
  const step = reverse ? -1 : 1
  function descend(node: Tree, parents: Tree[]): [boolean | 'skip', number?] {
    const value = visitor(node, parents)
    const result: [boolean | 'skip', number?] = Array.isArray(value)
      ? value
      : typeof value === 'number'
        ? [true, value]
        : [value ?? true]
    if (result[0] === false) return result
    if (node.children && result[0] !== 'skip') {
      const ancestors = [...parents, node]
      let index = reverse ? node.children.length - 1 : 0
      while (index >= 0 && index < node.children.length) {
        const child = node.children[index]
        if (!child) throw new Error('Missing test child')
        const next = descend(child, ancestors)
        if (next[0] === false) return next
        index = typeof next[1] === 'number' ? next[1] : index + step
      }
    }
    return result
  }
  descend(tree, [])
}

const tree = (): Tree => ({
  type: 'root',
  id: 0,
  children: [
    {
      type: 'branch',
      id: 1,
      children: [
        { type: 'text', id: 2 },
        { type: 'text', id: 3 },
      ],
    },
    { type: 'branch', id: 4, children: [{ type: 'text', id: 5 }] },
    { type: 'text', id: 6 },
  ],
})

it('preserves forward/reverse preorder and independently retained ancestor arrays', () => {
  for (const reverse of [false, true]) {
    const root = tree()
    const calls: { id: number; parents: Tree[] }[] = []
    walk(
      root,
      (node, parents) => {
        calls.push({ id: node.id, parents })
      },
      reverse,
    )
    expect(calls.map((call) => call.id)).toEqual(
      reverse ? [0, 6, 4, 5, 1, 3, 2] : [0, 1, 2, 3, 4, 5, 6],
    )
    expect(calls.find((call) => call.id === 2)?.parents).toEqual([root, root.children?.[0]])
    expect(calls.find((call) => call.id === 5)?.parents).toEqual([root, root.children?.[1]])
    expect(calls.find((call) => call.id === 2)?.parents).not.toBe(
      calls.find((call) => call.id === 5)?.parents,
    )
    expect(calls[0]?.parents).toEqual([])
  }
})

it('matches an independent oracle for seeded trees, skip/exit and explicit sibling indices', () => {
  let seed = 0x82b659a
  const random = (size: number) => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) % size
  }
  for (let attempt = 0; attempt < 600; attempt++) {
    let id = 0
    const make = (depth: number): Tree => ({
      type: depth ? 'branch' : 'text',
      id: id++,
      ...(depth ? { children: Array.from({ length: random(6) }, () => make(depth - 1)) } : {}),
    })
    const root = make(4)
    const reverse = Boolean(random(2))
    const actions = Array.from({ length: id }, () => random(14))
    const run = (traverse: typeof walk) => {
      const seen: number[][] = []
      traverse(
        root,
        (node, parents) => {
          seen.push([...parents.map((parent) => parent.id), node.id])
          const action = actions[node.id]
          if (action === 0) return EXIT
          if (action === 1) return SKIP
          if (action === 2) return [SKIP]
          if (action === 3 || action === 4) {
            const index = parents.at(-1)?.children?.indexOf(node)
            if (index !== undefined) {
              const next = index + (reverse ? -2 : 2)
              return action === 3 ? next : [CONTINUE, next]
            }
          }
          return action === 5 ? CONTINUE : undefined
        },
        reverse,
      )
      return seen
    }
    expect(run(walk)).toEqual(run(oracle))
  }
})

it('keeps filtered visitor overloads and predicate index/parent arguments', () => {
  const root = tree()
  const seen: number[] = []
  visitParents(root, ['text', 'branch'], (node) => {
    seen.push((node as Tree).id)
  })
  expect(seen).toEqual([1, 2, 3, 4, 5, 6])
  const predicates: [number, number | undefined, number | undefined][] = []
  visitParents(
    root,
    (node, index, parent) => {
      predicates.push([(node as Tree).id, index, (parent as Tree | undefined)?.id])
      return node.type === 'text'
    },
    (node) => {
      seen.push((node as Tree).id)
    },
    true,
  )
  expect(predicates).toEqual([
    [0, undefined, undefined],
    [6, 2, 0],
    [4, 1, 0],
    [5, 0, 4],
    [1, 0, 0],
    [3, 1, 1],
    [2, 0, 1],
  ])
  expect(seen.slice(6)).toEqual([6, 5, 3, 2])
})

it('preserves insertion/removal and callback-directed sibling continuation in both directions', () => {
  for (const reverse of [false, true]) {
    const run = (traverse: typeof walk) => {
      const root = tree()
      const seen: number[] = []
      traverse(
        root,
        (node, parents) => {
          seen.push(node.id)
          const siblings = parents.at(-1)?.children
          if (siblings && node.id === 1) {
            const index = siblings.indexOf(node)
            siblings.splice(index, 1, { type: 'text', id: 7 }, { type: 'text', id: 8 })
            // Children of the removed node are still visited unless the callback skips them.
            return reverse ? index - 1 : index + 2
          }
        },
        reverse,
      )
      return { root, seen }
    }
    expect(run(walk)).toEqual(run(oracle))
  }
})

it('keeps reentrant walks isolated and propagates the original callback exception', () => {
  const outer: number[] = [],
    inner: number[] = []
  walk(tree(), (node) => {
    outer.push(node.id)
    if (node.id === 1)
      walk(
        tree(),
        (child) => {
          inner.push(child.id)
        },
        true,
      )
  })
  expect(outer).toEqual([0, 1, 2, 3, 4, 5, 6])
  expect(inner).toEqual([0, 6, 4, 5, 1, 3, 2])
  const failure = new Error('visitor failed')
  expect(() =>
    walk(tree(), (node) => {
      if (node.id === 3) throw failure
    }),
  ).toThrow(failure)
  const after: number[] = []
  walk(tree(), (node) => {
    after.push(node.id)
  })
  expect(after).toEqual(outer)
})
