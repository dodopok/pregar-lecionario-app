import type { AIProviderId } from './types'

export type AppearanceMode = 'system' | 'light' | 'dark'

export interface PanelLayout {
  calendarOpen: boolean
  readingsOpen: boolean
  materialsOpen: boolean
  calendarWidth: number
  readingsWidth: number
  materialsWidth: number
  focusMode: boolean
}

export interface AppSettings {
  appearance: AppearanceMode
  liturgy: {
    prayerBook: string
    language: string
    bible: string
    readingType: string
    comparisonBibles: string[]
    /** Cor litúrgica do dia aberto na Mesa; todas as janelas usam o mesmo acento. */
    lastColor: string | null
  }
  ai: {
    reviewProvider: AIProviderId
    reviewModel: string
    researchProvider: AIProviderId
    researchModel: string
    /** Mesmo com assinatura, usar as chaves próprias. */
    preferOwnKeys: boolean
  }
  tablet: {
    fontFamily: string
    fontSize: number
    includeNotes: boolean
    format: 'pdf' | 'gdoc'
    lastExportFolder: string | null
  }
  editor: { zoom: number; showRuler: boolean; spellcheck: boolean }
  rehearsal: { fontSize: number }
  panels: PanelLayout
  onboarding: { completed: boolean; path: 'pro' | 'byok' | 'later' | null; mesaTipDismissed: boolean }
  /** Endereço da API do Pregar (assinatura). Alterável só em Preferências avançadas. */
  apiBaseURL: string
  updates: { automatic: boolean }
}

export const DEFAULT_SETTINGS: AppSettings = {
  appearance: 'system',
  liturgy: { prayerBook: 'loc_2027', language: 'pt-BR', bible: 'nvt', readingType: '', comparisonBibles: [], lastColor: null },
  ai: {
    reviewProvider: 'anthropic',
    reviewModel: 'claude-sonnet-5-5',
    researchProvider: 'perplexity',
    researchModel: 'perplexity/sonar',
    preferOwnKeys: false,
  },
  tablet: { fontFamily: 'Georgia', fontSize: 18, includeNotes: true, format: 'pdf', lastExportFolder: null },
  editor: { zoom: 1, showRuler: true, spellcheck: true },
  rehearsal: { fontSize: 22 },
  panels: {
    calendarOpen: true,
    readingsOpen: true,
    materialsOpen: true,
    calendarWidth: 248,
    readingsWidth: 340,
    materialsWidth: 360,
    focusMode: false,
  },
  onboarding: { completed: false, path: null, mesaTipDismissed: false },
  apiBaseURL: '',
  updates: { automatic: true },
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] }
export type SettingsPatch = DeepPartial<AppSettings>

export function mergeSettings(base: AppSettings, patch: SettingsPatch): AppSettings {
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const current = (base as unknown as Record<string, unknown>)[key]
    if (value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object') {
      result[key] = { ...(current as object), ...(value as object) }
    } else if (value !== undefined) {
      result[key] = value
    }
  }
  return result as unknown as AppSettings
}
