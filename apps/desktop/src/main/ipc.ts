import type { Result } from '../shared/contracts'
import { FileOperationError } from './files/errors'
import { isTrustedRenderer } from './security'
import { TranslationFailure } from './translation/errors'

interface InvocationContext {
  sender: unknown
  senderFrame: { url: string } | null
}
interface TrustedContext {
  sender: unknown
  mainFrame: unknown
  rendererUrl: string
}

export function createAuthorizedHandler<T>(
  trusted: () => TrustedContext | null,
  operation: (input: unknown) => Promise<T> | T,
): (event: InvocationContext, ...args: unknown[]) => Promise<Result<T>> {
  return async (event, ...args) => {
    try {
      const owner = trusted()
      if (
        !owner ||
        event.sender !== owner.sender ||
        !event.senderFrame ||
        event.senderFrame !== owner.mainFrame ||
        !isTrustedRenderer(event.senderFrame.url, owner.rendererUrl)
      ) {
        throw new Error('Unauthorized application frame')
      }
      if (args.length !== 1) throw new Error('Invalid argument count')
      return { ok: true, value: await operation(args[0]) }
    } catch (error) {
      if (error instanceof FileOperationError || error instanceof TranslationFailure)
        return { ok: false, error: error.message, code: error.code }
      return { ok: false, error: 'Unable to complete this action. Try again.' }
    }
  }
}
