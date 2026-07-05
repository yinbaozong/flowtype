/// <reference types="vite/client" />

import type { FlowApi } from '../../shared/types'

declare global {
  interface Window {
    flowApi: FlowApi
  }
}
