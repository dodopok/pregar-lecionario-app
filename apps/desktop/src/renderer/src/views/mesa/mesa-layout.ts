/**
 * Regras de layout da Mesa por largura da janela (em pixels CSS, já descontada a escala do texto).
 * Sem Vue, para os testes. Os números vêm do estudo de UX: três painéis no máximo ao lado do
 * editor, calendário atracado só a partir de 1280 px e rótulos no trilho a partir de 1100 px.
 */

export const BREAKPOINTS = {
  /** Abaixo disto o trilho fica só com ícones e os botões do cabeçalho perdem o rótulo. */
  compact: 1100,
  /** A partir disto o calendário pode ficar atracado ao lado das leituras e dos materiais. */
  wide: 1280,
} as const

export const PANEL_LIMITS = {
  calendar: { min: 220, max: 320, default: 248 },
  readings: { min: 260, max: 520, default: 360 },
  materials: { min: 280, max: 480, default: 340 },
  editorMin: 420,
  railWide: 64,
  railCompact: 48,
} as const

export interface LayoutInput {
  width: number
  focus: boolean
  calendarOpen: boolean
  readingsOpen: boolean
  materialsOpen: boolean
  widths: { calendar: number; readings: number; materials: number }
}

export interface MesaLayout {
  /** Trilho largo (ícone + rótulo) ou compacto (só ícone). */
  rail: 'wide' | 'compact'
  railWidth: number
  /** Botões do cabeçalho com rótulo de texto. */
  labels: boolean
  /** Calendário atracado à esquerda, disponível como popover do botão de data, ou escondido (foco). */
  calendar: 'docked' | 'popover' | 'hidden'
  calendarWidth: number
  /** Largura das leituras (0 = recolhidas). */
  readings: number
  readingsMax: number
  /** Materiais atracados (largura), como gaveta sobre o editor, ou recolhidos. */
  materials: 'docked' | 'drawer' | 'hidden'
  materialsWidth: number
  materialsMax: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)))

export function layoutFor(input: LayoutInput): MesaLayout {
  const compact = input.width < BREAKPOINTS.compact
  const rail: MesaLayout['rail'] = compact ? 'compact' : 'wide'
  const railWidth = compact ? PANEL_LIMITS.railCompact : PANEL_LIMITS.railWide
  const focus = input.focus
  const calendarDocked = !focus && input.calendarOpen && input.width >= BREAKPOINTS.wide
  const calendarWidth = calendarDocked
    ? clamp(input.widths.calendar, PANEL_LIMITS.calendar.min, PANEL_LIMITS.calendar.max)
    : 0
  const available = input.width - railWidth - calendarWidth - PANEL_LIMITS.editorMin
  const wantsReadings = !focus && input.readingsOpen
  const wantsMaterials = !focus && input.materialsOpen
  // Abaixo do ponto compacto, só um painel lateral divide a tela com o editor; o outro vira gaveta.
  const bothFit = !compact && available >= PANEL_LIMITS.readings.min + PANEL_LIMITS.materials.min
  const materialsMode: MesaLayout['materials'] = !wantsMaterials
    ? 'hidden'
    : wantsReadings && !bothFit
      ? 'drawer'
      : 'docked'
  const materialsReserved = materialsMode === 'docked' ? PANEL_LIMITS.materials.min : 0
  const readingsMax = Math.max(
    PANEL_LIMITS.readings.min,
    Math.min(PANEL_LIMITS.readings.max, available - materialsReserved),
  )
  const readings = wantsReadings ? clamp(input.widths.readings, PANEL_LIMITS.readings.min, readingsMax) : 0
  const materialsMax = Math.max(
    PANEL_LIMITS.materials.min,
    Math.min(PANEL_LIMITS.materials.max, available - readings),
  )
  const materialsWidth =
    materialsMode === 'docked'
      ? clamp(input.widths.materials, PANEL_LIMITS.materials.min, materialsMax)
      : materialsMode === 'drawer'
        ? clamp(
            input.widths.materials,
            PANEL_LIMITS.materials.min,
            Math.min(PANEL_LIMITS.materials.max, input.width - railWidth - 120),
          )
        : 0
  return {
    rail,
    railWidth,
    labels: !compact,
    calendar: focus ? 'hidden' : calendarDocked ? 'docked' : 'popover',
    calendarWidth,
    readings,
    readingsMax,
    materials: materialsMode,
    materialsWidth,
    materialsMax,
  }
}

