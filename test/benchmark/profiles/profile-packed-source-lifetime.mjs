import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setImmediate as immediate } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { semanticCorpus } from '../fixtures/semantic-corpus.mjs'

const sha = (value) => createHash('sha256').update(value).digest('hex')
const childIndex = process.argv.indexOf('--child')
if (childIndex < 0) {
  await mkdir('test/artifacts/logs', { recursive: true })
  const output = await mkdtemp(resolve('test/artifacts/logs/packed-source-lifetime-'))
  await copyFile(fileURLToPath(import.meta.url), resolve(output, 'driver.mjs'))
  const children = []
  for (const development of [false, true]) {
    await new Promise((accept, reject) => {
      const worker = spawn(
        process.execPath,
        [
          '--expose-gc',
          ...(development ? ['--conditions=development'] : []),
          fileURLToPath(import.meta.url),
          '--child',
          output,
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      let stdout = '',
        stderr = ''
      worker.stdout.on('data', (data) => {
        stdout += data
      })
      worker.stderr.on('data', (data) => {
        stderr += data
      })
      worker.on('error', reject)
      worker.on('exit', async (code) => {
        try {
          const log = resolve(output, `${development ? 'development' : 'production'}-child.log`)
          await writeFile(log, stdout + stderr)
          assert.equal(code, 0, `${log}\n${stderr}`)
          const path = resolve(output, `${development ? 'development' : 'production'}-report.json`)
          children.push({ path, sha256: sha(await readFile(path)) })
          accept()
        } catch (error) {
          reject(error)
        }
      })
    })
  }
  const result = {
    status: 'verified',
    output,
    method:
      'Separate production/development forced-GC diagnostics over the actual renderer port source preparation path. Hold actual scan/preparation/scheduler/controller/callback handles. Observe immutable metadata/request owners live while queued or suspended and collected after closure; verify provisional reservations and exact read boundaries. Dedicated JSON-limit cases release their owners while the held port remains alive and report a bounded recoverable error. Reachability and weighted ownership only; no physical peak or latency claim.',
    children,
  }
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result))
} else {
  assert.equal(typeof global.gc, 'function')
  const output = process.argv[childIndex + 1]
  const development = process.execArgv.includes('--conditions=development')
  const label = development ? 'development' : 'production'
  const base = `${resolve('.').replaceAll('\\', '/')}/`
  const evaluated = new Map(),
    injections = []
  const server = await createServer({
    configFile: false,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
    plugins: [
      {
        name: 'packed-source-lifetime-bindings',
        enforce: 'pre',
        async transform(code, id) {
          const full = id.replaceAll('\\', '/').split('?')[0]
          if (!full.startsWith(base)) return
          const path = full.slice(base.length)
          if (!path.endsWith('.ts') || (!path.startsWith('apps/') && !path.startsWith('packages/')))
            return
          const originalSha256 = sha(code)
          assert.equal(originalSha256, sha(await readFile(path)), path)
          evaluated.set(path, originalSha256)
          await writeFile(resolve(output, `${label}-${path.replaceAll('/', '__')}.txt`), code)
          let marker, injected
          if (path === 'packages/core/src/packing-source.ts') {
            marker = '  return Object.freeze(work) as PackedSourceWork'
            injected = `  globalThis.__manuslipSourceWork?.(work,captured)\n${marker}`
          } else if (path === 'apps/desktop/src/renderer/src/semantics/packed-port.ts') {
            marker = '      this.#work = work\n      this.#defer(work.run)\n    } catch (error) {'
            injected = `      globalThis.__manuslipSourcePortWork?.(work,prepared,input)\n${marker}`
          }
          if (marker) {
            assert.equal(code.split(marker).length, 2, marker)
            code = code.replace(marker, injected)
            const injectedPath = resolve(
              output,
              `${label}-${path.replaceAll('/', '__')}-injected.txt`,
            )
            const injectedSha256 = sha(code)
            await writeFile(injectedPath, code)
            injections.push({ path, originalSha256, injectedPath, injectedSha256 })
            code += `\n;(globalThis.__manuslipSourceInjections ??= {})[${JSON.stringify(path)}]=${JSON.stringify(injectedSha256)};\n`
          }
          return {
            code: `${code}\n;(globalThis.__manuslipSourceBindings ??= {})[${JSON.stringify(path)}]=${JSON.stringify(originalSha256)};\n`,
            map: null,
          }
        },
      },
    ],
  })
  const held = new Set(),
    observations = []
  const originalRead = String.prototype.charCodeAt
  async function collect(references) {
    for (let index = 0; index < 8; index++) {
      await immediate()
      global.gc()
    }
    return references.filter((reference) => reference.deref() !== undefined).length
  }
  try {
    const { PackedSemanticPort } = await server.ssrLoadModule(
      '/apps/desktop/src/renderer/src/semantics/packed-port.ts',
    )
    const { PackedSemanticReceiver } = await server.ssrLoadModule(
      '/apps/desktop/src/renderer/src/semantics/packed-receiver.ts',
    )
    for (const [name, body] of semanticCorpus)
      for (const phase of ['before', 'suspended', 'failure', 'json-limit']) {
        const text = phase === 'json-limit' ? '\0'.repeat(2 * 1024 * 1024) : `# ${name}\n\n${body}`
        const receiver = new PackedSemanticReceiver(
          {
            bytes: 8 * 1024 * 1024,
            retained: 64 * 1024 * 1024,
            staging: 8 * 1024 * 1024,
            captures: 8,
            readers: 160,
          },
          { retained: 32 * 1024 * 1024, staging: 8 * 1024 * 1024, nodes: 800000, depth: 128 },
        )
        const receiverBaseline = receiver.stats.retainedBytes
        const queue = [],
          sent = [],
          failures = [],
          results = [],
          owners = []
        let clock = 0,
          reads = 0,
          scan,
          prepared,
          scheduled
        const port = new PackedSemanticPort(
          {
            onMessage() {},
            onFailure() {},
            post(value) {
              sent.push(value)
            },
            terminate() {},
          },
          receiver,
          { now: () => ++clock, defer: (run) => queue.push(run) },
        )
        const baseline = receiver.stats.retainedBytes
        port.onFailure((reason) => failures.push(reason))
        port.onResult((result) => results.push(result))
        globalThis.__manuslipSourceWork = (work, captured) => {
          scan = work
          held.add(work)
          owners.push(new WeakRef(captured))
        }
        globalThis.__manuslipSourcePortWork = (work, parent, input) => {
          scheduled = work
          prepared = parent
          held.add(work)
          held.add(parent)
          owners.push(new WeakRef(input))
        }
        port.postRequestCooperative({
          kind: 'parse',
          sequence: 1,
          generation: 1,
          documentId: name,
          revision: 0,
          source: text,
          options: { rawHtml: false, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' },
          sentAt: 0,
        })
        assert.ok(scan && prepared && scheduled)
        assert.equal(owners.length, 2)
        assert.ok(receiver.stats.retainedBytes - baseline >= text.length * 2)
        assert.equal(queue.length, 1)
        held.add(port)
        held.add(queue[0])
        const charged = receiver.stats.retainedBytes - baseline
        String.prototype.charCodeAt = function (index) {
          if (this === text) {
            reads++
            if (phase === 'failure' && reads === 4097) throw new Error('source scan failure')
          }
          return originalRead.call(this, index)
        }
        if (phase !== 'before') {
          queue.shift()()
          assert.equal(reads, 4096)
        }
        assert.equal(await collect(owners), 2, `${name}/${phase}: suspended owner absent`)
        if (phase === 'failure') {
          queue.shift()()
          assert.deepEqual(failures, ['worker-post'])
          assert.equal(reads, 4097)
        } else if (phase === 'json-limit') {
          while (queue.length) queue.shift()()
          assert.deepEqual(failures, [])
          assert.equal(results.length, 1)
          assert.equal(results[0].kind, 'error')
          assert.equal(results[0].code, 'semantic-limit')
          assert.ok(reads > 4096 && reads < text.length)
        } else port.cancel()
        assert.equal(
          receiver.stats.retainedBytes,
          phase === 'failure' ? receiverBaseline : baseline,
        )
        const closedAt = reads
        assert.deepEqual(scan.next(), { done: true, value: undefined })
        assert.deepEqual(prepared.next(), { done: true, value: undefined })
        scheduled.run()
        for (const callback of queue) callback()
        assert.equal(reads, closedAt)
        assert.equal(sent.length, 0)
        if (phase === 'json-limit') assert.equal(await collect(owners), 0)
        globalThis.__manuslipSourceWork = undefined
        globalThis.__manuslipSourcePortWork = undefined
        port.terminate()
        receiver.dispose()
        assert.equal(receiver.stats.retainedBytes, 0)
        const survivors = await collect(owners)
        assert.equal(survivors, 0, `${name}/${phase}: closed source owners retained`)
        observations.push({
          name,
          phase,
          sourceUnits: text.length,
          charged,
          reads,
          ownerWitnesses: owners.length,
          activeOwners: 2,
          survivors,
          retainedAfterDispose: receiver.stats.retainedBytes,
          heldHandles: 5,
          sizeErrorWhileAlive: phase === 'json-limit',
        })
        String.prototype.charCodeAt = originalRead
      }
    assert.equal(observations.length, 24)
    assert.equal(held.size, 120)
    assert.equal(injections.length, 2)
    for (const [path, hash] of evaluated)
      assert.equal(globalThis.__manuslipSourceBindings[path], hash, path)
    for (const row of injections)
      assert.equal(globalThis.__manuslipSourceInjections[row.path], row.injectedSha256, row.path)
    await writeFile(
      resolve(output, `${label}-report.json`),
      `${JSON.stringify(
        {
          development,
          observations,
          heldHandles: held.size,
          injections,
          evaluated: [...evaluated],
        },
        null,
        2,
      )}\n`,
    )
  } finally {
    String.prototype.charCodeAt = originalRead
    globalThis.__manuslipSourceWork = undefined
    globalThis.__manuslipSourcePortWork = undefined
    await server.close()
  }
}
