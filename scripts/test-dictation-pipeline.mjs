import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { mock } from 'node:test'

// Exercise the actual main-process orchestration with fake OS boundaries, never real input.
const boundary = {
  commands: [], sockets: [], pasted: [], handlers: new Map(), listeners: new Map(), files: new Map(), clipboard: ''
}
globalThis.__dictationBoundary = boundary
const output = await build({
  entryPoints: ['src/main/index.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'isolated-desktop', setup(builder) {
    builder.onLoad({ filter: /src[\\/]main[\\/]index\.ts$/ }, args => ({
      loader: 'ts', contents: `${readFileSync(args.path, 'utf8')}
        export const fixture = {
          initialize() {
            settings = { ...defaults, provider: 'qwen', qwenApiKey: 'fake' };
            data = { settings: toStoredSettings(settings), history: [] };
            captureReady = true;
            captureWindow = { webContents: { send: (...args) => globalThis.__dictationBoundary.commands.push(args) } };
            registerIpc();
          },
          start: startRecording, stop: stopRecording, cancel: cancelRecording, state: getState,
          edit: invalidateLiveInput,
          overlay() { return overlayState.mode; },
          capture() { return captureWindow.webContents; },
          close() { isQuitting = true; cancelRecording(); }
        };
      `
    }))
    for (const name of ['electron', 'ws', 'node:fs', 'node:fs/promises']) {
      builder.onResolve({ filter: new RegExp(`^${name.replaceAll('/', '\\/')}$`) }, () => ({ path: name, namespace: 'fake' }))
    }
    builder.onResolve({ filter: /^\.\/input-worker$/ }, () => ({ path: 'input-worker', namespace: 'fake' }))
    builder.onLoad({ filter: /.*/, namespace: 'fake' }, args => {
      const shared = `const b = globalThis.__dictationBoundary;`
      if (args.path === 'electron') return { contents: `${shared}
        export const app = { requestSingleInstanceLock: () => true, getAppPath: () => '', getPath: () => '', setPath() {}, whenReady: () => new Promise(() => {}), on() {} };
        export const ipcMain = { handle: (name, fn) => b.handlers.set(name, fn), on: (name, fn) => b.listeners.set(name, fn) };
        export const safeStorage = { isEncryptionAvailable: () => false };
        export const clipboard = { readText: () => b.clipboard, readHTML: () => '', readRTF: () => '', readImage: () => ({ isEmpty: () => true }), writeText: value => { b.clipboard = value; }, write: value => { b.clipboard = value.text; } };
        export const BrowserWindow = class {}; export const Tray = class {};
        export const dialog = {}, Menu = {}, nativeImage = {}, powerMonitor = {}, screen = {}, session = {};
      ` }
      if (args.path === 'ws') return { contents: `${shared}
        import { EventEmitter } from 'node:events';
        export default class Socket extends EventEmitter {
          static OPEN = 1; readyState = 1; bufferedAmount = 0; sent = [];
          constructor() { super(); b.sockets.push(this); }
          send(value) { this.sent.push(JSON.parse(value)); }
          terminate() { this.emit('close'); } close() { this.emit('close'); }
        }
      ` }
      if (args.path === 'input-worker') return { contents: `${shared}
        import { EventEmitter } from 'node:events';
        export function runInput(definitions, hwnd, focus, operation) {
          const request = new EventEmitter();
          b.pasted.push({ text: b.clipboard, hwnd, focus, operation });
          queueMicrotask(() => request.emit('close', 0)); return request;
        }
        export function stopInputWorker() {}
      ` }
      if (args.path === 'node:fs/promises') return { contents: `${shared}
        export async function writeFile(path, value) { b.files.set(path, value); }
        export async function rename(from, to) { b.files.set(to, b.files.get(from)); b.files.delete(from); }
      ` }
      return { contents: `${shared}
        export const existsSync = () => false, statSync = () => ({ size: 0 }), renameSync = () => {}, readFileSync = () => '';
        export const writeFileSync = (path, value) => b.files.set(path, value);
        export const appendFileSync = (path, value) => b.files.set(path, (b.files.get(path) || '') + value);
      ` }
    })
  } }]
})
const { fixture } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)
const settle = async () => { for (let n = 0; n < 20; n++) await Promise.resolve() }
const emit = (peer, event) => peer.emit('message', Buffer.from(JSON.stringify(event)))
const final = (peer, id, text) => {
  emit(peer, { type: 'input_audio_buffer.speech_started', item_id: id })
  emit(peer, { type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript: text })
}
const finishCapture = id => boundary.listeners.get('live:finish')({ sender: fixture.capture() }, id)
const start = () => {
  fixture.start(123, 456)
  const command = boundary.commands.filter(value => value[0] === 'live:capture' && value[1].type === 'start').at(-1)[1]
  const peer = boundary.sockets.at(-1)
  peer.emit('open'); emit(peer, { type: 'session.updated' })
  boundary.listeners.get('live:capture-started')({ sender: fixture.capture() }, command.id)
  return { id: command.id, peer }
}
mock.timers.enable({ apis: ['setTimeout', 'Date'] })
try {
  fixture.initialize()
  const first = start()
  fixture.stop(); finishCapture(first.id)
  assert.equal(fixture.state().recording, false)
  const second = start()
  assert.notEqual(second.id, first.id, 'a finishing cloud request must not block the next press-to-talk')
  assert.equal(fixture.state().recording, true)

  // Later speech finishes first, but cannot overtake the previous dictation in the input field.
  final(second.peer, 'second', '第二轮。')
  await settle()
  assert.equal(boundary.pasted.length, 0)
  final(first.peer, 'first', '第一轮。')
  emit(first.peer, { type: 'session.finished' })
  await settle()
  mock.timers.tick(751); await settle()
  assert.deepEqual(boundary.pasted.map(value => value.text), ['第一轮。', '第二轮。'])
  assert.notEqual(fixture.overlay(), 'success', 'an old request must not replace the new listening indicator')
  fixture.stop(); finishCapture(second.id)
  emit(second.peer, { type: 'session.finished' })
  mock.timers.tick(751); await settle()
  assert.equal(fixture.state().history.length, 2, 'both finished sessions remain in history')

  const third = start()
  fixture.stop()
  const fourth = start()
  boundary.listeners.get('live:pcm')({ sender: fixture.capture() }, third.id, new Uint8Array(640))
  finishCapture(third.id)
  assert.equal(third.peer.sent.at(-1).type, 'session.finish', 'late capture ack is routed to its own session')
  assert.ok(third.peer.sent.some(event => event.type === 'input_audio_buffer.append'), 'the old final audio frame is not dropped after a new press')
  assert.equal(fixture.state().recording, true)
  const lastCommand = boundary.commands.filter(value => value[0] === 'live:capture').at(-1)[1]
  assert.equal(lastCommand.type, 'start', 'old capture ack must not release the new microphone')
  fixture.edit()
  final(third.peer, 'third', '只保存在历史三。'); emit(third.peer, { type: 'session.finished' })
  final(fourth.peer, 'fourth', '只保存在历史四。')
  fixture.stop(); finishCapture(fourth.id); emit(fourth.peer, { type: 'session.finished' })
  mock.timers.tick(2000); await settle()
  assert.equal(boundary.pasted.length, 2, 'manual input or focus change invalidates every older automatic insertion')
  assert.equal(fixture.state().history.length, 4)

  const fifth = start()
  fixture.stop()
  const sixth = start()
  mock.timers.tick(1501); await settle()
  assert.equal(fifth.peer.sent.at(-1).type, 'session.finish', 'missing capture ack has a bounded fallback')
  assert.equal(fixture.state().recording, true, 'old capture timeout must not reset a newer recording')
  final(fifth.peer, 'fifth', '第五轮。'); emit(fifth.peer, { type: 'session.finished' })
  final(sixth.peer, 'sixth', '第六轮。')
  fixture.stop(); finishCapture(sixth.id); emit(sixth.peer, { type: 'session.finished' })
  await settle(); mock.timers.tick(751); await settle(); mock.timers.tick(751); await settle()
  assert.deepEqual(boundary.pasted.slice(-2).map(value => value.text), ['第五轮。', '第六轮。'])

  const seventh = start()
  fixture.cancel()
  const eighth = start()
  final(seventh.peer, 'late-cancelled', '不允许晚到。')
  final(eighth.peer, 'eighth', '取消后可以继续。')
  fixture.stop(); finishCapture(eighth.id); emit(eighth.peer, { type: 'session.finished' })
  await settle(); mock.timers.tick(751); await settle()
  assert.equal(boundary.pasted.at(-1).text, '取消后可以继续。', 'cancelled turn releases the input order gate')
  assert.ok(!fixture.state().history.some(item => item.text.includes('不允许晚到')))

  const ninth = start()
  fixture.stop(); finishCapture(ninth.id)
  ninth.peer.emit('error', new Error('offline'))
  const tenth = start()
  final(tenth.peer, 'tenth', '失败后也可以继续。')
  fixture.stop(); finishCapture(tenth.id); emit(tenth.peer, { type: 'session.finished' })
  await settle(); mock.timers.tick(751); await settle()
  assert.equal(boundary.pasted.at(-1).text, '失败后也可以继续。', 'failed turn releases the input order gate')

  const last = start()
  fixture.close()
  const afterShutdown = start()
  // close() marks application shutdown; no new recording or stale insertion is permitted.
  assert.equal(afterShutdown.id, last.id)
} finally {
  fixture.close()
  await settle()
  mock.timers.reset()
  delete globalThis.__dictationBoundary
}
console.log('PASS overlapping dictation, ordered insertion, late capture ack, edit cancellation and history retention (fake OS only)')
