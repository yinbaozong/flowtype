const { app, BrowserWindow, ipcMain } = require('electron')
const { join } = require('node:path')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
app.setPath('userData', mkdtempSync(join(tmpdir(), 'flowtype-preview-test-')))
let window
const timer = setTimeout(() => { console.error('FAIL preview timeout'); app.exit(1) }, 15000)
app.whenReady().then(async () => {
  ipcMain.handle('state:get', () => ({ settings: { uiLanguage: 'zh' } }))
  let retries = 0, dismissed = 0
  ipcMain.handle('live:retry', () => { retries++ })
  ipcMain.handle('live:dismiss', () => { dismissed++ })
  window = new BrowserWindow({ width: 320, height: 200, frame: false, show: false, webPreferences: { preload: join(__dirname, '../out/preload/index.mjs'), sandbox: false, backgroundThrottling: false } })
  await window.loadFile(join(__dirname, '../out/renderer/index.html'), { hash: 'preview' })
  await new Promise(resolve => setTimeout(resolve, 300))
  window.webContents.send('live:state', { text: '已经定稿的句子。'.repeat(30), draft: '实时草稿正在更新。'.repeat(20), phase: 'failed', error: '网络连接失败。'.repeat(20), canRetry: true })
  await new Promise(resolve => setTimeout(resolve, 150))
  const shape = await window.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector('.live-preview');
    const footer = panel.querySelector('footer');
    const buttons = [...footer.querySelectorAll('button')];
    const rect = footer.getBoundingClientRect();
    const visible = rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
    buttons[0].click(); buttons[1].click();
    return { visible, count: buttons.length, paragraphHeight: panel.querySelector('p').getBoundingClientRect().height };
  })()`)
  await new Promise(resolve => setTimeout(resolve, 100))
  if (!shape.visible || shape.count !== 2 || shape.paragraphHeight > 65 || retries !== 1 || dismissed !== 1) throw new Error('Preview layout or actions failed: ' + JSON.stringify(shape))
  window.webContents.send('state:changed', { settings: { uiLanguage: 'en' } })
  await new Promise(resolve => setTimeout(resolve, 100))
  const label = await window.webContents.executeJavaScript("document.querySelector('footer button').textContent")
  if (label !== 'Retry once') throw new Error('English preview failed')
  console.log('PASS hidden preview: long draft, three-line limit, visible retry/dismiss buttons, actions, live language switch')
  clearTimeout(timer); window.destroy(); app.quit()
}).catch(error => { console.error('FAIL preview:', error.message); app.exit(1) })
