/**
 * Regras do modo ensaio (porte de `RehearsalSheet`): estimativa por palavras, faixa de 18 a 25
 * minutos lembrada no workshop, linha do tempo e nota de ritmo. Sem Vue, para os testes.
 */
import { PREACHING_WORDS_PER_MINUTE } from '@pregar/core/util/text'

export const WORDS_PER_MINUTE = PREACHING_WORDS_PER_MINUTE
export const TARGET_MINUTES = { lower: 18, upper: 25 } as const
export const REHEARSAL_FONT = { min: 14, max: 36, step: 2, fallback: 22 } as const

export function estimatedMinutes(words: number): number {
  return Math.max(0, words) / WORDS_PER_MINUTE
}

/** "07:05"; acima de uma hora continua em minutos ("75:00"), como no app Swift. */
export function elapsedLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Nota que muda com o tempo decorrido (textos do app Swift). */
export function paceNote(elapsedSeconds: number): string {
  const minutes = elapsedSeconds / 60
  if (minutes < 0.5) return 'Leia em voz alta, no ritmo do púlpito.'
  if (minutes > TARGET_MINUTES.upper) {
    return 'Passou dos 25 minutos: o workshop lembra que não ser prolixo também é cuidado.'
  }
  if (minutes >= TARGET_MINUTES.lower) return 'Dentro da faixa habitual de 18 a 25 minutos.'
  return 'Sem pressa: caminhe pelo texto guiando as pessoas.'
}

export function isOverTime(elapsedSeconds: number): boolean {
  return elapsedSeconds / 60 > TARGET_MINUTES.upper
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
export function timeline(elapsedSeconds: number, estimate: number): Timeline {
  const scaleMinutes = Math.max(TARGET_MINUTES.upper + 5, estimate + 5)
  const fraction = (minutes: number) => Math.min(1, Math.max(0, minutes / scaleMinutes))
  return {
    scaleMinutes,
    elapsed: fraction(elapsedSeconds / 60),
    bandStart: fraction(TARGET_MINUTES.lower),
    bandEnd: fraction(TARGET_MINUTES.upper),
    estimate: estimate > 0 ? fraction(estimate) : null,
  }
}

export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return REHEARSAL_FONT.fallback
  return Math.min(REHEARSAL_FONT.max, Math.max(REHEARSAL_FONT.min, Math.round(size)))
}

/** "1.272 palavras · estimativa ≈ 13 min · alvo 18 a 25 min". */
export function rehearsalSubtitle(words: number): string {
  return `${words.toLocaleString('pt-BR')} palavras · estimativa ≈ ${Math.round(estimatedMinutes(words))} min · alvo ${TARGET_MINUTES.lower} a ${TARGET_MINUTES.upper} min`
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
