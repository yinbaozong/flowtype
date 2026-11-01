import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const js = ts.transpileModule(readFileSync('src/renderer/src/audio-capture.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
let requested = 0, contexts = 0, latestNode
const tracks = []
const connectable = () => ({ connect: next => next, disconnect() {} })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { async getUserMedia() {
  requested++
  const track = { readyState: 'live', enabled: true, stop() { this.readyState = 'ended' } }
  tracks.push(track)
  return { getAudioTracks: () => [track], getTracks: () => [track] }
} } } })
globalThis.window = globalThis
globalThis.AudioContext = class {
  state = 'running'; audioWorklet = { async addModule() {} }; destination = {}
  constructor() { contexts++ }
  createMediaStreamSource() { return connectable() }
  createGain() { return { ...connectable(), gain: { value: 1 } } }
  async resume() { this.state = 'running' }
  async close() { this.state = 'closed' }
}
globalThis.AudioWorkletNode = class {
  constructor() {
    latestNode = this
    this.port = { onmessage: null, postMessage: data => this.port.onmessage?.({ data: data.type === 'start' ? { started: data.id } : { done: data.id } }) }
  }
  connect(next) { return next }
  disconnect() {}
}
const { AudioCapture } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const started = [], finished = [], frames = []
const capture = new AudioCapture({ frame: (...value) => frames.push(value), started: id => started.push(id), finished: id => finished.push(id), ready: () => {} })
await capture.standby()
assert.equal(requested, 0, 'preload audio code without opening the microphone')
const one = capture.prepare(), two = capture.prepare()
assert.equal(one, two, 'share one in-flight initialization')
await one
assert.equal(requested, 1)
assert.equal(tracks[0].enabled, false, 'idle audio track is disabled')
await capture.start('first')
assert.equal(requested, 1, 'warm start does not reopen the microphone')
assert.equal(contexts, 1)
latestNode.port.onmessage({ data: { id: 'first', pcm: new Int16Array([100, 200]) } })
assert.equal(frames.length, 1)
await capture.stop('first')
assert.equal(tracks[0].enabled, false)
latestNode.port.onmessage({ data: { id: 'first', pcm: new Int16Array([100]) } })
assert.equal(frames.length, 1, 'ignore late samples after release')
await capture.start('second')
assert.equal(requested, 1, 'reuse resources across consecutive recordings')
latestNode.port.onmessage({ data: { id: 'first', pcm: new Int16Array([100]) } })
assert.equal(frames.length, 1, 'ignore previous session samples')
await capture.stop('second')
await capture.standby()
assert.equal(tracks[0].readyState, 'ended', 'on-demand standby actually releases the microphone')
await capture.start('on-demand')
assert.equal(requested, 2)
assert.equal(contexts, 1, 'reuse the preloaded processor even when reopening microphone hardware')
await capture.stop('on-demand')
await capture.standby()
await capture.release()
assert.equal(tracks[0].readyState, 'ended')
await capture.start('after-resume')
assert.equal(requested, 3, 'recreate released resources after suspend')
assert.deepEqual(started, ['first', 'second', 'on-demand', 'after-resume'])
assert.deepEqual(finished, ['first', 'second', 'on-demand'])
await capture.release()
console.log('PASS microphone preparation: shared initialization, muted idle, warm consecutive starts, stale sample rejection, resource release/recreate')
