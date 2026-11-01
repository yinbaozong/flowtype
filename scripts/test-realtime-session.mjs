import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mock } from 'node:test'

const sockets = []
globalThis.__testSockets = sockets
const bundle = await build({
  entryPoints: ['src/main/realtime-session.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'fake-websocket', setup(builder) {
    builder.onResolve({ filter: /^ws$/ }, () => ({ path: 'ws', namespace: 'fake' }))
    builder.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: `
      import { EventEmitter } from 'node:events';
      export default class Socket extends EventEmitter {
        static OPEN = 1;
        readyState = 1; bufferedAmount = 0; sent = [];
        constructor() { super(); globalThis.__testSockets.push(this); }
        send(value) { this.sent.push(JSON.parse(value)); }
        close() { this.emit('close'); }
        terminate() { this.emit('close'); }
      }
    ` }))
  } }]
})
const { RealtimeSession } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const updates = [], sentences = []
const instance = new RealtimeSession('fake-key', 'auto', value => updates.push(value), text => sentences.push(text))
instance.connect()
const socket = sockets.at(-1)
const event = data => socket.emit('message', Buffer.from(JSON.stringify(data)))
instance.append(new Uint8Array(3200))
assert.equal(socket.sent.length, 0, 'buffer audio before handshake')
socket.emit('open')
assert.equal(socket.sent[0].type, 'session.update')
event({ type: 'session.updated' })
assert.equal(socket.sent[1].type, 'input_audio_buffer.append')
event({ type: 'conversation.item.created', item: { id: 'one' } })
event({ type: 'conversation.item.input_audio_transcription.text', item_id: 'one', text: '确认', stash: '草稿' })
assert.equal(updates.at(-1).draft, '确认草稿')
event({ type: 'input_audio_buffer.speech_stopped', item_id: 'one', audio_end_ms: 50 })
event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'one', transcript: '第一句。' })
event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'one', transcript: '重复。' })
assert.deepEqual(sentences, ['第一句。'])
instance.finish()
assert.equal(socket.sent.at(-1).type, 'session.finish')
socket.emit('close')
assert.equal(updates.at(-1).canRetry, true)
instance.retry()
const retry = sockets.at(-1)
assert.notEqual(retry, socket)
retry.emit('open')
retry.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' })))
const replay = retry.sent.find(value => value.type === 'input_audio_buffer.append')
assert.equal(Buffer.from(replay.audio, 'base64').length, 1600, 'retry only unconfirmed tail')
event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'late', transcript: '过期连接' })
assert.deepEqual(sentences, ['第一句。'])
retry.emit('error', new Error('offline'))
assert.equal(updates.at(-1).canRetry, false, 'exactly one manual retry')
instance.retry()
assert.equal(sockets.length, 2)
instance.dispose()

const quick = new RealtimeSession('fake-key', 'zh', () => {}, () => {})
quick.connect()
quick.finish()
const quickSocket = sockets.at(-1)
quickSocket.emit('open')
quickSocket.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' })))
assert.equal(quickSocket.sent.at(-1).type, 'session.finish', 'release during connection still finalizes')
quickSocket.emit('message', Buffer.from(JSON.stringify({ type: 'session.finished' })))
quick.dispose()
mock.timers.enable({ apis: ['setTimeout', 'Date'] })
try {
  const states = []
  const long = new RealtimeSession('fake-key', 'zh', state => states.push(state), () => {})
  long.connect()
  const peer = sockets.at(-1)
  peer.emit('open')
  peer.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' })))
  for (let chunk = 0; chunk < 700; chunk++) {
    long.append(new Uint8Array(3200))
    mock.timers.tick(100)
  }
  assert.equal(long.ended, false, 'recording continues beyond one minute')
  long.finish()
  assert.equal(long.durationMs, 70000)
  mock.timers.tick(15001)
  assert.equal(states.at(-1).phase, 'failed', 'finalization deadline cannot hang')
  assert.equal(states.at(-1).canRetry, true)
  long.dispose()
} finally { mock.timers.reset() }
delete globalThis.__testSockets
console.log('Realtime session: handshake buffering, drafts, deduplication, tail retry, stale events, single retry, quick release passed')
