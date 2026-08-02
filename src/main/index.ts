import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  screen,
  session,
  Tray
} from 'electron'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AppSettings,
  AppState,
  HistoryItem,
  OverlayState,
  Provider,
  PublicSettings,
  TranscribeRequest
} from '../shared/types'

type StoredSettings = Omit<AppSettings, 'qwenApiKey' | 'volcanoApiKey' | 'volcanoAccessKey'> & {
  qwenApiKeyEncrypted: string
  volcanoApiKeyEncrypted: string
  volcanoAccessKeyEncrypted: string
}

interface StoredData {
  settings: StoredSettings
  history: HistoryItem[]
}

const defaults: AppSettings = {
  provider: 'demo',
  uiLanguage: 'zh',
  language: 'auto',
  shortcut: 'Super+Space',
  overlayX: null,
  overlayY: null,
  overlayWidth: 64,
  launchAtStartup: true,
  qwenApiKey: '',
  volcanoApiKey: '',
  volcanoAppId: '',
  volcanoAccessKey: '',
  dictionary: []
}

const singleInstanceLock = app.requestSingleInstanceLock()
if (!singleInstanceLock) app.quit()

const appRoot = app.getAppPath()
let data: StoredData
let settings: AppSettings = defaults
let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let tray: Tray | null = null
let recording = false
let isQuitting = false
let overlayState: OverlayState = { mode: 'idle' }
let previousClipboard = ''
let pasteTargetExpected = false
let pasteTargetHwnd = 0
let pasteTargetFocusHwnd = 0
let hotkeyHook: ChildProcessWithoutNullStreams | null = null
let shortcutCapture: ChildProcessWithoutNullStreams | null = null
let shortcutReady = false
let maximumRecordingTimer: NodeJS.Timeout | null = null
let lastProgrammaticOverlayBounds: Electron.Rectangle | null = null
let overlayMoveTimer: NodeJS.Timeout | null = null
let overlayTopMostTimer: NodeJS.Timeout | null = null
let overlayDragOffset: { x: number; y: number } | null = null

const preferredDataPath =
  process.env.FLOWTYPE_DATA_DIR ||
  (app.isPackaged ? join(app.getPath('appData'), 'FlowType') : join(appRoot, '.flowtype-data'))
app.setPath('userData', preferredDataPath)

const dataPath = (): string => join(app.getPath('userData'), 'flowtype-data.json')

function encrypt(value: string): string {
  if (!value) return ''
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value).toString('base64')
    : Buffer.from(value, 'utf8').toString('base64')
}

function decrypt(value: string): string {
  if (!value) return ''
  try {
    const buffer = Buffer.from(value, 'base64')
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buffer)
      : buffer.toString('utf8')
  } catch {
    return ''
  }
}

function toStoredSettings(value: AppSettings): StoredSettings {
  const { qwenApiKey, volcanoApiKey, volcanoAccessKey, ...publicFields } = value
  return {
    ...publicFields,
    qwenApiKeyEncrypted: encrypt(qwenApiKey),
    volcanoApiKeyEncrypted: encrypt(volcanoApiKey),
    volcanoAccessKeyEncrypted: encrypt(volcanoAccessKey)
  }
}

function fromStoredSettings(value?: Partial<StoredSettings>): AppSettings {
  if (!value) return { ...defaults }
  const shortcut = value.shortcut === 'Alt+Space' ? 'Super+Space' : value.shortcut
  return {
    ...defaults,
    ...value,
    shortcut: shortcut || defaults.shortcut,
    qwenApiKey: decrypt(value.qwenApiKeyEncrypted ?? ''),
    volcanoApiKey: decrypt(value.volcanoApiKeyEncrypted ?? ''),
    volcanoAccessKey: decrypt(value.volcanoAccessKeyEncrypted ?? ''),
    dictionary: Array.isArray(value.dictionary) ? value.dictionary : []
  }
}

function loadData(): void {
  if (!existsSync(dataPath())) {
    settings = { ...defaults }
    data = { settings: toStoredSettings(settings), history: [] }
    persist()
    return
  }

  try {
    const parsed = JSON.parse(readFileSync(dataPath(), 'utf8')) as StoredData
    settings = fromStoredSettings(parsed.settings)
    data = {
      settings: toStoredSettings(settings),
      history: Array.isArray(parsed.history) ? parsed.history : []
    }
    persist()
  } catch {
    settings = { ...defaults }
    data = { settings: toStoredSettings(settings), history: [] }
  }
}

