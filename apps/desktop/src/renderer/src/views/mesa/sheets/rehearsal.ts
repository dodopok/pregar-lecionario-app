/**
 * Regras do modo ensaio (porte de `RehearsalSheet`): estimativa por palavras, faixa de 18 a 25
 * minutos lembrada no workshop, linha do tempo e nota de ritmo. Sem Vue, para os testes.
 */
import { PREACHING_WORDS_PER_MINUTE } from '@pregar/core/util/text'

export const WORDS_PER_MINUTE = PREACHING_WORDS_PER_MINUTE
export const TARGET_MINUTES = { lower: 18, upper: 25 } as const
export const REHEARSAL_FONT = { min: 14, max: 36, step: 2, fallback: 22 } as const
/** Velocidades da rolagem automática (1 = o ritmo estimado). */
export const SCROLL_SPEEDS = [0.6, 0.8, 1, 1.25, 1.5] as const

export interface TargetBand {
  lower: number
  upper: number
}

/** Faixa em torno da meta pessoal (Preferências › Ritmo): 2 minutos antes, 5 depois. */
export function targetBand(targetMinutes: number): TargetBand {
  const target = Number.isFinite(targetMinutes) && targetMinutes > 0 ? Math.round(targetMinutes) : 20
  return { lower: Math.max(1, target - 2), upper: target + 5 }
}

export function estimatedMinutes(words: number, wordsPerMinute: number = WORDS_PER_MINUTE): number {
  const rate = Number.isFinite(wordsPerMinute) && wordsPerMinute > 0 ? wordsPerMinute : WORDS_PER_MINUTE
  return Math.max(0, words) / rate
}

export interface RehearsalBlock {
  kind: 'heading' | 'paragraph' | 'quote'
  text: string
  /** Nível do título (1–3) para as marcas da lateral. */
  level?: number
}

interface JsonNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  content?: JsonNode[]
}

function nodeText(node: JsonNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  return (node.content ?? []).map(nodeText).join('')
}

/**
 * Blocos do manuscrito para o ensaio, na ordem: títulos viram marcas, citações ficam marcadas e
 * anotações do pregador (nó `annotation`) ficam de fora, como no púlpito.
 */
export function rehearsalBlocks(json: unknown): RehearsalBlock[] {
  const root = json as JsonNode | null
  const blocks: RehearsalBlock[] = []
  const visit = (node: JsonNode, insideQuote: boolean) => {
    if (!node || node.type === 'annotation' || node.type === 'footnote') return
    if (node.type === 'heading') {
      const text = nodeText(node).trim()
      if (text) blocks.push({ kind: 'heading', text, level: Number(node.attrs?.level ?? 2) })
      return
    }
    if (node.type === 'paragraph') {
      const text = nodeText(node).replace(/\s+/g, ' ').trim()
      if (text) blocks.push({ kind: insideQuote ? 'quote' : 'paragraph', text })
      return
    }
    for (const child of node.content ?? []) visit(child, insideQuote || node.type === 'blockquote')
  }
  if (root) visit(root, false)
  return blocks
}

/** Blocos a partir do texto corrido salvo (sem editor aberto). */
export function rehearsalBlocksFromText(text: string): RehearsalBlock[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ kind: 'paragraph' as const, text: line }))
}

/** "07:05"; acima de uma hora continua em minutos ("75:00"), como no app Swift. */
export function elapsedLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Nota que muda com o tempo decorrido (textos do app Swift), em torno da faixa dada. */
export function paceNote(elapsedSeconds: number, band: TargetBand = TARGET_MINUTES): string {
  const minutes = elapsedSeconds / 60
  if (minutes < 0.5) return 'Leia em voz alta, no ritmo do púlpito.'
  if (minutes > band.upper) {
    return `Passou dos ${band.upper} minutos: o workshop lembra que não ser prolixo também é cuidado.`
  }
  if (minutes >= band.lower) return `Dentro da faixa habitual de ${band.lower} a ${band.upper} minutos.`
  return 'Sem pressa: caminhe pelo texto guiando as pessoas.'
}

export function isOverTime(elapsedSeconds: number, band: TargetBand = TARGET_MINUTES): boolean {
  return elapsedSeconds / 60 > band.upper
}

export interface Timeline {
  /** Minutos representados pela barra inteira. */
  scaleMinutes: number
  /** Preenchimento do tempo decorrido (0 a 1). */
  elapsed: number
  /** Início e fim da faixa de 18 a 25 minutos (0 a 1). */
  bandStart: number
  bandEnd: number
  /** Marca da estimativa por palavras (0 a 1), ou `null` sem texto. */
  estimate: number | null
}

/**
 * A escala cobre a faixa com 5 minutos de folga, ou a estimativa mais 5 se o texto for mais longo;
 * o preenchimento e a marca nunca passam do fim da barra.
 */
export function timeline(
  elapsedSeconds: number,
  estimate: number,
  band: TargetBand = TARGET_MINUTES,
): Timeline {
  const scaleMinutes = Math.max(band.upper + 5, estimate + 5)
  const fraction = (minutes: number) => Math.min(1, Math.max(0, minutes / scaleMinutes))
  return {
    scaleMinutes,
    elapsed: fraction(elapsedSeconds / 60),
    bandStart: fraction(band.lower),
    bandEnd: fraction(band.upper),
    estimate: estimate > 0 ? fraction(estimate) : null,
  }
}

export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return REHEARSAL_FONT.fallback
  return Math.min(REHEARSAL_FONT.max, Math.max(REHEARSAL_FONT.min, Math.round(size)))
}

/** "1.272 palavras · estimativa ≈ 13 min · alvo 18 a 25 min". */
export function rehearsalSubtitle(
  words: number,
  band: TargetBand = TARGET_MINUTES,
  wordsPerMinute: number = WORDS_PER_MINUTE,
): string {
  return `${words.toLocaleString('pt-BR')} palavras · estimativa ≈ ${Math.round(estimatedMinutes(words, wordsPerMinute))} min · alvo ${band.lower} a ${band.upper} min`
}

/** Rótulo do botão do cronômetro. */
export function toggleLabel(running: boolean, elapsedSeconds: number): string {
  if (running) return 'Pausar'
  return elapsedSeconds > 0 ? 'Continuar' : 'Iniciar'
}

/**
 * Cronômetro que soma os trechos em que esteve rodando. O relógio é injetado para os testes.
 */
export class Stopwatch {
  private startedAt: number | null = null
  private accumulated = 0

  constructor(private readonly now: () => number = () => Date.now()) {}

  get running(): boolean {
    return this.startedAt !== null
  }

  /** Segundos decorridos. */
  elapsed(): number {
    const live = this.startedAt === null ? 0 : this.now() - this.startedAt
    return (this.accumulated + live) / 1000
  }

  toggle(): void {
    if (this.startedAt === null) {
      this.startedAt = this.now()
    } else {
      this.accumulated += this.now() - this.startedAt
      this.startedAt = null
    }
  }

  reset(): void {
    this.startedAt = null
    this.accumulated = 0
  }
}
