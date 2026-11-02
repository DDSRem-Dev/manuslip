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
  const output = await mkdtemp(resolve('test/artifacts/logs/packed-worker-source-lifetime-'))
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
      'Separate production/development forced-GC diagnostics over the actual cooperative Worker endpoint and shared producer scheduler. Hold actual scanner, factory, reservation work, source task, host, endpoint and callback handles. Observe normalized owners live while queued and collected after closure, original input envelopes detached before scanning, exact read checkpoints, released reservations and independent prior-offer ACK after candidate digest and exact JSON-limit failures. The six original corpora remain unchanged; additional control-character cases exercise the JSON cap. Reachability and weighted ownership only; no physical peak or latency claim.',
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
            injected = `  globalThis.__manuslipWorkerSourceWork?.(work,captured)\n${marker}`
          } else if (path === 'apps/desktop/src/renderer/src/semantics/packed-producer-source.ts') {
            marker = '  return Object.freeze(work) as ProducerSourceWork'
            injected = `  globalThis.__manuslipWorkerSourcePrepared?.(work,request,checked)\n${marker}`
          } else if (path === 'apps/desktop/src/renderer/src/semantics/packed-producer-host.ts') {
            marker = '      this.#source = task\n      events.queued()'
            injected = `      globalThis.__manuslipWorkerSourceTask?.(task,this)\n${marker}`
          } else if (path === 'apps/desktop/src/renderer/src/semantics/packed-worker-endpoint.ts') {
            marker = '            this.#host.prepareCooperative(command.input, command.exchange, {'
            injected = `            globalThis.__manuslipWorkerSourceInput?.(command)\n${marker}`
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
            code += `\n;(globalThis.__manuslipWorkerSourceInjections ??= {})[${JSON.stringify(path)}]=${JSON.stringify(injectedSha256)};\n`
          }
          return {
            code: `${code}\n;(globalThis.__manuslipWorkerSourceBindings ??= {})[${JSON.stringify(path)}]=${JSON.stringify(originalSha256)};\n`,
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
    const load = (path) => server.ssrLoadModule(`/${path}`)
    const { PackedWorkerEndpoint } = await load(
      'apps/desktop/src/renderer/src/semantics/packed-worker-endpoint.ts',
    )
    const { PackedSemanticReceiver } = await load(
      'apps/desktop/src/renderer/src/semantics/packed-receiver.ts',
    )
    const { PackedSource } = await load('packages/core/src/packing-source.ts')
    const { parserVersion, sourceHash, messageSize } = await load('packages/core/src/contracts.ts')
    const { rendererVersion } = await load('packages/renderer/src/index.ts')
    const { newPackedToken } = await load('packages/core/src/packing-token.ts')
    const { packedWireVersion } = await load('packages/core/src/packing-wire.ts')
    const { finishPackedSteps } = await load('packages/core/src/packing-work.ts')
    const options = { rawHtml: false, footnotesLabel: 'Notes', footnoteBackLabel: 'Back' }
    for (const [name, body] of semanticCorpus)
      for (const phase of ['before', 'suspended', 'failure', 'mismatch', 'json-limit']) {
        const text = phase === 'json-limit' ? '\0'.repeat(2 * 1024 * 1024) : `# ${name}\n\n${body}`
        const preservesPrior = phase === 'mismatch' || phase === 'json-limit'
        const rejects = preservesPrior || phase === 'failure'
        const queue = [],
          messages = [],
          owners = [],
          inputs = []
        let clock = 0,
          reads = 0,
          jsonLimitReads = 0,
          scan,
          prepared,
          task
        const endpoint = new PackedWorkerEndpoint(
          {
            post(value, transfer) {
              messages.push(structuredClone(value, { transfer }))
            },
          },
          {
            now: () => (clock += 3),
            defer: (run) => queue.push(run),
          },
        )
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
        const identity = (source, revision) => ({
          generation: 1,
          documentId: name,
          revision,
          sourceHash: sourceHash(source),
          parserVersion: `${parserVersion}/manuslip`,
          rendererVersion,
          options: JSON.stringify(options),
        })
        const input = (source, sequence, revision) => ({
          kind: 'parse',
          sequence,
          generation: 1,
          documentId: name,
          revision,
          source,
          options: { ...options },
          sentAt: 0,
        })
        let previous
        if (preservesPrior) {
          const old = '# Existing offer\n\nKeep this complete result.'
          const ticket = receiver.begin(1, new PackedSource(identity(old, 0), old), options)
          endpoint.receive({
            kind: 'prepare',
            input: input(old, 1, 0),
            exchange: structuredClone(ticket),
          })
          while (queue.length) queue.shift()()
          assert.equal(messages.length, 1)
          assert.equal(endpoint.stats.phase, 'offered')
          previous = { ticket, message: messages[0] }
        }
        const baseline = endpoint.stats.retainedBytes
        globalThis.__manuslipWorkerSourceWork = (work, captured) => {
          scan = work
          held.add(work)
          owners.push(new WeakRef(captured))
        }
        globalThis.__manuslipWorkerSourcePrepared = (work, request, checked) => {
          prepared = work
          held.add(work)
          owners.push(new WeakRef(request), new WeakRef(checked))
        }
        globalThis.__manuslipWorkerSourceTask = (value, host) => {
          task = value
          held.add(value)
          held.add(value.work)
          held.add(host)
        }
        globalThis.__manuslipWorkerSourceInput = (command) => {
          inputs.push(
            new WeakRef(command),
            new WeakRef(command.input),
            new WeakRef(command.exchange),
          )
        }
        const key = (() => {
          const sequence = preservesPrior ? 2 : 1,
            revision = preservesPrior ? 1 : 0
          const exchange = {
            protocol: packedWireVersion,
            kind: 'request',
            sequence,
            identity: identity(text, revision),
            requestToken: newPackedToken(),
            base: null,
          }
          if (phase === 'mismatch') exchange.identity.sourceHash = 'claimed:wrong'
          const request = input(text, sequence, revision)
          if (phase === 'json-limit')
            jsonLimitReads =
              Math.floor((8 * 1024 * 1024 - messageSize({ ...request, source: '' })) / 6) + 1
          endpoint.receiveCooperative({
            kind: 'prepare',
            input: request,
            exchange,
          })
          return { sequence, requestToken: exchange.requestToken }
        })()
        assert.ok(scan && prepared && task)
        assert.equal(owners.length, 3)
        assert.equal(inputs.length, 3)
        assert.equal(queue.length, 1)
        held.add(endpoint)
        held.add(queue[0])
        const charged = endpoint.stats.retainedBytes - baseline
        assert.ok(charged >= text.length * 2)
        String.prototype.charCodeAt = function (index) {
          if (this === text) {
            reads++
            if (phase === 'failure' && reads === 4097) throw new Error('source read failure')
          }
          return originalRead.call(this, index)
        }
        if (phase !== 'before') {
          queue.shift()()
          assert.equal(reads, 4096)
        }
        assert.equal(
          await collect(owners),
          3,
          'normalized source owners absent while queued/suspended',
        )
        assert.equal(
          await collect(inputs),
          0,
          'original request envelope retained after immutable capture',
        )
        if (rejects) while (queue.length) queue.shift()()
        else endpoint.receiveCooperative({ kind: 'cancel', ...key })
        assert.equal(
          reads,
          phase === 'before'
            ? 0
            : phase === 'suspended'
              ? 4096
              : phase === 'failure'
                ? 4097
                : phase === 'json-limit'
                  ? jsonLimitReads
                  : text.length,
        )
        assert.equal(endpoint.stats.retainedBytes, baseline)
        if (rejects) {
          assert.equal(messages.length, preservesPrior ? 2 : 1)
          assert.equal(messages.at(-1).kind, 'semantic-error')
          assert.equal(messages.at(-1).sequence, key.sequence)
          assert.equal(messages.at(-1).requestToken, key.requestToken)
          if (phase === 'json-limit') assert.equal(messages.at(-1).code, 'semantic-limit')
        } else assert.equal(messages.length, 0)
        const closedAt = reads
        for (const handle of [scan, prepared, task.work])
          assert.deepEqual(handle.next(), { done: true, value: undefined })
        for (const callback of queue.splice(0)) callback()
        assert.equal(reads, closedAt)
        const survivors = await collect(owners),
          inputSurvivors = await collect(inputs)
        assert.equal(survivors, 0)
        assert.equal(inputSurvivors, 0)
        if (previous) {
          assert.equal(endpoint.stats.phase, 'offered')
          const result = finishPackedSteps(receiver.receiveSteps(previous.ticket, previous.message))
          assert.equal(result?.kind, 'accepted')
          result.capture.release()
          endpoint.receiveCooperative({ kind: 'ack', acknowledgement: result.acknowledgement })
          while (queue.length) queue.shift()()
          assert.equal(endpoint.stats.current.revision, 0)
        }
        endpoint.dispose()
        receiver.dispose()
        assert.equal(endpoint.stats.retainedBytes, 0)
        assert.equal(receiver.stats.retainedBytes, 0)
        observations.push({
          name,
          phase,
          sourceUnits: text.length,
          charged,
          reads,
          jsonLimitReads: phase === 'json-limit' ? jsonLimitReads : undefined,
          ownerWitnesses: owners.length,
          activeOwners: 3,
          survivors,
          inputWitnesses: inputs.length,
          queuedInputSurvivors: 0,
          inputSurvivors,
          heldHandles: 7,
          priorOfferAcknowledged: !!previous,
          retainedAfterDispose: endpoint.stats.retainedBytes,
        })
        String.prototype.charCodeAt = originalRead
        for (const key of ['Work', 'Prepared', 'Task', 'Input'])
          globalThis[`__manuslipWorkerSource${key}`] = undefined
      }
    assert.equal(observations.length, 30)
    assert.equal(held.size, 210)
    assert.equal(injections.length, 4)
    for (const [path, hash] of evaluated)
      assert.equal(globalThis.__manuslipWorkerSourceBindings[path], hash, path)
    for (const row of injections)
      assert.equal(
        globalThis.__manuslipWorkerSourceInjections[row.path],
        row.injectedSha256,
        row.path,
      )
    await writeFile(
      resolve(output, `${label}-report.json`),
      `${JSON.stringify({ development, observations, heldHandles: held.size, injections, evaluated: [...evaluated] }, null, 2)}\n`,
    )
  } finally {
    String.prototype.charCodeAt = originalRead
    globalThis.__manuslipWorkerSourceWork = undefined
    for (const key of ['Prepared', 'Task', 'Input'])
      globalThis[`__manuslipWorkerSource${key}`] = undefined
    await server.close()
  }
}