function persist(): void {
  data.settings = toStoredSettings(settings)
  writeFileSync(dataPath(), JSON.stringify(data, null, 2), 'utf8')
}

function publicSettings(): PublicSettings {
  return {
    ...settings,
    qwenApiKey: '',
    volcanoApiKey: '',
    volcanoAccessKey: '',
    hasQwenApiKey: Boolean(settings.qwenApiKey),
    hasVolcanoApiKey: Boolean(settings.volcanoApiKey)
  }
}

function getState(): AppState {
  return {
    settings: publicSettings(),
    history: data.history,
    recording,
    shortcutReady
  }
}

function broadcastState(): void {
  const state = getState()
  mainWindow?.webContents.send('state:changed', state)
  overlayWindow?.webContents.send('state:changed', state)
}

function setOverlayState(state: OverlayState): void {
  overlayState = state
  positionOverlay(state.mode)
  overlayWindow?.webContents.send('overlay:state', state)
  overlayWindow?.showInactive()
  enforceOverlayTopMost()
}

function enforceOverlayTopMost(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1)
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlayWindow.moveTop()
}

function roundedOverlayShape(width: number, mode: OverlayState['mode']): Electron.Rectangle[] {
  const visibleWidth = mode === 'idle' ? Math.max(1, width - 6) : width
  const visibleHeight = mode === 'idle' ? 18 : 34
  const originX = mode === 'idle' ? 3 : 0
  const originY = Math.round((51 - visibleHeight) / 2)
  const radius = visibleHeight / 2
  const rectangles: Electron.Rectangle[] = []
  for (let row = 0; row < visibleHeight; row += 1) {
    const distanceY = Math.abs(row + 0.5 - radius)
    const inset = Math.max(0, Math.ceil(radius - Math.sqrt(Math.max(0, radius * radius - distanceY * distanceY))))
    rectangles.push({
      x: originX + inset,
      y: originY + row,
      width: Math.max(1, visibleWidth - inset * 2),
      height: 1
    })
  }
  return rectangles
}

function updateOverlayShape(width: number, mode = overlayState.mode): void {
  if (!overlayWindow || overlayWindow.isDestroyed() || process.platform !== 'win32') return
  overlayWindow.setShape(roundedOverlayShape(width, mode))
}

function positionOverlay(mode = overlayState.mode): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  const savedPosition =
    typeof settings.overlayX === 'number' && typeof settings.overlayY === 'number'
      ? { x: settings.overlayX, y: settings.overlayY }
      : null
  const display = savedPosition
    ? screen.getDisplayNearestPoint(savedPosition)
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const bounds = display.workArea
  const active = mode !== 'idle'
  // Frameless Electron windows have a ~51px minimum height on Windows.
  // Position using that real height so the visible content stays above the taskbar.
  const width = Math.min(280, Math.max(44, settings.overlayWidth))
  const height = 51
  const defaultPosition = {
    x: bounds.x + Math.round((bounds.width - width) / 2),
    y: bounds.y + bounds.height - height - 6
  }
  const position = savedPosition ?? defaultPosition
  const x = Math.round(Math.min(bounds.x + bounds.width - width, Math.max(bounds.x, position.x)))
  const y = Math.round(Math.min(bounds.y + bounds.height - height, Math.max(bounds.y, position.y)))
  lastProgrammaticOverlayBounds = { x, y, width, height }
  overlayWindow.setBounds(lastProgrammaticOverlayBounds, false)
  updateOverlayShape(width, mode)
}

function saveOverlayPosition(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  const bounds = overlayWindow.getBounds()
  if (
    lastProgrammaticOverlayBounds &&
    bounds.x === lastProgrammaticOverlayBounds.x &&
    bounds.y === lastProgrammaticOverlayBounds.y
  ) {
    lastProgrammaticOverlayBounds = null
    return
  }
  settings.overlayX = bounds.x
  settings.overlayY = bounds.y
  persist()
}

function loadWindow(window: BrowserWindow, hash = ''): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${hash}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: hash.replace('#', '') })
  }
}

function createMainWindow(): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'flowtype-icon.png')
    : join(appRoot, 'resources', 'flowtype-icon.png')
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    show: Boolean(process.env.ELECTRON_RENDERER_URL),
    title: 'FlowType',
    icon: iconPath,
    backgroundColor: '#f5f6f8',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  loadWindow(mainWindow)
}

