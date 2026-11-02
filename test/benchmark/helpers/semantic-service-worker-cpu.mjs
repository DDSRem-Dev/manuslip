import assert from 'node:assert/strict'

/** Sample the dedicated application Worker before its first script executes. */
export async function attachSemanticServiceWorkerCpu(application, page, onProfile) {
  await application.evaluate(async ({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length !== 1) throw new Error('Expected one diagnostic window')
    if (globalThis.__manuslipSemanticWorkerCpu) throw new Error('Worker profiler already attached')
    const debug = windows[0].webContents.debugger
    debug.attach('1.3')
    const state = {
      sessions: new Map(),
      pending: new Set(),
      errors: [],
      active: undefined,
      transitioning: false,
      closing: false,
    }
    const command = (method, params = {}, sessionId) => debug.sendCommand(method, params, sessionId)
    const drain = async () => {
      while (state.pending.size) await Promise.all([...state.pending])
    }
    const check = () => {
      if (state.errors.length) throw new Error(state.errors.join('\n'))
    }
    const track = (operation) => {
      const pending = operation.catch((error) => state.errors.push(String(error)))
      state.pending.add(pending)
      void pending.then(() => state.pending.delete(pending))
    }
    const start = async (record) => {
      const active = state.active
      if (!active) return
      if (record.started) throw new Error('Worker profiler already running')
      await command('Profiler.start', {}, record.sessionId)
      record.started = true
      active.records.set(record.sessionId, record)
    }
    const message = (_event, method, params) => {
      if (method === 'Target.attachedToTarget') {
        const { sessionId, targetInfo } = params
        track(
          (async () => {
            try {
              if (targetInfo.type !== 'worker' || state.closing) return
              const record = { sessionId, targetInfo, started: false }
              state.sessions.set(sessionId, record)
              await command('Profiler.enable', {}, sessionId)
              await command('Profiler.setSamplingInterval', { interval: 500 }, sessionId)
              await start(record)
            } finally {
              // Initialization failures must not leave an application target paused.
              await command('Runtime.runIfWaitingForDebugger', {}, sessionId)
            }
          })(),
        )
      } else if (method === 'Target.detachedFromTarget') {
        if (state.active?.records.has(params.sessionId) && !state.closing)
          state.errors.push(`Worker detached during revision ${state.active.revision}`)
        state.sessions.delete(params.sessionId)
      }
    }
    state.phase = async (phase, revision) => {
      if (state.closing || state.transitioning) throw new Error('Worker CPU phase overlaps')
      if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid CPU revision')
      state.transitioning = true
      try {
        await drain()
        check()
        if (phase === 'start') {
          if (state.active) throw new Error('Worker CPU phase already active')
          state.active = { revision, records: new Map() }
          for (const record of state.sessions.values()) await start(record)
          await drain()
          check()
          return
        }
        if (phase !== 'stop' || state.active?.revision !== revision)
          throw new Error('Worker CPU revision mismatch')
        const records = [...state.active.records.values()]
        state.active = undefined
        if (records.length !== 1) throw new Error('Expected one actual Worker for this revision')
        const [record] = records
        if (state.sessions.get(record.sessionId) !== record || !record.started)
          throw new Error('Profiled Worker is no longer attached')
        const { profile } = await command('Profiler.stop', {}, record.sessionId)
        record.started = false
        check()
        return { targetInfo: record.targetInfo, profile }
      } finally {
        state.transitioning = false
      }
    }
    state.completeCase = async () => {
      if (state.active || state.transitioning) throw new Error('Worker CPU phase still active')
      const deadline = Date.now() + 10000
      do {
        await drain()
        check()
        if (!state.sessions.size) return
        await new Promise((resolve) => setTimeout(resolve, 20))
      } while (Date.now() < deadline)
      throw new Error('Application Worker did not detach after fixture disposal')
    }
    state.dispose = async () => {
      state.closing = true
      state.active = undefined
      try {
        await drain()
        await command('Target.setAutoAttach', {
          autoAttach: false,
          waitForDebuggerOnStart: false,
          flatten: true,
        })
        await drain()
      } finally {
        debug.off('message', message)
        if (debug.isAttached()) debug.detach()
        delete globalThis.__manuslipSemanticWorkerCpu
      }
      check()
    }
    globalThis.__manuslipSemanticWorkerCpu = state
    debug.on('message', message)
    try {
      await command('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
      })
    } catch (error) {
      await state.dispose().catch(() => {})
      throw error
    }
  })
  const dispose = () =>
    application.evaluate(async () => {
      await globalThis.__manuslipSemanticWorkerCpu?.dispose()
    })
  try {
    await page.exposeFunction('semanticServiceProbePhase', async (phase, revision) => {
      const result = await application.evaluate(
        async (_electron, { phase, revision }) =>
          globalThis.__manuslipSemanticWorkerCpu.phase(phase, revision),
        { phase, revision },
      )
      if (phase === 'stop') {
        assert.equal(result.targetInfo.type, 'worker')
        assert.ok(result.profile.nodes.length && result.profile.samples.length)
        await onProfile(revision, result.targetInfo, result.profile)
      }
    })
  } catch (error) {
    await dispose().catch(() => {})
    throw error
  }
  return {
    completeCase: () =>
      application.evaluate(async () => {
        await globalThis.__manuslipSemanticWorkerCpu.completeCase()
      }),
    dispose,
  }
}
