import type { AppState, FlowApi, HistoryItem, OverlayState } from '../../shared/types'

const now = new Date()
const sampleHistory: HistoryItem[] = [
  {
    id: 'sample-1',
    text: '实现一个语音输入工具，支持快捷键、悬浮波形和本地统计看板。',
    createdAt: now.toISOString(),
    durationMs: 86_000,
    language: 'auto',
    provider: 'qwen',
    targetApp: '当前应用',
    status: 'success'
  },
  {
    id: 'sample-2',
    text: '今天的会议讨论了产品路线图和下一阶段的交付计划。',
    createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    durationMs: 54_000,
    language: 'zh',
    provider: 'volcano',
    targetApp: '当前应用',
    status: 'success'
  }
]

let state: AppState = {
  settings: {
    provider: 'demo',
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
    dictionary: ['MakerWorld', 'FlowType'],
    hasQwenApiKey: false,
    hasVolcanoApiKey: false
  },
  history: sampleHistory,
  recording: false,
  shortcutReady: true
}

const stateListeners = new Set<(value: AppState) => void>()
const overlayListeners = new Set<(value: OverlayState) => void>()
const levelListeners = new Set<(value: number) => void>()
const emitState = (): void => stateListeners.forEach((listener) => listener(state))

export const mockApi: FlowApi = {
  getState: async () => state,
  saveSettings: async (settings) => {
    state = {
      ...state,
      settings: {
        ...state.settings,
        ...settings,
        qwenApiKey: '',
        volcanoApiKey: '',
        volcanoAccessKey: '',
        hasQwenApiKey: Boolean(settings.qwenApiKey) || state.settings.hasQwenApiKey,
        hasVolcanoApiKey: Boolean(settings.volcanoApiKey) || state.settings.hasVolcanoApiKey
      }
    }
    emitState()
    return state
  },
  deleteHistory: async (id) => {
    state = { ...state, history: state.history.filter((item) => item.id !== id) }
    emitState()
    return state
  },
  clearHistory: async () => {
    state = { ...state, history: [] }
    emitState()
    return state
  },
  copyText: async () => undefined,
  pasteLast: async () => undefined,
  transcribe: async () => ({ text: '浏览器预览识别文本' }),
  toggleRecording: async () => {
    state = { ...state, recording: !state.recording }
    emitState()
    overlayListeners.forEach((listener) =>
      listener(state.recording ? { mode: 'recording', message: '正在聆听' } : { mode: 'processing', message: '正在识别' })
    )
  },
  cancelRecording: async () => undefined,
  reportRecordingError: async () => undefined,
  testProvider: async () => ({ ok: true, message: '连接成功' }),
  openDashboard: async () => undefined,
  resetOverlayPosition: async () => undefined,
  startOverlayDrag: () => undefined,
  moveOverlayDrag: () => undefined,
  endOverlayDrag: () => undefined,
  onState: (callback) => {
    stateListeners.add(callback)
    return () => stateListeners.delete(callback)
  },
  onRecordingCommand: () => () => undefined,
  onOverlayState: (callback) => {
    overlayListeners.add(callback)
    return () => overlayListeners.delete(callback)
  },
  sendAudioLevel: (level) => levelListeners.forEach((listener) => listener(level)),
  onAudioLevel: (callback) => {
    levelListeners.add(callback)
    return () => levelListeners.delete(callback)
  }
}