function createOverlayWindow(): void {
  overlayWindow = new BrowserWindow({
    width: 64,
    height: 51,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    show: false,
    title: '',
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      backgroundThrottling: false
    }
  })
  overlayWindow.setBackgroundColor('#00000000')
  if (process.platform === 'win32') overlayWindow.setBackgroundMaterial('none')
  overlayWindow.setHasShadow(false)
  enforceOverlayTopMost()
  overlayWindow.setTitle('')
  overlayWindow.setVisibleOnAllWorkspaces(true)
  overlayWindow.on('moved', () => {
    if (overlayDragOffset) return
    if (overlayMoveTimer) clearTimeout(overlayMoveTimer)
    overlayMoveTimer = setTimeout(saveOverlayPosition, 180)
  })
  overlayWindow.on('show', enforceOverlayTopMost)
  overlayWindow.webContents.on('did-finish-load', () => {
    positionOverlay()
    overlayWindow?.webContents.send('overlay:state', overlayState)
  })
  overlayWindow.once('ready-to-show', () => {
    positionOverlay()
    overlayWindow?.showInactive()
    enforceOverlayTopMost()
  })
  loadWindow(overlayWindow, '#overlay')
  overlayTopMostTimer = setInterval(enforceOverlayTopMost, 1500)
  overlayTopMostTimer.unref()
}

