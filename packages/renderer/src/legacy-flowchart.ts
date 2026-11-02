import { diagramLimits } from './diagram'
import { legacyLabel, legacySourceLines, MermaidLines, unsupportedLegacy } from './legacy-labels'

type Shape =
  | 'start'
  | 'end'
  | 'operation'
  | 'inputoutput'
  | 'input'
  | 'output'
  | 'subroutine'
  | 'condition'
interface FlowNode {
  id: string
  shape: Shape
  label: string
}
const shapes = new Set([
  'start',
  'end',
  'operation',
  'inputoutput',
  'input',
  'output',
  'subroutine',
  'condition',
])
const syntax = /=>|->|:>|\||@>|:\$/

export function legacyFlowchart(source: string): string {
  const nodes = new Map<string, FlowNode>(),
    connections: string[] = []
  let last: FlowNode | undefined,
    connecting = false
  for (const line of legacySourceLines(source)) {
    const declaration = /^([A-Za-z_][A-Za-z0-9_]*)\s*=>\s*([A-Za-z]+)(?:\s*:\s*(.*))?$/.exec(line)
    if (declaration) {
      const name = declaration[1] ?? '',
        shape = (declaration[2] ?? '').toLowerCase()
      if (connecting || nodes.has(name) || !shapes.has(shape)) unsupportedLegacy()
      if (nodes.size >= diagramLimits.nodes) throw new Error('diagram-limit')
      const label = declaration[3] ?? (shape === 'start' ? 'Start' : shape === 'end' ? 'End' : '')
      if (!label || syntax.test(label)) unsupportedLegacy()
      last = { id: `N${nodes.size}`, shape: shape as Shape, label }
      nodes.set(name, last)
    } else if (line.includes('->')) {
      connecting = true
      connections.push(line)
    } else {
      // Flowchart.js permits multiline node text before the connection section.
      if (
        connecting ||
        !last ||
        syntax.test(line) ||
        /^(?:%%|click\b|style\b|classDef\b|class\b|linkStyle\b|direction\b|subgraph\b)/i.test(line)
      )
        unsupportedLegacy()
      last.label += `\\n${line}`
    }
  }
  if (!nodes.size) unsupportedLegacy()
  const output = new MermaidLines('flowchart TD')
  for (const node of nodes.values()) {
    const label = `"${legacyLabel(node.label)}"`
    const shape =
      node.shape === 'start' || node.shape === 'end'
        ? `([${label}])`
        : node.shape === 'condition'
          ? `{${label}}`
          : node.shape === 'subroutine'
            ? `[[${label}]]`
            : ['inputoutput', 'input', 'output'].includes(node.shape)
              ? `[/${label}/]`
              : `[${label}]`
    output.add(`${node.id}${shape}`)
  }
  let edges = 0
  for (const connection of connections) {
    const parts = connection.split('->').map((part) => {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)(?:\((yes|no)\))?\s*$/i.exec(part)
      if (!match) unsupportedLegacy()
      const node = nodes.get(match[1] ?? '')
      if (!node) unsupportedLegacy()
      return { node, branch: match[2]?.toLowerCase() }
    })
    if (parts.at(-1)?.branch) unsupportedLegacy()
    for (let index = 1; index < parts.length; index++) {
      if (++edges > diagramLimits.edges) throw new Error('diagram-limit')
      const from = parts[index - 1],
        to = parts[index]
      if (
        !from ||
        !to ||
        from.node.shape === 'end' ||
        (from.node.shape === 'condition') !== Boolean(from.branch)
      )
        unsupportedLegacy()
      output.add(`${from.node.id} -->${from.branch ? `|${from.branch}|` : ''} ${to.node.id}`)
    }
  }
  return output.text()
}
