export type Provider = 'demo' | 'qwen' | 'volcano'
export type AppPage = 'overview' | 'history' | 'dictionary' | 'settings'

export interface AppSettings {
  provider: Provider
  language: 'auto' | 'zh' | 'en' | 'ja' | 'yue'
  shortcut: string
  overlayX: number | null
  overlayY: number | null
  overlayWidth: number
  launchAtStartup: boolean
  qwenApiKey: string
  volcanoApiKey: string
  volcanoAppId: string
  volcanoAccessKey: string
  dictionary: string[]
}

export interface PublicSettings extends AppSettings {
  hasQwenApiKey: boolean
  hasVolcanoApiKey: boolean
  qwenApiKey: ''
  volcanoApiKey: ''
  volcanoAccessKey: ''
}

export interface HistoryItem {
  id: string
  text: string
  createdAt: string
  durationMs: number
  language: string
  provider: Provider
  targetApp: string
  status: 'success' | 'error'
  error?: string
}

export interface AppState {
  settings: PublicSettings
  history: HistoryItem[]
  recording: boolean
  shortcutReady: boolean
}

export interface TranscribeRequest {
  audio: Uint8Array
  durationMs: number
  mimeType: string
}

export interface OverlayState {
  mode: 'idle' | 'recording' | 'processing' | 'success' | 'error'
  startedAt?: number
  message?: string
}

export interface FlowApi {
  getState: () => Promise<AppState>
  saveSettings: (settings: AppSettings) => Promise<AppState>
  deleteHistory: (id: string) => Promise<AppState>
  clearHistory: () => Promise<AppState>
  copyText: (text: string) => Promise<void>
  pasteLast: () => Promise<void>
  transcribe: (request: TranscribeRequest) => Promise<{ text: string }>
  toggleRecording: () => Promise<void>
  cancelRecording: () => Promise<void>
  reportRecordingError: (message: string) => Promise<void>
  testProvider: () => Promise<{ ok: boolean; message: string }>
  openDashboard: () => Promise<void>
  resetOverlayPosition: () => Promise<void>
  startOverlayDrag: (x: number, y: number) => void
  moveOverlayDrag: (x: number, y: number) => void
  endOverlayDrag: () => void
  onState: (callback: (state: AppState) => void) => () => void
  onRecordingCommand: (callback: (command: 'start' | 'stop' | 'cancel') => void) => () => void
  onOverlayState: (callback: (state: OverlayState) => void) => () => void
  sendAudioLevel: (level: number) => void
  onAudioLevel: (callback: (level: number) => void) => () => void
}
