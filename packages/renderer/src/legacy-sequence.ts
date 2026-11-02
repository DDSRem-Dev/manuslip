import { diagramLimits } from './diagram'
import {
  legacyActor,
  legacyActors,
  legacyLabel,
  legacySourceLines,
  MermaidLines,
  unsupportedLegacy,
} from './legacy-labels'

const arrows: Readonly<Record<string, string>> = {
  '->': '->>',
  '-->': '-->>',
  '->>': '->',
  '-->>': '-->',
}

export function legacySequence(source: string): string {
  const names = new Map<string, string>(),
    labels = new Map<string, string>(),
    statements: string[] = []
  let title: string | undefined,
    started = false
  const actor = (raw: string): string => {
    const name = legacyActor(raw),
      known = names.get(name)
    if (known) return known
    if (labels.size >= diagramLimits.nodes) throw new Error('diagram-limit')
    const id = `P${labels.size}`
    names.set(name, id)
    labels.set(id, name)
    return id
  }
  for (const line of legacySourceLines(source)) {
    const participant = /^participant\s+(.+)$/i.exec(line)
    if (participant) {
      if (started) unsupportedLegacy()
      const alias = /^(.+?)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(participant[1] ?? '')
      const id = actor(alias?.[1] ?? participant[1] ?? '')
      if (alias?.[2]) {
        const previous = names.get(alias[2])
        if (previous && previous !== id) unsupportedLegacy()
        names.set(alias[2], id)
      }
      continue
    }
    const heading = /^title\s*:\s*(.+)$/i.exec(line)
    if (heading) {
      if (title !== undefined) unsupportedLegacy()
      title = legacyLabel(heading[1] ?? '')
      continue
    }
    started = true
    if (statements.length >= diagramLimits.edges) throw new Error('diagram-limit')
    const note = /^note\s+(left of|right of|over)\s+((?:"[^"]*"|[^:"])+)\s*:\s*(.*)$/i.exec(line)
    if (note) {
      const targets = legacyActors(note[2] ?? '').map((value) => actor(value))
      const placement = (note[1] ?? '').toLowerCase()
      if (targets.length < 1 || targets.length > (placement === 'over' ? 2 : 1)) unsupportedLegacy()
      statements.push(`Note ${placement} ${targets.join(',')}: ${legacyLabel(note[3] ?? '')}`)
      continue
    }
    const signal =
      /^("[^"]+"|[^>:,"\r\n-]+?)\s*(-->>|-->|->>|->)\s*("[^"]+"|[^>:,"\r\n-]+?)\s*:\s*(.*)$/.exec(
        line,
      )
    if (!signal) unsupportedLegacy()
    const from = actor(signal[1] ?? ''),
      to = actor(signal[3] ?? ''),
      arrow = arrows[signal[2] ?? '']
    if (!arrow) unsupportedLegacy()
    statements.push(`${from}${arrow}${to}: ${legacyLabel(signal[4] ?? '')}`)
  }
  if (!labels.size) unsupportedLegacy()
  const output = new MermaidLines('sequenceDiagram')
  if (title) output.add(`title ${title}`)
  for (const [id, name] of labels) output.add(`participant ${id} as ${legacyLabel(name)}`)
  for (const statement of statements) output.add(statement)
  return output.text()
}
