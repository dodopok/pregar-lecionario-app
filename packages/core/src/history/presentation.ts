/**
 * Regras sem interface da folha de histórico e da comparação lado a lado (SermonHistorySheet,
 * SermonRevisionComparisonSheet e o botão `vN · histórico` da Mesa). Textos copiados do Swift.
 */
import { snapshotsMatch } from './model'
import type { SermonRevision, SermonRevisionSnapshot } from './model'

export const HISTORY_TEXT = {
  sheetTitle: 'Histórico deste sermão',
  sheetSubtitle: 'Cada versão é recuperável. Restaurar cria uma versão nova; nada se perde.',
  alertTitle: 'Histórico de sermões',
  currentEdit: 'Edição em curso',
  compareTitle: 'Comparar versões',
  compare: 'Comparar',
  restore: 'Restaurar',
  emptyVersion: 'Esta versão não contém texto.',
  buttonHelp: 'Abrir histórico recuperável deste sermão (⇧⌥⌘H)',
} as const

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export const historyMessages = {
  openFailed: (error: unknown) => `Não foi possível abrir o histórico: ${describeError(error)}`,
  loadFailed: (error: unknown) => `Não foi possível carregar o histórico: ${describeError(error)}`,
  saveFailed: (error: unknown) => `Não foi possível salvar uma versão local: ${describeError(error)}`,
  restoreFailed: (error: unknown) => `Não foi possível restaurar esta versão: ${describeError(error)}`,
}

export function versionLabel(version: number): string {
  return `v${version}`
}

/** Rótulo do botão na barra de status: "v3 · histórico". */
export function historyButtonLabel(version: number): string {
  return `${versionLabel(version)} · histórico`
}

export function wordCountLabel(wordCount: number): string {
  return `${wordCount.toLocaleString('pt-BR')} palavras`
}

/** A edição atual difere da última versão gravada (sem revisões, não há o que salvar). */
export function isHistoryDirty(
  revisions: readonly SermonRevision[],
  current: SermonRevisionSnapshot,
): boolean {
  const latest = revisions.at(-1)
  return latest ? !snapshotsMatch(latest, current) : false
}

/**
 * Número da edição em curso: o da última versão quando ela coincide com o rascunho, senão o
 * seguinte. Sem histórico, v1.
 */
export function currentVersionNumber(
  revisions: readonly SermonRevision[],
  current: SermonRevisionSnapshot,
): number {
  const latest = revisions.at(-1)
  if (!latest) return 1
  return snapshotsMatch(latest, current) ? latest.version : latest.version + 1
}

/**
 * Número exibido no botão da Mesa, que acompanha o estado "sujo" mantido pelo agendador.
 * Igual a `max(1, última + (sujo ? 1 : 0))`.
 */
export function statusBarVersionNumber(revisions: readonly SermonRevision[], dirty: boolean): number {
  return Math.max(1, (revisions.at(-1)?.version ?? 0) + (dirty ? 1 : 0))
}

/**
 * Versões anteriores, da mais nova para a mais antiga, sem a última quando ela já é a própria
 * edição em curso (exibida na primeira linha).
 */
export function previousRevisions(
  revisions: readonly SermonRevision[],
  current: SermonRevisionSnapshot,
): SermonRevision[] {
  const latest = revisions.at(-1)
  return [...revisions]
    .reverse()
    .filter((revision) => !(revision.id === latest?.id && snapshotsMatch(revision, current)))
}

export interface ComparisonColumn {
  title: string
  /** Texto a exibir; vazio vira "Esta versão não contém texto.". */
  text: string
  isEmpty: boolean
}

/**
 * Colunas da comparação lado a lado: edição atual à esquerda, versão escolhida à direita.
 * `plainTextOf` permite extrair o texto de snapshots RTF herdados sem texto simples gravado.
 */
export function comparisonColumns(
  current: SermonRevisionSnapshot,
  currentVersion: number,
  previous: SermonRevision,
  plainTextOf: (snapshot: SermonRevisionSnapshot) => string = (snapshot) => snapshot.plainText,
): [ComparisonColumn, ComparisonColumn] {
  return [
    column(`${versionLabel(currentVersion)} · edição atual`, plainTextOf(current)),
    column(`${versionLabel(previous.version)} · ${previous.summary}`, plainTextOf(previous)),
  ]
}

function column(title: string, text: string): ComparisonColumn {
  const isEmpty = text.length === 0
  return { title, text: isEmpty ? HISTORY_TEXT.emptyVersion : text, isEmpty }
}