/** "hoje", "amanhã", "em 6 dias", "ontem", "há 3 dias". */
export function relativeDayLabel(days: number): string {
  if (days === 0) return 'hoje'
  if (days === 1) return 'amanhã'
  if (days === -1) return 'ontem'
  if (days > 1) return `em ${days} dias`
  return `há ${Math.abs(days)} dias`
}

const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/** "Dom 8/11" para o botão de data do cabeçalho. */
export function shortDayLabel(date: Date): string {
  return `${WEEKDAY_SHORT[date.getDay()]} ${date.getDate()}/${date.getMonth() + 1}`
}

const BOOK_ABBREVIATIONS: Record<string, string> = {
  Gênesis: 'Gn',
  Êxodo: 'Êx',
  Levítico: 'Lv',
  Números: 'Nm',
  Deuteronômio: 'Dt',
  Josué: 'Js',
  Juízes: 'Jz',
  Rute: 'Rt',
  Samuel: 'Sm',
  Reis: 'Rs',
  Crônicas: 'Cr',
  Esdras: 'Ed',
  Neemias: 'Ne',
  Ester: 'Et',
  Jó: 'Jó',
  Salmo: 'Sl',
  Salmos: 'Sl',
  Provérbios: 'Pv',
  Eclesiastes: 'Ec',
  Cantares: 'Ct',
  Isaías: 'Is',
  Jeremias: 'Jr',
  Lamentações: 'Lm',
  Ezequiel: 'Ez',
  Daniel: 'Dn',
  Oseias: 'Os',
  Joel: 'Jl',
  Amós: 'Am',
  Obadias: 'Ob',
  Jonas: 'Jn',
  Miqueias: 'Mq',
  Naum: 'Na',
  Habacuque: 'Hc',
  Sofonias: 'Sf',
  Ageu: 'Ag',
  Zacarias: 'Zc',
  Malaquias: 'Ml',
  Mateus: 'Mt',
  Marcos: 'Mc',
  Lucas: 'Lc',
  João: 'Jo',
  Atos: 'At',
  Romanos: 'Rm',
  Coríntios: 'Co',
  Gálatas: 'Gl',
  Efésios: 'Ef',
  Filipenses: 'Fp',
  Colossenses: 'Cl',
  Tessalonicenses: 'Ts',
  Timóteo: 'Tm',
  Tito: 'Tt',
  Filemom: 'Fm',
  Hebreus: 'Hb',
  Tiago: 'Tg',
  Pedro: 'Pe',
  Judas: 'Jd',
  Apocalipse: 'Ap',
  Sabedoria: 'Sb',
  Eclesiástico: 'Eclo',
  Baruque: 'Br',
  Tobias: 'Tb',
  Judite: 'Jt',
  Macabeus: 'Mc',
}

/** "1 Tessalonicenses 4:13-18" → "1 Ts 4:13-18"; nomes desconhecidos ficam como estão. */
export function abbreviateReference(reference: string): string {
  const match = /^(\d\s*)?([\p{L}]+(?:\s+[\p{L}]+)*)(\s+\d.*)?$/u.exec(reference.trim())
  if (!match) return reference
  const [, ordinal, book, rest] = match
  const short = BOOK_ABBREVIATIONS[book ?? '']
  if (!short) return reference
  return `${ordinal ? `${ordinal.trim()} ` : ''}${short}${rest ?? ''}`
}

/** "Mateus 25:1-13" → "Mateus 25" (rótulo curto dos chips de navegação das leituras). */
export function chapterLabel(reference: string): string {
  const match = /^((?:\d\s*)?[\p{L}]+(?:\s+[\p{L}]+)*\s+\d+)/u.exec(reference.trim())
  return match?.[1] ?? reference
}
