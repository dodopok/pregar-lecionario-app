/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_PREGAR_API_URL?: string
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string
  readonly MAIN_VITE_DRIVE_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
