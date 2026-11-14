const { app, BrowserWindow, ipcMain } = require('electron')
const { join } = require('node:path')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
app.setPath('userData', mkdtempSync(join(tmpdir(), 'flowtype-dashboard-test-')))
let window
const timer = setTimeout(() => { console.error('FAIL dashboard timed out'); app.exit(1) }, 15000)
app.whenReady().then(async () => {
  const state = {
    settings: { provider: 'qwen', uiLanguage: 'zh', language: 'auto', shortcut: 'Alt+Super', undoShortcut: 'Super+Space',
      overlayX: null, overlayY: null, overlayWidth: 64, overlayVisible: true, launchAtStartup: false,
      qwenApiKey: '', volcanoApiKey: '', volcanoAppId: '', volcanoAccessKey: '', dictionary: [], hasQwenApiKey: true, hasVolcanoApiKey: true, qwenKeySuffix: '12345678', volcanoKeySuffix: '87654321' },
    history: [{ id: 'retry-test', text: '', createdAt: new Date().toISOString(), durationMs: 1000, language: 'auto', provider: 'qwen', targetApp: 'test', status: 'error', error: 'Internal fixture' }],
    recording: false, shortcutReady: true, pendingRetryId: 'retry-test'
  }
  let retried = 0, dismissed = 0
  ipcMain.handle('state:get', () => state)
  ipcMain.handle('live:retry', () => { retried++ })
  ipcMain.handle('live:dismiss', () => { dismissed++ })
  ipcMain.handle('settings:save', (_event, next) => { state.settings = { ...state.settings, ...next }; return state })
  window = new BrowserWindow({ show: false, width: 1180, height: 780, webPreferences: { preload: join(__dirname, '../out/preload/index.mjs'), sandbox: false, backgroundThrottling: false } })
  await window.loadFile(join(__dirname, '../out/renderer/index.html'))
  await new Promise(resolve => setTimeout(resolve, 300))
  await window.webContents.executeJavaScript("document.querySelectorAll('.sidebar nav button')[1].click()")
  await new Promise(resolve => setTimeout(resolve, 100))
  const count = await window.webContents.executeJavaScript(`(() => {
    const retry = document.querySelector('button[title="重试一次"]');
    const dismiss = document.querySelector('button[title="放弃"]');
    if (!retry || !dismiss) return 0;
    retry.click(); dismiss.click();
    return document.querySelectorAll('.live-preview').length === 0 ? 2 : 0;
  })()`)
  await new Promise(resolve => setTimeout(resolve, 100))
  if (count !== 2 || retried !== 1 || dismissed !== 1) throw new Error('History retry actions failed')
  state.settings.uiLanguage = 'en'
  window.webContents.send('state:changed', state)
  await new Promise(resolve => setTimeout(resolve, 100))
  if (!await window.webContents.executeJavaScript("Boolean(document.querySelector('button[title=\"Retry once\"]'))")) throw new Error('English retry failed')
  await window.webContents.executeJavaScript("document.querySelectorAll('.sidebar nav button')[3].click()")
  await new Promise(resolve => setTimeout(resolve, 150))
  const providers = await window.webContents.executeJavaScript(`(() => {
    const select = [...document.querySelectorAll('select')].find(el => [...el.options].some(option => option.value === 'deepseek'));
    return select ? [...select.options].map(option => option.value) : [];
  })()`)
  if (!providers.includes('deepseek') || !providers.includes('volcano')) throw new Error('New provider options missing')
  if (!await window.webContents.executeJavaScript("[...document.querySelectorAll('label')].some(el => el.textContent.includes('DeepSeek API Key') && el.querySelector('input[type=password]'))")) throw new Error('DeepSeek credential field missing')
  await window.webContents.executeJavaScript("document.querySelector('[data-use-provider=volcano]').click()")
  await new Promise(resolve => setTimeout(resolve, 200))
  const active = await window.webContents.executeJavaScript("document.querySelector('[data-testid=active-provider]').textContent")
  if (!active.includes('87654321') || !active.includes('volc.seedasr.sauc.duration') || active.includes('qwen3')) throw new Error('Saved provider/model/key suffix did not switch together')
  const summary = await window.webContents.executeJavaScript("document.querySelector('[data-testid=service-summary]').textContent")
  if (!summary.includes('Currently active:') || !summary.includes('87654321')) throw new Error('Active configuration summary missing')
  // Unrelated history updates must not reset an in-progress settings selection.
  await window.webContents.executeJavaScript(`(() => { const select = [...document.querySelectorAll('select')].find(el => [...el.options].some(option => option.value === 'deepseek')); select.value = 'deepseek'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  window.webContents.send('state:changed', { ...state, history: [...state.history] })
  await new Promise(resolve => setTimeout(resolve, 150))
  const pending = await window.webContents.executeJavaScript("document.querySelector('[data-testid=service-summary]').textContent")
  if (!pending.includes('Not saved yet:') || !pending.includes('DeepSeek')) throw new Error('History update reset unsaved provider selection')
  console.log('PASS hidden dashboard: history retry/dismiss, English actions, no standalone preview')
  clearTimeout(timer); window.destroy(); app.quit()
}).catch(error => { console.error('FAIL dashboard:', error.message); app.exit(1) })
