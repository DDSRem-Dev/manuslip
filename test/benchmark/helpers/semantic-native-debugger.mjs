import assert from 'node:assert/strict'
import { readPackedProcessMemory } from './packed-process-memory.mjs'

// Nested target messages keep commands attached to the actual semantic Worker. No
// worker JSHandle, source value, parser graph or native document is retained here.
export async function observeNativeWorker(application, page, allocationProfile) {
  if (allocationProfile !== undefined && typeof allocationProfile !== 'function')
    throw new Error('Invalid native allocation profile callback')
  const session = await page.context().newCDPSession(page)
  const pending = new Map(),
    targets = new Map(),
    rows = [],
    attempts = [],
    failures = [],
    sampling = new Set(),
    pauses = new Set(),
    profiles = []
  let next = 1,
    currentCase
  const send = (target, method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = next++
      const timeout = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Worker diagnostic command timeout: ${method}`))
      }, 5000)
      pending.set(id, { resolve, reject, timeout, target, method })
      session
        .send('Target.sendMessageToTarget', {
          sessionId: target,
          message: JSON.stringify({ id, method, params }),
        })
        .catch((error) => {
          clearTimeout(timeout)
          pending.delete(id)
          reject(error)
        })
    })
  const pause = async (target) => {
    const name = currentCase
    const started = performance.now()
    const attempt = {
      name,
      target: targets.get(target),
      startedMs: started,
      commands: [],
      captureComplete: false,
      status: 'capturing',
    }
    attempts.push(attempt)
    const measure = async (method, operation) => {
      const command = { method, startedMs: performance.now() - started, status: 'pending' }
      attempt.commands.push(command)
      try {
        const result = await operation()
        command.status = 'completed'
        return result
      } catch (error) {
        command.status = 'failed'
        command.error = String(error)
        throw error
      } finally {
        command.elapsedMs = performance.now() - started - command.startedMs
      }
    }
    let row, profile
    try {
      const marker = await measure('Runtime.evaluate', () =>
        send(target, 'Runtime.evaluate', {
          expression: 'JSON.stringify(globalThis.__manuslipNativePhase ?? null)',
          returnByValue: true,
        }),
      )
      assert.ok(!marker.exceptionDetails, 'Worker marker evaluation failed')
      const phase = JSON.parse(marker.result.value)
      if (!phase) return
      // Keep the numeric marker before any expensive profile/heap command. A target
      // terminated by the unchanged application watchdog must not erase this boundary.
      Object.assign(attempt, phase)
      if (allocationProfile) {
        if (phase.phase === 'before-native-parse') {
          assert.ok(!sampling.has(target), 'Native allocation sampling already started')
          await measure('HeapProfiler.startSampling', () =>
            send(target, 'HeapProfiler.startSampling', {
              samplingInterval: 32768,
              includeObjectsCollectedByMajorGC: true,
              includeObjectsCollectedByMinorGC: true,
            }),
          )
          sampling.add(target)
        }
        if (sampling.has(target)) {
          const completed = phase.phase === 'packed-complete'
          const method = completed ? 'HeapProfiler.stopSampling' : 'HeapProfiler.getSamplingProfile'
          const result = await measure(method, () => send(target, method))
          profile = result.profile
          if (completed) sampling.delete(target)
        }
      }
      const workerHeap = await measure('Worker.Runtime.getHeapUsage', () =>
        send(target, 'Runtime.getHeapUsage'),
      )
      const rendererHeap = await measure('Renderer.Runtime.getHeapUsage', () =>
        session.send('Runtime.getHeapUsage'),
      )
      const process = await measure('Electron.getAppMetrics', () =>
        application.evaluate(readPackedProcessMemory),
      )
      row = {
        name,
        target: targets.get(target),
        ...phase,
        workerHeap,
        rendererHeap,
        process,
      }
      rows.push(row)
      attempt.captureComplete = true
    } catch (error) {
      failures.push({ name, stage: 'pause', error: String(error) })
    } finally {
      await measure('Debugger.resume', () => send(target, 'Debugger.resume')).catch((error) =>
        failures.push({ name, stage: 'resume', error: String(error) }),
      )
      attempt.observerMs = performance.now() - started
      attempt.status = attempt.commands.every((command) => command.status === 'completed')
        ? 'completed'
        : 'failed'
      if (row) row.observerMs = attempt.observerMs
    }
    // All samples and heap measurements above describe the paused boundary.
    // Persist the captured profiles only when the completed probe is drained.
    if (profile) profiles.push({ row: row ?? attempt, attempt, profile })
  }
  const flush = async () => {
    while (pauses.size) await Promise.all([...pauses])
    while (profiles.length) {
      const { row, attempt, profile } = profiles.shift()
      try {
        row.allocations = await allocationProfile(row.name, row.phase, profile)
        attempt.allocations = row.allocations
      } catch (error) {
        failures.push({ name: row.name, stage: 'allocation-profile', error: String(error) })
      }
    }
  }
  session.on('Target.receivedMessageFromTarget', (event) => {
    const message = JSON.parse(event.message)
    if (message.id) {
      const command = pending.get(message.id)
      if (!command) return
      clearTimeout(command.timeout)
      pending.delete(message.id)
      if (message.error)
        command.reject(new Error(`${command.method}: ${JSON.stringify(message.error)}`))
      else command.resolve(message.result)
    } else if (message.method === 'Debugger.paused') {
      const task = pause(event.sessionId)
      pauses.add(task)
      void task.finally(() => pauses.delete(task))
    }
  })
  session.on('Target.attachedToTarget', (event) => {
    if (event.targetInfo.type !== 'worker') {
      void send(event.sessionId, 'Runtime.runIfWaitingForDebugger').catch((error) =>
        failures.push({ stage: 'non-worker', error: String(error) }),
      )
      return
    }
    targets.set(event.sessionId, { id: event.targetInfo.targetId, url: event.targetInfo.url })
    void (async () => {
      await send(event.sessionId, 'Runtime.enable')
      await send(event.sessionId, 'Debugger.enable')
      if (allocationProfile) await send(event.sessionId, 'HeapProfiler.enable')
      await send(event.sessionId, 'Runtime.runIfWaitingForDebugger')
    })().catch((error) =>
      failures.push({ name: currentCase, stage: 'attach', error: String(error) }),
    )
  })
  await session.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: false,
  })
  return {
    rows,
    attempts,
    failures,
    flush,
    select(name) {
      currentCase = name
    },
    async close() {
      await flush()
      // Normally sampling ends at packed-complete. A failed probe may still have
      // a live target; attempt every stop before detaching without retaining profiles.
      for (const target of sampling)
        await send(target, 'HeapProfiler.stopSampling').catch((error) =>
          failures.push({ name: currentCase, stage: 'stop-sampling', error: String(error) }),
        )
      sampling.clear()
      await session.send('Target.setAutoAttach', {
        autoAttach: false,
        waitForDebuggerOnStart: false,
        flatten: false,
      })
      for (const command of pending.values()) {
        clearTimeout(command.timeout)
        command.reject(new Error('Worker diagnostic closed'))
      }
      pending.clear()
      await session.detach()
    },
  }
}
