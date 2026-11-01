/// <reference types="vite/client" />
import type { PregarBridge } from '@shared/ipc'

declare global {
  interface Window {
    pregar: PregarBridge
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

export {}
