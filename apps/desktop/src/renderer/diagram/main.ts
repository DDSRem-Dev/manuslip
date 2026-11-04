import { utf8Bytes } from '@manuslip/core/text'
import { checkDiagramSource, type DiagramRequest, diagramLimits } from '@manuslip/renderer/diagram'
import { legacyDiagramToMermaid } from '@manuslip/renderer/legacy-diagram'
import { createSanitizer } from '@manuslip/renderer/sanitize'
import type { DiagramHostResult } from '../../shared/diagram-contracts'
import { flattenDiagram } from './svg'
import '../fonts.css'

declare global {
  interface Window {
    manuslipDiagramHost: {
      ready(): void
      onJob(listener: (request: DiagramRequest) => void): () => void
      result(result: DiagramHostResult): void
    }
  }
}
const sanitizer = createSanitizer(window)
window.manuslipDiagramHost.onJob((request) => {
  void (async () => {
    try {
      checkDiagramSource(request.source)
      const source = legacyDiagramToMermaid(request.source, request.syntax ?? 'mermaid')
      // Layout must measure the same Chinese glyphs that preview and export display.
      await document.fonts.load('400 16px "Manuslip CJK"', request.source)
      const { default: mermaid } = await import('mermaid')
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        maxTextSize: diagramLimits.source,
        maxEdges: diagramLimits.edges,
        htmlLabels: false,
        fontFamily: '"Manuslip CJK", "trebuchet ms", verdana, arial, sans-serif',
        theme: request.theme === 'dark' ? 'dark' : 'default',
        look: 'classic',
        layout: 'dagre',
        deterministicIds: true,
        deterministicIDSeed: request.jobId,
        flowchart: { htmlLabels: false },
        secure: [
          'secure',
          'securityLevel',
          'startOnLoad',
          'maxTextSize',
          'maxEdges',
          'htmlLabels',
          'suppressErrorRendering',
          'theme',
          'themeCSS',
          'themeVariables',
          'layout',
          'look',
          'flowchart',
          'fontFamily',
        ],
      })
      const diagram = await mermaid.mermaidAPI.getDiagramFromText(source)
      const renderId = `diagram-${request.jobId}`
      // Mermaid diagram databases expose different collections; bound known node sets before layout.
      const db = diagram.db as Record<string, unknown>
      const sourceNodes = new Map<string, string>()
      for (const name of [
        'getVertices',
        'getActors',
        'getClasses',
        'getStates',
        'getEntities',
        'getNodes',
      ]) {
        const method = db[name]
        if (typeof method !== 'function') continue
        const nodes: unknown = method.call(db)
        const count =
          nodes instanceof Map || nodes instanceof Set
            ? nodes.size
            : Array.isArray(nodes)
              ? nodes.length
              : nodes && typeof nodes === 'object'
                ? Object.keys(nodes).length
                : 0
        if (count > diagramLimits.nodes) throw new Error('diagram-limit')
        if (name === 'getVertices' && nodes instanceof Map) {
          for (const node of nodes.values()) {
            if (node && typeof node.domId === 'string' && typeof node.id === 'string')
              sourceNodes.set(`${renderId}-${node.domId}`, node.id)
          }
        }
      }
      const { svg } = await mermaid.render(renderId, source)
      const flattened = flattenDiagram(
        svg,
        request.syntax === 'flowchart',
        request.source,
        sourceNodes,
      )
      const fragment = sanitizer.diagram(flattened)
      const root = fragment.querySelector('svg')
      if (!root) throw new Error('diagram-render')
      const safe = root.outerHTML
      if (utf8Bytes(safe) > diagramLimits.svg) throw new Error('diagram-limit')
      window.manuslipDiagramHost.result({ jobId: request.jobId, svg: safe })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      window.manuslipDiagramHost.result({
        jobId: request.jobId,
        error:
          message === 'diagram-limit' ||
          message === 'diagram-config' ||
          message === 'diagram-unsupported'
            ? message
            : 'diagram-render',
      })
    } finally {
      document.querySelector('#diagrams')?.replaceChildren()
    }
  })()
})
window.manuslipDiagramHost.ready()