function trayIcon(): Electron.NativeImage {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'flowtype-tray.png')
    : join(appRoot, 'resources', 'flowtype-tray.png')
  if (existsSync(iconPath)) return nativeImage.createFromPath(iconPath)

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="10" fill="#17191d"/>
  <path d="M8 17c2.4 0 2.4-6 4.8-6s2.4 10 4.8 10 2.4-8 4.8-8 2.4 4 4.8 4" fill="none" stroke="#ff6b57" stroke-width="2.6" stroke-linecap="round"/>
  </svg>`
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
}

function showDashboard(): void {
  mainWindow?.show()
  mainWindow?.focus()
}

function createTray(): void {
  tray = new Tray(trayIcon().resize({ width: 20, height: 20 }))
  tray.setToolTip('FlowType 语音输入')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 FlowType', click: showDashboard },
      { label: '开始 / 停止识别', click: toggleRecording },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', showDashboard)
}

async function registerShortcut(): Promise<boolean> {
  stopHotkeyHook()
  shortcutReady = false
  try {
    validateShortcut(settings.shortcut)
    await startHotkeyHook(settings.shortcut)
    shortcutReady = true
  } catch {
    shortcutReady = false
  }
  broadcastState()
  return shortcutReady
}

function hotkeyScriptPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'windows-key-hook.ps1')
    : join(appRoot, 'resources', 'windows-key-hook.ps1')
}

function shortcutCaptureScriptPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'shortcut-capture.ps1')
    : join(appRoot, 'resources', 'shortcut-capture.ps1')
}

function captureShortcut(): Promise<{ shortcut: string }> {
  if (shortcutCapture) throw new Error('正在录入快捷键，请先完成当前操作')
  stopHotkeyHook()
  shortcutReady = false
  broadcastState()

  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', shortcutCaptureScriptPath()],
      { windowsHide: true }
    )
    shortcutCapture = child
    child.stdout.setEncoding('utf8')
    let output = ''
    let settled = false
    const finish = (error?: Error, shortcut?: string): void => {
      if (settled) return
      settled = true
      shortcutCapture = null
      child.kill()
      void registerShortcut()
      if (error) reject(error)
      else resolve({ shortcut: shortcut! })
    }
    child.stdout.on('data', (chunk: string) => {
      output += chunk
      const match = output.match(/SHORTCUT\s+([^\r\n]+)/)
      if (match) {
        try {
          const shortcut = normalizeShortcut(match[1])
          validateShortcut(shortcut)
          finish(undefined, shortcut)
        } catch (error) {
          finish(error instanceof Error ? error : new Error('不支持这个快捷键'))
        }
      }
      else if (/INVALID/.test(output)) finish(new Error('组合键需要包含 Ctrl、Alt、Shift 或 Win，并搭配一个按键'))
      else if (/CANCEL/.test(output)) finish(new Error('快捷键录入已超时，请重试'))
    })
    child.once('error', () => finish(new Error('无法启动 Windows 快捷键捕获器')))
    child.once('close', () => {
      if (!settled) finish(new Error('未捕获到有效快捷键，请重试'))
    })
  })
}

function startHotkeyHook(shortcut: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', hotkeyScriptPath(), '-Shortcut', shortcut],
      { windowsHide: true }
    )
    hotkeyHook = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    let ready = false
    let stderr = ''
    const readyTimer = setTimeout(() => {
      if (ready || hotkeyHook !== child) return
      hotkeyHook = null
      child.kill()
      reject(new Error('Windows 快捷键监听器启动超时'))
    }, 5_000)
    child.stdout.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        const value = line.trim()
        if (value === 'READY' && !ready) {
          ready = true
          clearTimeout(readyTimer)
          resolve()
        }
        const down = value.match(/^DOWN(?:\s+(\d+))?(?:\s+(\d+))?$/)
        if (down) startRecording(Number(down[1] || 0), Number(down[2] || 0))
        if (value === 'UP') stopRecording()
      }
    })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.once('close', () => {
      clearTimeout(readyTimer)
      if (!ready) reject(new Error(stderr.trim() || 'Windows 快捷键监听器启动失败'))
      if (hotkeyHook !== child) return
      hotkeyHook = null
      shortcutReady = false
      broadcastState()
      if (!isQuitting) setTimeout(() => void registerShortcut(), 1200)
    })
    child.once('error', () => {
      clearTimeout(readyTimer)
      if (!ready) reject(new Error('无法启动 Windows 快捷键监听器'))
      if (hotkeyHook !== child) return
      hotkeyHook = null
      shortcutReady = false
      broadcastState()
    })
  })
}

function stopHotkeyHook(): void {
  const child = hotkeyHook
  hotkeyHook = null
  child?.kill()
}

function toggleRecording(): void {
  if (recording) stopRecording()
  else startRecording()
}

function startRecording(targetHwnd = 0, targetFocusHwnd = 0): void {
  if (recording) return
  recording = true
  previousClipboard = clipboard.readText()
  pasteTargetExpected = true
  pasteTargetHwnd = targetHwnd
  pasteTargetFocusHwnd = targetFocusHwnd
  setOverlayState({ mode: 'recording', startedAt: Date.now(), message: '正在聆听' })
  overlayWindow?.webContents.send('recording:command', 'start')
  maximumRecordingTimer = setTimeout(stopRecording, 60_000)
  broadcastState()
}

function stopRecording(): void {
  if (!recording) return
  if (maximumRecordingTimer) clearTimeout(maximumRecordingTimer)
  maximumRecordingTimer = null
  recording = false
  setOverlayState({ mode: 'processing', message: '正在识别' })
  overlayWindow?.webContents.send('recording:command', 'stop')
  broadcastState()
}

function cancelRecording(): void {
  if (!recording && overlayState.mode === 'idle') return
  if (maximumRecordingTimer) clearTimeout(maximumRecordingTimer)
  maximumRecordingTimer = null
  recording = false
  pasteTargetExpected = false
  pasteTargetHwnd = 0
  pasteTargetFocusHwnd = 0
  setOverlayState({ mode: 'idle' })
  overlayWindow?.webContents.send('recording:command', 'cancel')
  broadcastState()
}

function normalizeShortcut(shortcut: string): string {
  return shortcut
    .replace('Ctrl', 'Control')
    .replace('Win', 'Super')
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('+')
}

function validateShortcut(shortcut: string): void {
  const parts = shortcut.split('+').filter(Boolean)
  const modifiers = new Set(['Control', 'Alt', 'Shift', 'Super'])
  if (parts.length < 2 || !parts.some((part) => modifiers.has(part))) {
    throw new Error('组合键需要包含 Ctrl、Alt、Shift 或 Win，并搭配一个按键')
  }
  const signature = [...parts].sort().join('+')
  const blocked = new Set([
    ['Control', 'Alt', 'Delete'].sort().join('+'),
    ['Alt', 'Tab'].sort().join('+'),
    ['Alt', 'F4'].sort().join('+'),
    ['Super', 'L'].sort().join('+'),
    ['Super', 'U'].sort().join('+')
  ])
  if (blocked.has(signature)) throw new Error('这是 Windows 保留快捷键，请换一个组合键')
  const triggerKeys = parts.filter((part) => !modifiers.has(part))
  if (!triggerKeys.length && signature !== ['Alt', 'Super'].sort().join('+')) {
    throw new Error('纯修饰键组合仅支持 Alt + Win')
  }
}

async function mergeSettings(next: AppSettings): Promise<void> {
  const previousSettings = settings
  const normalizedShortcut = normalizeShortcut(next.shortcut || settings.shortcut)
  const shortcutChanged = normalizedShortcut !== settings.shortcut || !shortcutReady
  const qwenApiKey = next.qwenApiKey.trim() || settings.qwenApiKey
  const volcanoApiKey = next.volcanoApiKey.trim() || settings.volcanoApiKey
  settings = {
    ...settings,
    ...next,
    provider: next.provider === 'demo' && next.qwenApiKey.trim() ? 'qwen' : next.provider,
    shortcut: normalizedShortcut,
    overlayX: settings.overlayX,
    overlayY: settings.overlayY,
    overlayWidth: Math.min(280, Math.max(44, next.overlayWidth || settings.overlayWidth)),
    qwenApiKey,
    volcanoApiKey,
    volcanoAccessKey: next.volcanoAccessKey || settings.volcanoAccessKey,
    dictionary: [...new Set(next.dictionary.map((word) => word.trim()).filter(Boolean))]
  }
  if (shortcutChanged && !(await registerShortcut())) {
    settings = previousSettings
    await registerShortcut()
    throw new Error('这个快捷键无法启用，请确认组合键有效后重试')
  }
  updateLoginItemSettings()
  persist()
  positionOverlay()
}

function updateLoginItemSettings(): void {
  app.setLoginItemSettings({
    openAtLogin: settings.launchAtStartup,
    path: process.execPath,
    args: app.isPackaged ? [] : [appRoot]
  })
}

function extractQwenText(payload: unknown): string {
  const value = payload as {
    choices?: Array<{ message?: { content?: string } }>
    output?: { choices?: Array<{ message?: { content?: Array<{ text?: string }> | string } }> }
  }
  const compatibleContent = value.choices?.[0]?.message?.content
  if (typeof compatibleContent === 'string') return compatibleContent.trim()
  const content = value.output?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((item) => item.text ?? '')
      .join('')
      .trim()
  }
  return ''
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('语音识别请求超时，请检查网络后重试')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function requestQwen(audio: Uint8Array, mimeType: string, requireText: boolean): Promise<string> {
  if (!settings.qwenApiKey) throw new Error('请先在设置中填写千问 API Key')
  const response = await fetchWithTimeout('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.qwenApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'qwen3-asr-flash',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: { data: `data:${mimeType};base64,${Buffer.from(audio).toString('base64')}` }
            }
          ]
        }
      ],
      stream: false,
      asr_options: {
        enable_itn: true,
        ...(settings.language === 'auto' ? {} : { language: settings.language })
      }
    })
  })
  const payload = (await response.json()) as {
    message?: string
    code?: string
    error?: { message?: string; code?: string }
  }
  if (!response.ok) {
    throw new Error(payload.error?.message || payload.message || payload.error?.code || payload.code || '千问语音识别请求失败')
  }
  const text = extractQwenText(payload)
  if (requireText && !text) throw new Error('没有识别到语音内容，请靠近麦克风后重试')
  return text
}

async function transcribeQwen(audio: Uint8Array, mimeType: string): Promise<string> {
  return requestQwen(audio, mimeType, true)
}

function silentWav(): Uint8Array {
  const samples = 8_000
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + samples * 2, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(16_000, 24)
  buffer.writeUInt32LE(32_000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples * 2, 40)
  return new Uint8Array(buffer)
}

async function transcribeVolcano(audio: Uint8Array): Promise<string> {
  if (!settings.volcanoApiKey) throw new Error('请先在设置中填写火山引擎 API Key')
  const requestId = randomUUID()
  const authHeaders: Record<string, string> = settings.volcanoAccessKey
    ? {
        'X-Api-App-Key': settings.volcanoAppId || settings.volcanoApiKey,
        'X-Api-Access-Key': settings.volcanoAccessKey
      }
    : { 'X-Api-Key': settings.volcanoApiKey }
  const response = await fetchWithTimeout('https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Resource-Id': 'volc.bigasr.auc_turbo',
      'X-Api-Request-Id': requestId,
      'X-Api-Sequence': '-1',
      ...authHeaders
    },
    body: JSON.stringify({
      user: { uid: settings.volcanoAppId || settings.volcanoApiKey || 'flowtype-desktop' },
      audio: { data: Buffer.from(audio).toString('base64') },
      request: {
        model_name: 'bigmodel',
        enable_itn: true,
        enable_punc: true,
        enable_ddc: true,
        show_utterances: true
      }
    })
  })
  const payload = (await response.json()) as { result?: { text?: string }; message?: string }
  const code = response.headers.get('X-Api-Status-Code')
  if (!response.ok || (code && code !== '20000000')) {
    throw new Error(payload.message || response.headers.get('X-Api-Message') || '火山语音识别请求失败')
  }
  const text = payload.result?.text?.trim()
  if (!text) throw new Error('火山未返回可用文本')
  return text
}

async function transcribeAudio(request: TranscribeRequest): Promise<string> {
  if (settings.provider === 'qwen') return transcribeQwen(request.audio, request.mimeType)
  if (settings.provider === 'volcano') return transcribeVolcano(request.audio)
  return '这是一次 FlowType 演示识别。请在设置中配置千问或火山引擎 API Key。'
}

function sendPaste(targetHwnd = 0, targetFocusHwnd = 0): ChildProcess {
  const pasteTarget = targetFocusHwnd || targetHwnd
  const command = `
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class FlowTypePaste {
  private const ushort VK_CONTROL = 0x11;
  private const ushort VK_SHIFT = 0x10;
  private const ushort VK_MENU = 0x12;
  private const ushort VK_LWIN = 0x5B;
  private const ushort VK_RWIN = 0x5C;
  private const ushort VK_V = 0x56;
  private const uint KEYEVENTF_KEYUP = 0x0002;
  private const uint INPUT_KEYBOARD = 1;

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
  [DllImport("kernel32.dll")]
  private static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")]
  private static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")]
  private static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")]
  private static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SendMessageTimeout(
    IntPtr hWnd, uint msg, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);
  [DllImport("user32.dll", SetLastError = true)]
  private static extern uint SendInput(uint count, INPUT[] inputs, int size);

  public static void PasteToControl(IntPtr hWnd) {
    UIntPtr result;
    SendMessageTimeout(hWnd, 0x0302, UIntPtr.Zero, IntPtr.Zero, 2, 1500, out result);
  }

  public static void Activate(IntPtr window, IntPtr focus) {
    uint currentThread = GetCurrentThreadId();
    uint targetThread = GetWindowThreadProcessId(window, IntPtr.Zero);
    uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
    if (foregroundThread != 0) AttachThreadInput(currentThread, foregroundThread, true);
    if (targetThread != 0) AttachThreadInput(currentThread, targetThread, true);
    BringWindowToTop(window);
    SetForegroundWindow(window);
    if (focus != IntPtr.Zero) SetFocus(focus);
    if (targetThread != 0) AttachThreadInput(currentThread, targetThread, false);
    if (foregroundThread != 0) AttachThreadInput(currentThread, foregroundThread, false);
  }

  private static INPUT Key(ushort key, bool up) {
    return new INPUT {
      type = INPUT_KEYBOARD,
      union = new InputUnion {
        keyboard = new KEYBDINPUT { virtualKey = key, flags = up ? KEYEVENTF_KEYUP : 0 }
      }
    };
  }

  public static void PasteWithKeyboard() {
    INPUT[] inputs = new INPUT[] {
      Key(VK_LWIN, true), Key(VK_RWIN, true), Key(VK_MENU, true), Key(VK_SHIFT, true), Key(VK_CONTROL, true),
      Key(VK_CONTROL, false), Key(VK_V, false), Key(VK_V, true), Key(VK_CONTROL, true)
    };
    SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void Paste(IntPtr focus) {
    StringBuilder name = new StringBuilder(128);
    GetClassName(focus, name, name.Capacity);
    string className = name.ToString();
    if (className.StartsWith("Edit") || className.StartsWith("RichEdit")) PasteToControl(focus);
    else PasteWithKeyboard();
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct INPUT { public uint type; public InputUnion union; }
  [StructLayout(LayoutKind.Explicit)]
  private struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mouse;
    [FieldOffset(0)] public KEYBDINPUT keyboard;
    [FieldOffset(0)] public HARDWAREINPUT hardware;
  }
  [StructLayout(LayoutKind.Sequential)]
  private struct MOUSEINPUT {
    public int x;
    public int y;
    public uint mouseData;
    public uint flags;
    public uint time;
    public UIntPtr extraInfo;
  }
  [StructLayout(LayoutKind.Sequential)]
  private struct KEYBDINPUT {
    public ushort virtualKey;
    public ushort scanCode;
    public uint flags;
    public uint time;
    public UIntPtr extraInfo;
  }
  [StructLayout(LayoutKind.Sequential)]
  private struct HARDWAREINPUT {
    public uint message;
    public ushort low;
    public ushort high;
  }
}
'@
[FlowTypePaste]::Activate([IntPtr]${targetHwnd}, [IntPtr]${pasteTarget})
Start-Sleep -Milliseconds 120
[FlowTypePaste]::Paste([IntPtr]${pasteTarget})`
  const encodedCommand = Buffer.from(command, 'utf16le').toString('base64')
  return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedCommand], {
    windowsHide: true,
    stdio: 'ignore'
  })
}

function pasteText(text: string, restoreClipboard = true): void {
  clipboard.writeText(text)
  const child = sendPaste(pasteTargetHwnd, pasteTargetFocusHwnd)
  if (restoreClipboard) {
    let restored = false
    const restore = (): void => {
      if (restored) return
      restored = true
      clipboard.writeText(previousClipboard)
    }
    child.once('close', () => setTimeout(restore, 800))
    child.once('error', restore)
    setTimeout(restore, 5_000)
  }
}

const providerLabels: Record<Provider, string> = {
  demo: '演示模式',
  qwen: '千问 Qwen3-ASR-Flash',
  volcano: '火山引擎 BigModel ASR'
}

function historyExportContent(): { content: string; count: number } {
  const items = data.history.filter((item) => item.status === 'success' && item.text.trim())
  const generatedAt = new Date().toLocaleString('zh-CN', { hour12: false })
  const blocks = items.map((item) => [
    `## ${new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}`,
    '',
    `- 模型：${providerLabels[item.provider]}`,
    `- 时长：${Math.max(1, Math.round(item.durationMs / 1000))} 秒`,
    '',
    item.text.trim()
  ].join('\n'))
  return {
    content: `# FlowType 语音识别记录\n\n- 导出时间：${generatedAt}\n- 共 ${items.length} 条\n\n${blocks.join('\n\n---\n\n')}`,
    count: items.length
  }
}

