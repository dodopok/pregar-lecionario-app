import type { AIProviderId } from './types'

export type AppearanceMode = 'system' | 'light' | 'dark'

/** Como o painel de leituras mostra o dia: todas as leituras abertas ou só a passagem principal. */
export type ReadingsView = 'all' | 'main'

export interface PanelLayout {
  calendarOpen: boolean
  readingsOpen: boolean
  materialsOpen: boolean
  calendarWidth: number
  readingsWidth: number
  materialsWidth: number
  focusMode: boolean
  readingsView: ReadingsView
}

/** Ritmo pessoal de preparação e de pregação (Preferências › Ritmo e duração). */
export interface RhythmSettings {
  /** Dia da semana em que normalmente prega (0 = domingo … 6 = sábado). */
  preachingDay: number
  /** Outros dias habituais de pregação (0–6), por exemplo quarta e sábado. */
  extraDays: number[]
  /** Duração alvo do sermão, em minutos. */
  targetMinutes: number
  /** Ritmo de fala em palavras por minuto; o Ensaio pode medir e atualizar. */
  wordsPerMinute: number
  /** Data ISO da última medição no Ensaio; nulo enquanto vale o padrão. */
  measuredAt: string | null
  /** O Ensaio atualiza o ritmo sozinho ao fim de uma leitura cronometrada. */
  autoUpdate: boolean
  /** Mostrar a estimativa em páginas ao lado dos minutos. */
  showPages: boolean
  /** Cartão do ritmo da semana (o que fazer em cada dia) no Calendário. */
  weekTips: boolean
}

/** Em que dia a Mesa abre ao iniciar o app. */
export type MesaOpenOn = 'next-preaching-day' | 'last-open'

export interface AppSettings {
  appearance: AppearanceMode
  /** Escala do texto da interface (1 = padrão). Aplicada a todas as janelas. */
  textScale: number
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
  rhythm: RhythmSettings
  mesa: {
    openOn: MesaOpenOn
    /** Última preparação aberta, para `openOn: 'last-open'`. */
    lastDateKey: string | null
  }
  materials: {
    /** Mostrar só materiais em português na aba Materiais. */
    onlyPortuguese: boolean
  }
  ideas: {
    /** Além das ideias locais, sincronizar com a pasta do Google Drive. */
    driveSync: boolean
  }
  panels: PanelLayout
  onboarding: {
    completed: boolean
    path: 'pro' | 'byok' | 'later' | null
    mesaTipDismissed: boolean
    /** O tour da primeira abertura foi concluído ou pulado. */
    tourDone: boolean
    /** O aviso de degustação (sem conta) foi fechado nesta instalação. */
    previewNoticeDismissed: boolean
  }
  /** Endereço da API do Pregar (assinatura). Alterável só em Preferências avançadas. */
  apiBaseURL: string
  updates: { automatic: boolean }
}

export const DEFAULT_SETTINGS: AppSettings = {
  appearance: 'system',
  textScale: 1,
  liturgy: { prayerBook: 'loc_2027', language: 'pt-BR', bible: 'nvt', readingType: '', comparisonBibles: [], lastColor: null },
  ai: {
    reviewProvider: 'anthropic',
    reviewModel: 'claude-sonnet-5-5',
    researchProvider: 'perplexity',
    researchModel: 'perplexity/sonar',
    preferOwnKeys: false,
  },
  tablet: { fontFamily: 'Georgia', fontSize: 18, includeNotes: true, format: 'pdf', lastExportFolder: null },
  editor: { zoom: 1.2, showRuler: true, spellcheck: true },
  rehearsal: { fontSize: 22 },
  rhythm: {
    preachingDay: 0,
    extraDays: [],
    targetMinutes: 20,
    wordsPerMinute: 96,
    measuredAt: null,
    autoUpdate: true,
    showPages: false,
    weekTips: true,
  },
  mesa: { openOn: 'next-preaching-day', lastDateKey: null },
  materials: { onlyPortuguese: false },
  ideas: { driveSync: false },
  panels: {
    calendarOpen: true,
    readingsOpen: true,
    materialsOpen: true,
    calendarWidth: 248,
    readingsWidth: 360,
    materialsWidth: 340,
    focusMode: false,
    readingsView: 'all',
  },
  onboarding: { completed: false, path: null, mesaTipDismissed: false, tourDone: false, previewNoticeDismissed: false },
  apiBaseURL: '',
  updates: { automatic: true },
}

/** Escalas de texto oferecidas em Preferências › Aparência e texto. */
export const TEXT_SCALES: { value: number; label: string }[] = [
  { value: 0.9, label: 'Menor' },
  { value: 1, label: 'Padrão' },
  { value: 1.1, label: 'Maior' },
  { value: 1.25, label: 'Grande' },
  { value: 1.4, label: 'Muito grande' },
]

/** Dias de pregação em ordem cronológica a partir da configuração (sem repetições). */
export function preachingDays(rhythm: Pick<RhythmSettings, 'preachingDay' | 'extraDays'>): number[] {
  const days = new Set<number>([rhythm.preachingDay, ...rhythm.extraDays].map((day) => ((day % 7) + 7) % 7))
  return [...days].sort((a, b) => a - b)
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
