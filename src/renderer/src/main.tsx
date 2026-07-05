import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { mockApi } from './mockApi'
import { Overlay } from './Overlay'
import './styles.css'

if (!window.flowApi && !navigator.userAgent.includes('Electron')) window.flowApi = mockApi
if (!window.flowApi) throw new Error('FlowType preload 未加载，桌面功能不可用')

const isOverlay = window.location.hash.startsWith('#overlay')
if (isOverlay) document.documentElement.classList.add('overlay-document')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isOverlay ? <Overlay /> : <App />}</StrictMode>
)
