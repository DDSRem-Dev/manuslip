import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { setImmediate as immediate } from 'node:timers/promises'
import { createServer } from 'vite'

if (!global.gc)
  throw new Error(
    'Run with node --expose-gc test/benchmark/profiles/profile-packed-native-stream.mjs',
  )
const sha = (value) => createHash('sha256').update(value).digest('hex')
await mkdir('test/artifacts/logs', { recursive: true })
const output = await mkdtemp(resolve('test/artifacts/logs/packed-native-stream-lifetime-'))
console.log(`Native stream lifetime artifacts: ${output}`)
const evaluated = new Map(),
  injected = new Map()
const MiB = 1024 * 1024
const limits = { retained: 8 * MiB, staging: 8 * MiB, nodes: 800000, depth: 128 }
const sessionLimits = { ...limits, retained: 64 * MiB, bytes: 8 * MiB, readers: 160, captures: 8 }
const key = Symbol.for('manuslip-native-stream-lifetime')
let observe
globalThis[key] = (phase, value) => observe?.(phase, value)
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  logLevel: 'silent',
  server: { middlewareMode: true, watch: null, hmr: false },
  plugins: [
    {
      name: 'observe-native-stream-lifetime',
      enforce: 'pre',
      transform(code, id) {
        const path = relative(resolve('.'), id.split('?')[0]).replaceAll('\\', '/')
        if (!path.startsWith('packages/') || !path.endsWith('.ts')) return
        const hash = sha(code),
          previous = evaluated.get(path)
        if (previous) assert.equal(previous, hash, path)
        evaluated.set(path, hash)
        const inject = (marker, phase, value) => {
          assert.equal(code.split(marker).length, 2, `Missing/ambiguous marker ${path}: ${marker}`)
          return code.replace(
            marker,
            `${marker}; globalThis[Symbol.for('manuslip-native-stream-lifetime')]?.('${phase}', ${value});`,
          )
        }
        if (path === 'packages/core/src/packing-arena.ts') {
          code = inject('    this.#index = index', 'arena', '[this, payload, index]')
        } else if (path === 'packages/core/src/packing-native-copy.ts') {
          code = inject('const frames: CopyFrame[] = []', 'frames', 'frames')
          code = inject('const values = new Array<unknown>(length)', 'array', 'values')
          code = inject('frame.object = record ?? {}', 'object', 'frame.object')
          code = inject('const buffer = PackedWordBuffer.create(length)', 'text', 'buffer')
          code = inject(
            '            } else value = scope.position(path, { retained: 272, staging: 0 })',
            'position',
            'value',
          )
        } else if (path === 'packages/core/src/packing-native-stream.ts') {
          code = inject(
            'const workspace = capture.reserveWorkspace(fixed, fixed)',
            'workspace',
            'workspace',
          )
        } else return
        injected.set(path, code)
        return { code, map: null }
      },
    },
  ],
})
try {
  const load = (name) => server.ssrLoadModule(`/packages/core/src/${name}.ts`)
  const { PackedSession } = await load('packing-session')
  const { packValue } = await load('packing')
  const { sourceHash } = await load('contracts')
  const { inspectPackedNativeStream, packedNativeStreamSteps } = await load('packing-native-stream')
  const watch = (value, refs, seen) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    refs.push(new WeakRef(value))
    for (const child of Object.values(value)) watch(child, refs, seen)
  }
  const probe = (phase, action, keepOwner, mode, records) => {
    const refs = [],
      seen = new WeakSet(),
      reached = new Set()
    let workspace
    let arrays = 0
    observe = (kind, value) => {
      reached.add(kind)
      if (kind === 'object' && Object.hasOwn(value, 'type')) reached.add('record')
      if (kind === 'array' && ++arrays >= 5) reached.add('nested')
      if (kind === 'workspace') workspace = value
      else if (kind === 'arena') for (const item of value) watch(item, refs, seen)
      else watch(value, refs, seen)
    }
    const owner = new PackedSession(sessionLimits)
    const identity = {
      generation: 1,
      revision: 0,
      documentId: 'native-stream-lifetime',
      sourceHash: sourceHash('source'),
      parserVersion: 'test',
      rendererVersion: 'test',
      options: 'test',
    }
    const body = {
      prefix: Array.from({ length: 6 }, (_, number) => ({ number })),
      text: '界😀\ud800\n'.repeat(10000),
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 4, offset: 3 },
      },
      tail: Array.from({ length: 64 }, (_, number) => ({ number })),
    }
    const value =
      phase === 'nested'
        ? [[[[body]]]]
        : ['record', 'complete', 'throw', 'expired', 'unreachable'].includes(phase)
          ? { type: 'root', children: [body], position: body.position }
          : body
    owner.commit(
      owner.prepareFull(
        owner.begin(identity, 'source'),
        identity,
        packValue([value, { other: true }], limits.staging),
      ),
    )
    const capture = owner.capture()
    refs.push(new WeakRef(capture.sourceResource))
    refs.push(new WeakRef(capture.sourceResource.identity))
    if (!keepOwner) refs.push(new WeakRef(owner))
    const items = capture.reader.elementSteps()
    const scope = items.next().value
    assert.ok(scope)
    let inspected = false
    const inspect =
      mode === 'standalone'
        ? inspectPackedNativeStream
        : (capture, ...args) => capture.work(packedNativeStreamSteps(capture, ...args))
    const work = inspect(
      capture,
      scope,
      { ...limits, nodes: phase === 'limit' ? 17 : limits.nodes },
      function* (copy, cost) {
        assert.deepEqual(copy, value)
        watch(copy, refs, seen)
        assert.equal(owner.stats.readerStagingBytes, cost.stagingBytes)
        inspected = true
        if (phase === 'throw') throw new Error('Inspector failure')
        yield
      },
      records,
    )
    try {
      if (phase === 'limit' || phase === 'throw') {
        assert.throws(
          () => {
            while (!work.next().done) {}
          },
          phase === 'limit' ? /node\/depth/ : /Inspector failure/,
        )
        assert.equal(inspected, phase === 'throw')
        assert.ok(reached.has('text'))
      } else if (phase === 'complete' || phase === 'unreachable') {
        while (!work.next().done) {}
        assert.ok(inspected)
        assert.ok(reached.has('position'))
      } else if (phase !== 'queued') {
        let steps = 0
        while (phase === 'inspect' || phase === 'expired' ? !inspected : !reached.has(phase)) {
          assert.equal(work.next().done, false)
          assert.ok(++steps < 100000)
        }
      }
      if (phase === 'expired') {
        items.next()
        assert.throws(() => work.next(), /expired/)
      } else if (action === 'return') work.return()
      else if (action === 'release') capture.release()
      else owner.dispose()
      items.return()
      assert.equal(owner.stats.readers, 0)
      assert.equal(owner.stats.readerStagingBytes, 0)
      // Even an otherwise unreachable, undisposed live owner must collect when all
      // escaped capabilities have closed. Other probes explicitly dispose it.
      if (phase !== 'unreachable') owner.dispose()
      if (phase !== 'unreachable') assert.equal(owner.stats.retainedBytes, 0)
      capture.release()
      return {
        work,
        capture,
        items,
        scope,
        workspace,
        owner: keepOwner ? owner : undefined,
        refs,
        report: {
          phase,
          action,
          keepOwner,
          mode,
          records,
          references: refs.length,
          reached: [...reached],
        },
      }
    } finally {
      observe = undefined
    }
  }
  const cases = ['queued', 'array', 'text', 'inspect', 'nested', 'record'].flatMap((phase) =>
    ['return', 'release', 'dispose'].map((action) => [phase, action]),
  )
  cases.push(...['complete', 'limit', 'throw', 'expired'].map((phase) => [phase, 'return']))
  const escaped = [false, true].flatMap((records) =>
    cases.flatMap(([phase, action]) =>
      [false, true].flatMap((keep) =>
        ['standalone', 'parent-owned'].map((mode) => probe(phase, action, keep, mode, records)),
      ),
    ),
  )
  // Complete a copy, then close all handles while retaining neither a disposed nor
  // externally live owner. The held closed workspace must not keep its session alive.
  for (const records of [false, true])
    for (const mode of ['standalone', 'parent-owned'])
      escaped.push(probe('unreachable', 'return', false, mode, records))
  assert.equal(escaped.length, 180)
  let collected = false
  for (let attempt = 0; attempt < 40; attempt++) {
    await immediate()
    global.gc()
    await immediate()
    if (escaped.every((entry) => entry.refs.every((ref) => !ref.deref()))) {
      collected = true
      break
    }
  }
  if (!collected)
    console.log(
      'Uncollected:',
      escaped.filter((entry) => entry.refs.some((ref) => ref.deref())).map((entry) => entry.report),
    )
  assert.ok(
    collected,
    'Closed work/workspace/scope handles must release actual native copies and owners',
  )
  for (const entry of escaped) {
    assert.equal(entry.work.next().done, true)
    if (entry.workspace) assert.throws(() => entry.workspace.resize(0, 0), /released/)
  }
  const sources = []
  for (const [path, hash] of evaluated) {
    const body = await readFile(path)
    assert.equal(sha(body), hash, path)
    const target = resolve(output, path.replaceAll('/', '__'))
    await writeFile(target, body)
    const code = injected.get(path)
    let injection
    if (code) {
      const target = resolve(output, `injected-${path.replaceAll('/', '__')}`)
      await writeFile(target, code)
      injection = { target, sha256: sha(code) }
    }
    sources.push({ path, target, sha256: hash, injection })
  }
  const driver = await readFile(new URL(import.meta.url))
  await writeFile(resolve(output, 'driver.mjs'), driver)
  const result = {
    status: 'verified',
    date: new Date().toISOString(),
    collected,
    driverSha256: sha(driver),
    sources,
    probes: escaped.map((entry) => entry.report),
    witnesses: escaped.reduce((sum, entry) => sum + entry.refs.length, 0),
    survivorsBeforeResume: 0,
    method:
      'Development Vite instrumentation watches actual copy frame stacks, partial/complete native arrays, objects, admitted common record literals, positions, text collectors, source resources and normalized identities, arenas, transferred buffers and indexes. One hundred eighty probes cover ordinary readers and guarded record reads, both independently registered work and internal generator composition under a capture-owned parent. Closed work/workspace/item/scope/capture handles stay held and unadvanced throughout forced GC. Includes cancellation with five nested native arrays open, common-record allocation checkpoints, inspector exceptions, node-limit failure, stale parent scopes and an otherwise unreachable undisposed session. Evaluated original sources, three injected bodies and the exact driver are archived with hashes. This proves reachability cleanup, not physical heap calibration or packaged performance.',
  }
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(
    JSON.stringify({ ...result, sources: sources.length, probes: escaped.length, output }),
  )
} finally {
  delete globalThis[key]
  await server.close()
}
