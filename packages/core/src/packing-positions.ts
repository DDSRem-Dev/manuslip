// Position accessors expose exact mdast values while keeping six integers in one shared
// typed table. Points are immutable temporary values, not retained per-node allocations.
const tables = new WeakMap<object, Uint32Array>()
const indexKey = Symbol('packed position index')
interface PositionView {
  [indexKey]: number
}
function coordinates(value: PositionView): Uint32Array {
  const table = tables.get(Object.getPrototypeOf(value))
  if (!table) throw new Error('Invalid packed position receiver')
  return table
}
function start(this: PositionView) {
  const table = coordinates(this)
  const index = this[indexKey]
  return Object.freeze({ line: table[index], column: table[index + 1], offset: table[index + 2] })
}
function end(this: PositionView) {
  const table = coordinates(this)
  const index = this[indexKey] + 3
  return Object.freeze({ line: table[index], column: table[index + 1], offset: table[index + 2] })
}
const descriptors = {
  start: { get: start, enumerable: true },
  end: { get: end, enumerable: true },
}
function position(this: PositionView) {
  return Object.freeze({ start: start.call(this), end: end.call(this) })
}
const positionDescriptor = { get: position, enumerable: true }

export function isPositionNode(value: object): boolean {
  return Object.hasOwn(value, indexKey) && tables.has(Object.getPrototypeOf(value))
}

export type PositionCoordinates = [number, number, number, number, number, number]

export function positionValues(
  value: object,
  admitKeys?: (keys: readonly string[]) => void,
): PositionCoordinates | null {
  const keys = Object.keys(value)
  admitKeys?.(keys)
  if (keys.length !== 2 || keys[0] !== 'start' || keys[1] !== 'end') return null
  const result: number[] = []
  for (const name of keys) {
    const point: unknown = Reflect.get(value, name)
    if (!point || typeof point !== 'object') return null
    const fields = Object.keys(point)
    admitKeys?.(fields)
    if (fields.length !== 3 || fields.join(',') !== 'line,column,offset') return null
    for (const field of fields) {
      const coordinate: unknown = Reflect.get(point, field)
      if (
        typeof coordinate !== 'number' ||
        !Number.isInteger(coordinate) ||
        coordinate < 0 ||
        coordinate > 0xffffffff
      )
        return null
      result.push(coordinate)
    }
  }
  // Two points with exactly three validated fields have populated all six slots.
  return result as PositionCoordinates
}

export class PackedPositions {
  private readonly values: Uint32Array
  private readonly prototype: object
  private used = 0
  private readonly views = new Map<number, object>()
  constructor(readonly count: number) {
    this.values = new Uint32Array(count * 6)
    this.prototype = Object.freeze(Object.create(Object.prototype))
    tables.set(this.prototype, this.values)
  }
  add(values: number[]): number {
    if (values.length !== 6 || this.used >= this.count)
      throw new Error('Invalid packed position count')
    const index = this.used++ * 6
    this.values.set(values, index)
    return index
  }
  node(): Record<string, unknown> {
    return Object.create(this.prototype)
  }
  attach(node: object, index: number): void {
    Object.defineProperty(node, indexKey, { value: index })
    Object.defineProperty(node, 'position', positionDescriptor)
  }
  hasView(index: number): boolean {
    return this.views.has(index)
  }
  materialize(index: number): object {
    const existing = this.views.get(index)
    if (existing) return existing
    const value: object = Object.create(this.prototype, descriptors)
    Object.defineProperty(value, indexKey, { value: index })
    this.views.set(index, Object.freeze(value))
    return value
  }
  get complete(): boolean {
    return this.used === this.count
  }
}
