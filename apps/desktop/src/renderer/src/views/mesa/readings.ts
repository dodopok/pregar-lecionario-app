/**
 * Regras sem interface do painel de leituras e da leitura em tela cheia: poesia (salmos) com
 * recuo pendente, prosa com números sobrescritos, chips de navegação e o HTML de impressão.
 */
import type { BiblePassageText, LiturgicalDay, LiturgicalReading } from '@pregar/core/liturgy/types'
import { readingId, readingLabel } from '@pregar/core/liturgy/types'
import { abbreviateReference, chapterLabel } from './mesa-layout'

export interface PoetryLine {
  /** Número do versículo só na primeira linha dele. */
  number: number | null
  text: string
  /** Nível de recuo (0 ou 1) deduzido dos espaços iniciais do texto da API. */
  indent: 0 | 1
}

export interface ProseRun {
  number: number
  text: string
}

/** Poesia quando algum versículo traz quebras de linha (como os salmos na Estêvão API). */
export function isPoetry(text: BiblePassageText | null | undefined): boolean {
  return Boolean(text?.verses?.some((verse) => verse.text.includes('\n')))
}

export function poetryLines(text: BiblePassageText | null | undefined): PoetryLine[] {
  const lines: PoetryLine[] = []
  for (const verse of text?.verses ?? []) {
    const parts = verse.text
      .split('\n')
      .map((part) => part.replace(/\s+$/, ''))
      .filter((part) => part.trim().length > 0)
    parts.forEach((part, index) => {
      lines.push({
        number: index === 0 ? verse.number : null,
        text: part.trim(),
        indent: /^\s{2,}/.test(part) ? 1 : 0,
      })
    })
  }
  return lines
}

export function proseRuns(text: BiblePassageText | null | undefined): ProseRun[] {
  return (text?.verses ?? []).map((verse) => ({
    number: verse.number,
    text: verse.text.replace(/\s+/g, ' ').trim(),
  }))
}

/** Texto corrido (sem versículos) em parágrafos. */
export function contentParagraphs(content: string | null | undefined): string[] {
  return (content ?? '')
    .split(/\n{2,}|\r\n\r\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

export function readingAnchor(reading: Pick<LiturgicalReading, 'slot' | 'reference'>): string {
  return `reading-${readingId(reading)
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .toLowerCase()}`
}

/** Rótulo do chip de navegação: "Mateus 25" largo, "Mt 25" estreito. */
export function readingChipLabel(reading: Pick<LiturgicalReading, 'reference'>, compact: boolean): string {
  const chapter = chapterLabel(reading.reference)
  return compact ? abbreviateReference(chapter) : chapter
}

export interface ReadingIndexEntry {
  id: string
  label: string
  title: string
  kind: 'collect' | 'reading' | 'celebrations'
  reading?: LiturgicalReading
}

/** Itens do índice (chips do painel e lista da tela cheia). */
export function readingIndex(day: LiturgicalDay | null, compact: boolean): ReadingIndexEntry[] {
  if (!day) return []
  const entries: ReadingIndexEntry[] = []
  if ((day.collect ?? []).some((collect) => collect.text?.trim())) {
    entries.push({ id: 'reading-collect', label: 'Coleta', title: 'Coleta do dia', kind: 'collect' })
  }
  for (const reading of day.readings ?? []) {
    entries.push({
      id: readingAnchor(reading),
      label: readingChipLabel(reading, compact),
      title: `${readingLabel(reading)}: ${reading.reference}`,
      kind: 'reading',
      reading,
    })
  }
  return entries
}

function escapeHTML(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Página autônoma com as leituras do dia, para o diálogo de impressão. */
export function readingsPrintHtml(
  day: LiturgicalDay,
  options: {
    title: string
    subtitle: string
    bible: string
    texts?: Record<string, BiblePassageText | null | undefined>
  },
): string {
  const parts: string[] = []
  parts.push(`<h1>${escapeHTML(options.title)}</h1>`)
  if (options.subtitle) parts.push(`<p class="sub">${escapeHTML(options.subtitle)}</p>`)
  for (const collect of day.collect ?? []) {
    if (!collect.text?.trim()) continue
    parts.push(
      `<section><p class="eyebrow">${escapeHTML(collect.title ? `Coleta · ${collect.title}` : 'Coleta do dia')}</p><p class="collect">${escapeHTML(collect.text)}</p></section>`,
    )
  }
  for (const reading of day.readings ?? []) {
    const text = options.texts?.[readingId(reading)] ?? reading.text
    parts.push(
      `<section><p class="eyebrow">${escapeHTML(readingLabel(reading))}</p><h2>${escapeHTML(reading.reference)}</h2>`,
    )
    if (isPoetry(text)) {
      parts.push('<div class="poem">')
      for (const line of poetryLines(text)) {
        parts.push(
          `<p class="line${line.indent ? ' line--in' : ''}">${line.number !== null ? `<sup>${line.number}</sup>` : ''}${escapeHTML(line.text)}</p>`,
        )
      }
      parts.push('</div>')
    } else if (text?.verses?.length) {
      parts.push(
        `<p>${proseRuns(text)
          .map((run) => `<sup>${run.number}</sup>${escapeHTML(run.text)}`)
          .join(' ')}</p>`,
      )
    } else if (text?.content) {
      parts.push(
        contentParagraphs(text.content)
          .map((paragraph) => `<p>${escapeHTML(paragraph)}</p>`)
          .join(''),
      )
    } else {
      parts.push('<p class="muted">Texto não disponível nesta tradução.</p>')
    }
    parts.push('</section>')
  }
  parts.push(`<p class="muted small">Tradução: ${escapeHTML(options.bible.toUpperCase())}</p>`)
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHTML(options.title)}</title><style>
    @page { size: A4; margin: 18mm 20mm; }
    body { font-family: 'Iowan Old Style', 'New York', Charter, Georgia, serif; font-size: 12.5pt; line-height: 1.55; color: #1f1d19; max-width: 170mm; margin: 0 auto; }
    h1 { font-size: 20pt; margin: 0 0 2pt; } h2 { font-size: 15pt; margin: 0 0 8pt; }
    .sub { margin: 0 0 18pt; color: #555; font-family: system-ui, sans-serif; font-size: 10pt; }
    .eyebrow { margin: 16pt 0 2pt; font-family: system-ui, sans-serif; font-size: 8.5pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #666; }
    section { break-inside: avoid-page; }
    p { margin: 0 0 8pt; } sup { font-family: system-ui, sans-serif; font-size: 7.5pt; font-weight: 700; color: #2e7a51; margin-right: 2pt; }
    .poem .line { margin: 0; padding-left: 16pt; text-indent: -16pt; } .poem .line--in { padding-left: 30pt; }
    .collect { font-style: italic; }
    .muted { color: #777; } .small { font-family: system-ui, sans-serif; font-size: 9pt; margin-top: 18pt; }
  </style></head><body>${parts.join('')}</body></html>`
}
