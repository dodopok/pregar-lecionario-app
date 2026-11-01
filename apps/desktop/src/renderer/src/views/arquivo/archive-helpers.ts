/** Funções puras da janela do Arquivo: datas, rótulos de estado e de cópia, contagens e trechos. */
import type { ArchiveSearchMode, SermonPreparationState, SermonSummary } from '@shared/types'

export const SEARCH_MODES: { value: ArchiveSearchMode; label: string; placeholder: string }[] = [
  { value: 'passage', label: 'Passagem', placeholder: 'Mateus 21' },
  { value: 'occasion', label: 'Ocasião', placeholder: 'Próprio 22' },
  { value: 'date', label: 'Data', placeholder: '04/10/2026' },
  { value: 'text', label: 'Texto', placeholder: 'palavra ou frase do manuscrito' },
]

export function placeholderFor(mode: ArchiveSearchMode): string {
  return SEARCH_MODES.find((item) => item.value === mode)?.placeholder ?? ''
}

/** `2026-10-04` → `04/10/2026`, sem passar por fuso horário. */
export function formatDateKey(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : dateKey
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** `2026-10-04` → `4 de outubro de 2026` (rótulo para leitores de tela). */
export function longDate(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) return dateKey
  return `${Number(match[3])} de ${MONTHS[Number(match[2]) - 1] ?? match[2]} de ${match[1]}`
}

export const STATE_LABELS: Record<SermonPreparationState, string> = {
  empty: 'sem rascunho',
  inProgress: 'em preparação',
  exported: 'pronta para pregar',
}

/** "12 preparações", "1 preparação", "3 de 12 preparações" ou "nenhuma preparação ainda". */
export function archiveSummary(total: number, shown: number): string {
  if (total <= 0) return 'nenhuma preparação ainda'
  if (shown === total) return `${total} ${total === 1 ? 'preparação' : 'preparações'}`
  return `${shown} de ${total} preparações`
}

export function sermonTitle(summary: Pick<SermonSummary, 'title' | 'mainReadingReference'>): string {
  return summary.title.trim() !== '' ? summary.title : (summary.mainReadingReference ?? 'Preparação sem título')
}

/** Ocasião na primeira linha e tempo/celebração (quando diferente) na segunda. */
export function occasionLines(
  summary: Pick<SermonSummary, 'liturgicalOccasion' | 'liturgicalCelebration' | 'liturgicalSeason'>,
): { primary: string; context: string } {
  const primary = summary.liturgicalOccasion ?? summary.liturgicalCelebration ?? '—'
  const context = [
    summary.liturgicalSeason,
    summary.liturgicalCelebration === summary.liturgicalOccasion ? null : summary.liturgicalCelebration,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' · ')
  return { primary, context }
}

/** Rótulo da linha para leitores de tela: título, ocasião e data por extenso. */
export function archiveRowLabel(summary: SermonSummary): string {
  return [sermonTitle(summary), summary.liturgicalOccasion ?? summary.liturgicalCelebration, longDate(summary.dateKey)]
    .filter((value): value is string => Boolean(value))
    .join(', ')
}

function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()
}

/** Horário curto: "hoje, 14:32" ou "12/10, 14:32". */
export function shortTimestamp(iso: string, now = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (sameDay(date, now)) return `hoje, ${time}`
  const day = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  return `${day}, ${time}`
}

/** Cópia para o tablet ou Google Doc: rótulo e horário, ou "sem cópia". */
export function driveStatus(
  summary: Pick<SermonSummary, 'tabletPdfUpdatedAt' | 'driveSyncedAt'>,
  now = new Date(),
): { label: string; time: string | null; saved: boolean } {
  if (summary.tabletPdfUpdatedAt) return { label: 'PDF salvo', time: shortTimestamp(summary.tabletPdfUpdatedAt, now), saved: true }
  if (summary.driveSyncedAt) return { label: 'Google Doc', time: shortTimestamp(summary.driveSyncedAt, now), saved: true }
  return { label: 'sem cópia', time: null, saved: false }
}

/** Trecho da busca de texto: o banco marca a ocorrência entre « e ». */
export function snippetParts(snippet: string): { text: string; marked: boolean }[] {
  const parts: { text: string; marked: boolean }[] = []
  const pattern = /«([^»]*)»/g
  let cursor = 0
  for (const match of snippet.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > cursor) parts.push({ text: snippet.slice(cursor, start), marked: false })
    parts.push({ text: match[1] ?? '', marked: true })
    cursor = start + match[0].length
  }
  if (cursor < snippet.length) parts.push({ text: snippet.slice(cursor).replace(/[«»]/g, ''), marked: false })
  return parts.filter((part) => part.text !== '')
}

export function formatWordCount(count: number): string {
  return count.toLocaleString('pt-BR')
}

/** Referências distintas (sem vazias) para pedir as contagens de materiais de uma vez. */
export function referencesToCount(
  summaries: readonly Pick<SermonSummary, 'mainReadingReference'>[],
  known: ReadonlyMap<string, number>,
): string[] {
  const result = new Set<string>()
  for (const summary of summaries) {
    const reference = summary.mainReadingReference?.trim()
    if (reference && !known.has(reference)) result.add(reference)
  }
  return [...result]
}

/** Próximo índice na navegação por teclado da tabela. */
export function nextRowIndex(key: string, current: number, count: number, pageSize = 10): number | null {
  if (count <= 0) return null
  const moves: Record<string, number> = {
    ArrowDown: current + 1,
    ArrowUp: current - 1,
    PageDown: current + pageSize,
    PageUp: current - pageSize,
    Home: 0,
    End: count - 1,
  }
  const target = moves[key]
  return target === undefined ? null : Math.max(0, Math.min(count - 1, target))
}
