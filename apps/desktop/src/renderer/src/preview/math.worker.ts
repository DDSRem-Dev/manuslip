import { semanticLimits, utf8Bytes } from '@manuslip/core'
import { renderMath } from '@manuslip/renderer/math'

self.onmessage = (event: MessageEvent<unknown>): void => {
  const request = event.data as { sequence?: unknown; tex?: unknown; display?: unknown }
  if (
    !request ||
    !Number.isSafeInteger(request.sequence) ||
    typeof request.tex !== 'string' ||
    typeof request.display !== 'boolean'
  )
    return
  try {
    if (utf8Bytes(request.tex) > semanticLimits.texBytes) throw new Error('math-limit')
    self.postMessage({ sequence: request.sequence, svg: renderMath(request.tex, request.display) })
  } catch {
    self.postMessage({ sequence: request.sequence, error: 'math-render' })
  }
}