async function exportHistory(): Promise<{ canceled: boolean; path?: string; count: number }> {
  const { content, count } = historyExportContent()
  if (!count) throw new Error('还没有可导出的成功识别记录')
  const date = new Date().toISOString().slice(0, 10)
  const options = {
    title: '导出 FlowType 语音识别记录',
    defaultPath: `FlowType-语音记录-${date}.md`,
    filters: [{ name: 'Markdown 文档', extensions: ['md'] }]
  }
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { canceled: true, count }
  writeFileSync(result.filePath, content, 'utf8')
  return { canceled: false, path: result.filePath, count }
}

function registerIpc(): void {
  ipcMain.handle('state:get', () => getState())
  ipcMain.handle('settings:save', async (_event, next: AppSettings) => {
    await mergeSettings(next)
    broadcastState()
    return getState()
  })
  ipcMain.handle('history:delete', (_event, id: string) => {
    data.history = data.history.filter((item) => item.id !== id)
    persist()
    broadcastState()
    return getState()
  })
  ipcMain.handle('history:clear', () => {
    data.history = []
    persist()
    broadcastState()
    return getState()
  })
  ipcMain.handle('history:export', exportHistory)
  ipcMain.handle('text:copy', (_event, text: string) => clipboard.writeText(text))
  ipcMain.handle('text:paste-last', () => {
    const last = data.history.find((item) => item.status === 'success')
    if (last) pasteText(last.text, false)
  })
  ipcMain.handle('recording:toggle', toggleRecording)
  ipcMain.handle('recording:cancel', cancelRecording)
  ipcMain.handle('recording:error', (_event, message: string) => {
    if (maximumRecordingTimer) clearTimeout(maximumRecordingTimer)
    maximumRecordingTimer = null
    recording = false
    pasteTargetExpected = false
    pasteTargetHwnd = 0
    pasteTargetFocusHwnd = 0
    setOverlayState({ mode: 'error', message })
    broadcastState()
    setTimeout(() => setOverlayState({ mode: 'idle' }), 2400)
  })
  ipcMain.handle('provider:test', async () => {
    if (settings.provider === 'qwen') {
      await requestQwen(silentWav(), 'audio/wav', false)
      return { ok: true, message: '千问 API Key 连接成功' }
    }
    if (settings.provider === 'volcano') {
      if (!settings.volcanoApiKey) throw new Error('请先填写火山 API Key')
      return { ok: true, message: '火山 API Key 已保存，请用一次录音验证服务权限' }
    }
    throw new Error('请先选择千问或火山识别服务')
  })
  ipcMain.handle('shortcut:capture', captureShortcut)
  ipcMain.handle('window:open-dashboard', showDashboard)
  ipcMain.handle('overlay:reset-position', () => {
    settings.overlayX = null
    settings.overlayY = null
    persist()
    positionOverlay()
  })
  ipcMain.on('overlay:drag-start', (_event, x: number, y: number) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return
    if (overlayMoveTimer) clearTimeout(overlayMoveTimer)
    overlayMoveTimer = null
    const bounds = overlayWindow.getBounds()
    overlayDragOffset = { x: x - bounds.x, y: y - bounds.y }
  })
  ipcMain.on('overlay:drag-move', (_event, x: number, y: number) => {
    if (!overlayWindow || overlayWindow.isDestroyed() || !overlayDragOffset) return
    const display = screen.getDisplayNearestPoint({ x, y })
    const workArea = display.workArea
    const width = Math.min(280, Math.max(44, settings.overlayWidth))
    const height = 51
    const nextX = Math.round(Math.min(workArea.x + workArea.width - width, Math.max(workArea.x, x - overlayDragOffset.x)))
    const nextY = Math.round(Math.min(workArea.y + workArea.height - height, Math.max(workArea.y, y - overlayDragOffset.y)))
    overlayWindow.setBounds({ x: nextX, y: nextY, width, height }, false)
  })
  ipcMain.on('overlay:drag-end', () => {
    overlayDragOffset = null
    if (overlayMoveTimer) clearTimeout(overlayMoveTimer)
    overlayMoveTimer = null
    lastProgrammaticOverlayBounds = null
    saveOverlayPosition()
  })
  ipcMain.on('audio:level', (_event, level: number) => {
    overlayWindow?.webContents.send('audio:level', level)
  })
  ipcMain.handle('audio:transcribe', async (_event, request: TranscribeRequest) => {
    try {
      const text = await transcribeAudio(request)
      const item: HistoryItem = {
        id: randomUUID(),
        text,
        createdAt: new Date().toISOString(),
        durationMs: request.durationMs,
        language: settings.language,
        provider: settings.provider,
        targetApp: '当前应用',
        status: 'success'
      }
      data.history.unshift(item)
      persist()
      setOverlayState({ mode: 'success', message: '已输入' })
      if (pasteTargetExpected) pasteText(text)
      pasteTargetExpected = false
      pasteTargetHwnd = 0
      pasteTargetFocusHwnd = 0
      broadcastState()
      setTimeout(() => setOverlayState({ mode: 'idle' }), 900)
      return { text }
    } catch (error) {
      const message = error instanceof Error ? error.message : '识别失败'
      data.history.unshift({
        id: randomUUID(),
        text: '',
        createdAt: new Date().toISOString(),
        durationMs: request.durationMs,
        language: settings.language,
        provider: settings.provider,
        targetApp: '当前应用',
        status: 'error',
        error: message
      })
      persist()
      pasteTargetExpected = false
      pasteTargetHwnd = 0
      pasteTargetFocusHwnd = 0
      setOverlayState({ mode: 'error', message })
      broadcastState()
      setTimeout(() => setOverlayState({ mode: 'idle' }), 2400)
      throw new Error(message)
    }
  })
}

app.whenReady().then(() => {
  if (!singleInstanceLock) return
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === 'media')
  loadData()
  createMainWindow()
  createOverlayWindow()
  createTray()
  registerIpc()
  void registerShortcut()
  updateLoginItemSettings()

  screen.on('display-metrics-changed', () => positionOverlay())
  screen.on('display-added', () => positionOverlay())
  screen.on('display-removed', () => positionOverlay())
})

app.on('second-instance', () => {
  showDashboard()
})

app.on('will-quit', () => {
  isQuitting = true
  stopHotkeyHook()
  shortcutCapture?.kill()
  if (overlayTopMostTimer) clearInterval(overlayTopMostTimer)
})

app.on('window-all-closed', () => undefined)
