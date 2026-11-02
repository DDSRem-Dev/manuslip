// Harness input conversion belongs outside the measured renderer. Fetch the independent
// Node oracle's fixture, then exercise the actual transferable ArrayBuffer boundary.
self.onmessage = async (event: MessageEvent<string>) => {
  try {
    const response = await fetch(event.data)
    if (!response.ok) throw new Error(`Fixture fetch failed: ${response.status}`)
    const payload = await response.arrayBuffer()
    self.postMessage({ kind: 'payload', payload }, { transfer: [payload] })
    self.postMessage({ kind: 'detached', bytes: payload.byteLength })
  } catch (error) {
    self.postMessage({ kind: 'error', message: String(error) })
  }
}
