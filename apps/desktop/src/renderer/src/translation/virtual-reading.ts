export interface VirtualReading {
  order: readonly string[]
  reveal(id: string): boolean
}
export const virtualReadings = new WeakMap<HTMLElement, VirtualReading>()
