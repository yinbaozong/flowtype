const { app, BrowserWindow, ipcMain, session } = require('electron')
const { join } = require('node:path')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const profile = mkdtempSync(join(tmpdir(), 'flowtype-capture-test-'))
app.setPath('userData', profile)
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
let window, bytes = 0, chunks = 0, stopped = false
const timer = setTimeout(() => end(1, 'capture timed out'), 20000)
function end(code, message) {
  clearTimeout(timer)
  console.log((code ? 'FAIL ' : 'PASS ') + message)
  window?.destroy()
  app.quit()
  app.once('quit', () => { try { rmSync(profile, { recursive: true, force: true }) } catch {} })
  process.exitCode = code
}
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'media'))
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === 'media')
  ipcMain.handle('recording:error', (_event, message) => end(1, message))
  ipcMain.on('audio:level', () => {})
  ipcMain.on('live:pcm', (_event, id, pcm) => {
    if (id !== 'internal-capture' || stopped || !(pcm instanceof Uint8Array) || pcm.byteLength % 2) return end(1, 'invalid PCM frame')
    bytes += pcm.byteLength; chunks++
  })
  ipcMain.on('live:finish', () => {
    stopped = true
    end(bytes >= 32000 && chunks >= 10 ? 0 : 1, `isolated AudioWorklet capture: ${chunks} frames, ${bytes} bytes, final flush acknowledged; fake microphone only`)
  })
  window = new BrowserWindow({ show: false, webPreferences: { preload: join(__dirname, '../out/preload/index.mjs'), sandbox: false, backgroundThrottling: false } })
  window.webContents.once('did-finish-load', () => setTimeout(() => {
    window.webContents.send('live:capture', { type: 'start', id: 'internal-capture' })
    setTimeout(() => window.webContents.send('live:capture', { type: 'stop', id: 'internal-capture' }), 2500)
  }, 300))
  void window.loadFile(join(__dirname, '../out/renderer/index.html'), { hash: 'capture' })
})
