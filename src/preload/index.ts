import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, AppState, FlowApi, OverlayState, TranscribeRequest } from '../shared/types'

const api: FlowApi = {
  getState: () => ipcRenderer.invoke('state:get'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings),
  deleteHistory: (id: string) => ipcRenderer.invoke('history:delete', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  copyText: (text: string) => ipcRenderer.invoke('text:copy', text),
  pasteLast: () => ipcRenderer.invoke('text:paste-last'),
  transcribe: (request: TranscribeRequest) => ipcRenderer.invoke('audio:transcribe', request),
  toggleRecording: () => ipcRenderer.invoke('recording:toggle'),
  cancelRecording: () => ipcRenderer.invoke('recording:cancel'),
  reportRecordingError: (message: string) => ipcRenderer.invoke('recording:error', message),
  testProvider: () => ipcRenderer.invoke('provider:test'),
  openDashboard: () => ipcRenderer.invoke('window:open-dashboard'),
  resetOverlayPosition: () => ipcRenderer.invoke('overlay:reset-position'),
  startOverlayDrag: (x: number, y: number) => ipcRenderer.send('overlay:drag-start', x, y),
  moveOverlayDrag: (x: number, y: number) => ipcRenderer.send('overlay:drag-move', x, y),
  endOverlayDrag: () => ipcRenderer.send('overlay:drag-end'),
  onState: (callback: (state: AppState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AppState): void => callback(state)
    ipcRenderer.on('state:changed', listener)
    return () => ipcRenderer.removeListener('state:changed', listener)
  },
  onRecordingCommand: (callback: (command: 'start' | 'stop' | 'cancel') => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: 'start' | 'stop' | 'cancel'): void =>
      callback(command)
    ipcRenderer.on('recording:command', listener)
    return () => ipcRenderer.removeListener('recording:command', listener)
  },
  onOverlayState: (callback: (state: OverlayState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: OverlayState): void => callback(state)
    ipcRenderer.on('overlay:state', listener)
    return () => ipcRenderer.removeListener('overlay:state', listener)
  },
  sendAudioLevel: (level: number) => ipcRenderer.send('audio:level', level),
  onAudioLevel: (callback: (level: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, level: number): void => callback(level)
    ipcRenderer.on('audio:level', listener)
    return () => ipcRenderer.removeListener('audio:level', listener)
  }
}

contextBridge.exposeInMainWorld('flowApi', api)
