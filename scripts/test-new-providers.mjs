import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { gzipSync, gunzipSync } from 'node:zlib'
import { mock } from 'node:test'
const sockets = []
globalThis.__providerSockets = sockets
const output = await build({ entryPoints: ['src/main/speech-providers.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'socket', setup(b) {
  b.onResolve({ filter: /^ws$/ }, () => ({ path: 'ws', namespace: 'fake' }))
  b.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: `import {EventEmitter} from 'node:events'; export default class Socket extends EventEmitter { static OPEN=1; readyState=1; bufferedAmount=0; sent=[]; constructor(url,options){super();this.url=url;this.options=options;globalThis.__providerSockets.push(this)} send(v){this.sent.push(v)} close(){this.emit('close')} terminate(){this.emit('close')} }` }))
} }] })
const { requestDeepSeek, VolcanoSession, decodeVolcano } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)
let request
const text = await requestDeepSeek(new Uint8Array(44), 'test-key', async (url, init) => {
  request = { url, init }
  return new Response(JSON.stringify({ text: '中文结果' }))
})
assert.equal(text, '中文结果')
assert.equal(request.url, 'https://api.deepseek.com/v1/tools/asr')
assert.equal(request.init.headers.Authorization, 'Bearer test-key')
assert.equal(request.init.body.get('file').name, 'speech.wav')
assert.equal(request.init.body.get('file').size, 44)
await assert.rejects(requestDeepSeek(new Uint8Array(44), ''), /Key/)
await assert.rejects(requestDeepSeek(new Uint8Array(44), 'key', async () => new Response('unauthorized', { status: 401 })), /401/)
const frame = (payload, final = false) => {
  const body = gzipSync(Buffer.from(JSON.stringify(payload)))
  const prefix = Buffer.alloc(12); prefix.set([0x11, final ? 0x93 : 0x91, 0x11, 0]); prefix.writeInt32BE(final ? -1 : 1, 4); prefix.writeUInt32BE(body.length, 8)
  return Buffer.concat([prefix, body])
}
assert.throws(() => decodeVolcano(Buffer.alloc(2)))
const updates = [], inserted = []
const session = new VolcanoSession({ volcanoApiKey: 'fake', volcanoAppId: '', volcanoAccessKey: '', volcanoResourceId: 'volc.seedasr.sauc.duration', language: 'auto' }, value => updates.push(value), value => inserted.push(value))
session.connect(); session.append(new Uint8Array(6400))
const peer = sockets.at(-1)
assert.equal(peer.options.headers['X-Api-Key'], 'fake')
assert.equal(peer.options.headers['X-Api-Resource-Id'], 'volc.seedasr.sauc.duration')
peer.emit('open')
const configuration = JSON.parse(gunzipSync(peer.sent[0].subarray(8)))
assert.equal(configuration.request.result_type, 'full')
assert.equal(configuration.audio.rate, 16000)
assert.equal(peer.sent[1][1] >> 4, 2)
peer.emit('message', frame({ result: { text: '你好草稿', utterances: [{ text: '你好', definite: true }] } }))
assert.deepEqual(inserted, ['你好'])
peer.emit('message', frame({ result: { text: '你好草稿', utterances: [{ text: '你好', definite: true }] } }))
assert.equal(inserted.length, 1)
session.finish(); assert.equal(peer.sent.at(-1)[1] & 2, 2)
peer.emit('close'); assert.equal(updates.at(-1).canRetry, true)
session.retry(); const retry = sockets.at(-1); retry.emit('open')
retry.emit('message', frame({ result: { text: '你好世界', utterances: [{ text: '你好世界', definite: true }] } }, true))
assert.equal(inserted.join(''), '你好世界')
assert.equal(updates.at(-1).phase, 'done')
session.dispose()
mock.timers.enable({ apis: ['setTimeout', 'Date'] })
try {
  const states = []
  const quick = new VolcanoSession({ volcanoApiKey: 'fake', language: 'auto' }, value => states.push(value), () => {})
  quick.connect(); quick.append(new Uint8Array(640)); quick.finish()
  const socket = sockets.at(-1); socket.emit('open')
  assert.equal(socket.sent.at(-1)[1] & 2, 2, 'release during handshake flushes the final frame')
  mock.timers.tick(15001)
  assert.equal(states.at(-1).canRetry, true, 'bounded finalization exposes one retry')
  quick.retry(); const replacement = sockets.at(-1); replacement.emit('open'); replacement.emit('close')
  assert.equal(states.at(-1).canRetry, false, 'failed retry releases pending audio')
  const count = sockets.length; quick.retry(); assert.equal(sockets.length, count)
  quick.dispose()
} finally { mock.timers.reset() }
console.log('PASS DeepSeek multipart/auth/errors and Volcano binary protocol, buffering, finalized output, deduplication and retry')
