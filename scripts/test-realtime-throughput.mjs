import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mock } from 'node:test'

const sockets = []
globalThis.__throughputSockets = sockets
const output = await build({
  entryPoints: ['src/main/realtime-session.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'measured-socket', setup(builder) {
    builder.onResolve({ filter: /^ws$/ }, () => ({ path: 'ws', namespace: 'fake' }))
    builder.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: `
      import { EventEmitter } from 'node:events';
      export default class Socket extends EventEmitter {
        static OPEN = 1;
        readyState = 1; bufferedAmount = 0; sent = [];
        constructor() { super(); globalThis.__throughputSockets.push(this); }
        send(value) { this.sent.push(JSON.parse(value)); }
        close() { this.emit('close'); }
        terminate() { this.emit('close'); }
      }
    ` }))
  } }]
})
const { RealtimeSession } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)
const bytesSent = peer => peer.sent.reduce((sum, event) => sum + (event.audio ? Buffer.from(event.audio, 'base64').length : 0), 0)

mock.timers.enable({ apis: ['setTimeout', 'Date'] })
let session
try {
  session = new RealtimeSession('fake', 'zh', () => {}, () => {})
  session.connect()
  const peer = sockets.at(-1)
  // The capture worklet posts 20ms frames. A 300ms handshake must not leave a permanent delay.
  for (let frame = 0; frame < 15; frame++) session.append(new Uint8Array(640))
  peer.emit('open')
  peer.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' })))
  mock.timers.tick(1)
  const startupBacklog = (15 * 640 - bytesSent(peer)) / 32
  console.log(`Handshake backlog remaining after readiness: ${startupBacklog}ms`)

  let produced = 15
  // Windows timers may wake at ~32ms instead of 20ms. Audio production must not outpace the sender.
  for (let elapsed = 32; elapsed <= 60_000; elapsed += 32) {
    mock.timers.tick(32)
    const expected = 15 + Math.floor(elapsed / 20)
    while (produced < expected) { session.append(new Uint8Array(640)); produced++ }
  }
  const lag = (produced * 640 - bytesSent(peer)) / 32
  console.log(`Upload backlog after 60s with delayed timer wakes: ${lag}ms`)
  assert.equal(startupBacklog, 0, 'send already captured audio without an extra wait per 20ms frame')
  assert.equal(lag, 0, 'upload must keep up with 20ms capture frames despite delayed timers')
  session.finish()
  assert.equal(peer.sent.at(-1).type, 'session.finish', 'release sends finish immediately after all captured audio')
  assert.equal(bytesSent(peer), produced * 640, 'no samples dropped or duplicated')
} finally {
  session?.dispose()
  mock.timers.reset()
  delete globalThis.__throughputSockets
}
console.log('PASS realtime upload catch-up, sustained throughput and immediate finish')
