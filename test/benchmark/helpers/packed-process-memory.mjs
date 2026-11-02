import assert from 'node:assert/strict'

/** Serialized by Playwright into Electron's main process. Keep this function self-contained. */
export function readPackedProcessMemory({ app, BrowserWindow }) {
  const rendererPid = BrowserWindow.getAllWindows()[0].webContents.getOSProcessId()
  const bytes = (value) => {
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(value * 1024))
      throw new Error('Invalid Electron process memory observation')
    return value * 1024
  }
  const processes = app.getAppMetrics().map((metric) => ({
    pid: metric.pid,
    creationTime: metric.creationTime,
    type: metric.type,
    ...(metric.serviceName ? { serviceName: metric.serviceName } : {}),
    workingSetBytes: bytes(metric.memory.workingSetSize),
    lifetimePeakWorkingSetBytes: bytes(metric.memory.peakWorkingSetSize),
    ...(metric.memory.privateBytes === undefined
      ? {}
      : { privateBytes: bytes(metric.memory.privateBytes) }),
  }))
  const renderer = processes.find((metric) => metric.pid === rendererPid)
  if (renderer?.type !== 'Tab')
    throw new Error('Measured renderer is absent from Electron process metrics')
  if (new Set(processes.map((metric) => metric.pid)).size !== processes.length)
    throw new Error('Duplicate Electron process metrics')
  return {
    observedAt: Date.now(),
    renderer,
    processes,
    // Summed working sets include shared pages more than once. Never sum lifetime peaks:
    // each process may have reached its high-water mark at a different time.
    totals: {
      workingSetBytes: processes.reduce((sum, metric) => sum + metric.workingSetBytes, 0),
      ...(processes.every((metric) => metric.privateBytes !== undefined)
        ? { privateBytes: processes.reduce((sum, metric) => sum + metric.privateBytes, 0) }
        : {}),
    },
  }
}

/** Keep absolute process footprint separate from the increase over this case's baseline. */
export function summarizePackedProcessMemory(samples, baseline) {
  assert.ok(samples.length > 0, 'Missing process memory samples')
  for (const sample of samples) {
    assert.equal(sample.renderer.pid, baseline.renderer.pid, 'Renderer process changed')
    assert.equal(
      sample.renderer.creationTime,
      baseline.renderer.creationTime,
      'Renderer process was replaced',
    )
  }
  const summarize = (kind, key) => {
    const before = baseline[kind][key]
    if (before === undefined || samples.some((sample) => sample[kind][key] === undefined))
      return undefined
    const maximum = samples.reduce((largest, sample) =>
      sample[kind][key] > largest[kind][key] ? sample : largest,
    )
    return {
      baselineBytes: before,
      maximumSampledBytes: maximum[kind][key],
      maximumSampledIncrease: maximum[kind][key] - before,
      observedAt: maximum.observedAt,
    }
  }
  return {
    samples: samples.length,
    renderer: {
      workingSet: summarize('renderer', 'workingSetBytes'),
      private: summarize('renderer', 'privateBytes'),
      // This is the OS process lifetime high-water mark, including startup/warmup.
      lifetimePeakWorkingSet: summarize('renderer', 'lifetimePeakWorkingSetBytes'),
    },
    electronProcesses: {
      summedWorkingSets: summarize('totals', 'workingSetBytes'),
      private: summarize('totals', 'privateBytes'),
    },
  }
}
