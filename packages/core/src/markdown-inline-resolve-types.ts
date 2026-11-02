import type { Construct, Event, Resolver, TokenizeContext } from 'micromark-util-types'

export type InlineResolverKind = 'attention' | 'strikethrough' | 'labelEnd' | 'labelCleanup'
export interface InlineResolveRequest {
  input: Event[]
  resolver?: Resolver
  constructs?: readonly Pick<Construct, 'resolveAll'>[]
}
export type InlineResolveCoroutine = Generator<
  // biome-ignore lint/suspicious/noConfusingVoidType: Event-buffer generators yield void pauses.
  void | InlineResolveRequest,
  Event[],
  Event[] | undefined
>
export interface InlineResolveFrame {
  input: Event[] | undefined
  context: TokenizeContext | undefined
  resolver: Resolver | undefined
  constructs: readonly Pick<Construct, 'resolveAll'>[] | undefined
  work: InlineResolveCoroutine | undefined
  complete: boolean
}
