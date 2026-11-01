/**
 * Regras sem interface da aba Materiais (porte de `ResourceContextPanel.materialsContent`):
 * agrupamento de seções de PDF e artigos das fontes favoritas por correspondência, remoção de
 * duplicados, textos de vazio e linhas de metadados. Sem Vue nem IPC, para os testes.
 */
import type { AIResearchSource } from '@pregar/core/ai'
import type {
  FavoriteSite,
  FavoriteSiteArticle,
  FavoriteSiteMatch,
  FavoriteSiteSearchGroup,
} from '@pregar/core/sources'
import type { ReaderTab, ReaderTabKind } from '@pregar/core/reader'
import type { LibrarySectionMatch } from '@shared/ipc-library'

export type MaterialFilter = 'all' | 'library' | 'sites'
export type MatchGroupId = 'exact' | 'partial' | 'context'
export type MatchTone = 'accent' | 'warning' | 'muted'

export const MATERIAL_FILTERS: { value: MaterialFilter; label: string; title: string }[] = [
  { value: 'all', label: 'Tudo', title: 'PDFs da Biblioteca e artigos das fontes favoritas' },
  { value: 'library', label: 'Biblioteca', title: 'Somente seções dos PDFs indexados' },
  { value: 'sites', label: 'Sites', title: 'Somente artigos das fontes favoritas e outras pesquisas' },
]

export const MATCH_GROUPS: { id: MatchGroupId; title: string; tone: MatchTone }[] = [
  { id: 'exact', title: 'Sobre esta passagem', tone: 'accent' },
  { id: 'partial', title: 'Sobreposição parcial', tone: 'warning' },
  { id: 'context', title: 'A confirmar', tone: 'muted' },
]

/** Atraso depois que passagem e data assentam, como a tarefa de 650 ms do app Swift. */
export const MATERIALS_SEARCH_DELAY_MS = 650

export interface PdfMaterial {
  kind: 'pdf'
  id: string
  group: MatchGroupId
  match: LibrarySectionMatch
}

export interface ArticleMaterial {
  kind: 'article'
  id: string
  group: MatchGroupId
  article: FavoriteSiteArticle
}

export type MaterialItem = PdfMaterial | ArticleMaterial

export interface MaterialGroup {
  id: MatchGroupId
  title: string
  tone: MatchTone
  items: MaterialItem[]
}

const ARTICLE_PRIORITY: Record<FavoriteSiteMatch, number> = { same: 0, contains: 1, partial: 2, context: 3 }

export function showsPDFs(filter: MaterialFilter): boolean {
  return filter !== 'sites'
}

export function showsSites(filter: MaterialFilter): boolean {
  return filter !== 'library'
}

/** "mesma passagem" e "seção maior" ficam em "Sobre esta passagem". */
export function articleGroup(match: FavoriteSiteMatch): MatchGroupId {
  if (match === 'same' || match === 'contains') return 'exact'
  return match === 'partial' ? 'partial' : 'context'
}

export function pdfMaterialId(match: LibrarySectionMatch): string {
  return `${match.recordId}|${match.section.title}|${match.section.startPage}-${match.section.endPage}`
}

/** Endereço sem fragmento e sem barra final, para reconhecer o mesmo artigo vindo de dois sites. */
export function normalizedArticleURL(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    const text = parsed.toString()
    return text.endsWith('/') ? text.slice(0, -1) : text
  } catch {
    return url.trim()
  }
}

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })

/** Seções de PDF sem repetição, por obra (ordem natural) e página inicial. */
export function sortedPdfMatches(matches: readonly LibrarySectionMatch[]): LibrarySectionMatch[] {
  const seen = new Set<string>()
  const unique: LibrarySectionMatch[] = []
  for (const match of matches) {
    const id = pdfMaterialId(match)
    if (seen.has(id)) continue
    seen.add(id)
    unique.push(match)
  }
  return unique.sort(
    (left, right) =>
      collator.compare(left.workTitle, right.workTitle) ||
      left.section.startPage - right.section.startPage ||
      collator.compare(left.section.title, right.section.title),
  )
}

/**
 * Artigos sem repetição: o mesmo endereço em dois sites fica uma vez só, com a correspondência
 * mais forte. A ordem dos sites e dos artigos (autores preferidos primeiro) é preservada.
 */
export function uniqueArticles(articles: readonly FavoriteSiteArticle[]): FavoriteSiteArticle[] {
  const best = new Map<string, FavoriteSiteArticle>()
  const order: string[] = []
  for (const article of articles) {
    const key = normalizedArticleURL(article.url)
    const current = best.get(key)
    if (!current) {
      best.set(key, article)
      order.push(key)
    } else if (ARTICLE_PRIORITY[article.match] < ARTICLE_PRIORITY[current.match]) {
      best.set(key, article)
    }
  }
  return order.map((key) => best.get(key)!)
}

export function siteArticles(
  groups: readonly FavoriteSiteSearchGroup[] | null | undefined,
): FavoriteSiteArticle[] {
  return uniqueArticles((groups ?? []).flatMap((group) => group.articles))
}

/**
 * Grupos "Sobre esta passagem", "Sobreposição parcial" e "A confirmar": PDFs primeiro, depois
 * artigos, como no app Swift. Grupos vazios (ou escondidos pelo filtro) ficam de fora.
 */
export function groupMaterials(
  pdfs: readonly LibrarySectionMatch[],
  articles: readonly FavoriteSiteArticle[],
  filter: MaterialFilter,
): MaterialGroup[] {
  const pdfItems: PdfMaterial[] = showsPDFs(filter)
    ? sortedPdfMatches(pdfs).map((match) => ({
        kind: 'pdf',
        id: `pdf:${pdfMaterialId(match)}`,
        group: match.kind,
        match,
      }))
    : []
  const articleItems: ArticleMaterial[] = showsSites(filter)
    ? uniqueArticles(articles).map((article) => ({
        kind: 'article',
        id: `web:${normalizedArticleURL(article.url)}`,
        group: articleGroup(article.match),
        article,
      }))
    : []
  return MATCH_GROUPS.map((group) => ({
    ...group,
    items: [
      ...pdfItems.filter((item) => item.group === group.id),
      ...articleItems.filter((item) => item.group === group.id),
    ],
  })).filter((group) => group.items.length > 0)
}

/** Sites sem artigo correspondente: viram "Fontes para consultar" (inclui o Working Preacher). */
export function sitesToConsult(
  groups: readonly FavoriteSiteSearchGroup[] | null | undefined,
): FavoriteSiteSearchGroup[] {
  return (groups ?? []).filter((group) => group.articles.length === 0)
}

export interface EmptyMessageInput {
  filter: MaterialFilter
  /** Obras na Biblioteca (0 = nenhum PDF importado). */
  libraryWorks: number
  favoriteSites: number
}

/** Explica por que nada apareceu: sem PDFs, sem fontes ou sem correspondência. */
export function materialsEmptyMessage({ filter, libraryWorks, favoriteSites }: EmptyMessageInput): string {
  const parts: string[] = []
  if (showsPDFs(filter)) {
    parts.push(
      libraryWorks === 0 ? 'Nenhum PDF importado ainda.' : 'Nenhum PDF indexado trata desta passagem.',
    )
  }
  if (showsSites(filter)) {
    parts.push(
      favoriteSites === 0
        ? 'Nenhuma fonte favorita cadastrada.'
        : 'Nenhum artigo das fontes favoritas corresponde a esta passagem.',
    )
  }
  return parts.join(' ')
}

/** "física 102" ou "físicas 96–101". */
export function pageRangeLabel(section: { startPage: number; endPage: number }): string {
  return section.startPage === section.endPage
    ? `física ${section.startPage}`
    : `físicas ${section.startPage}–${section.endPage}`
}

function cleanParts(parts: readonly (string | null | undefined)[]): string[] {
  return parts.map((part) => part?.trim() ?? '').filter((part) => part.length > 0)
}

export function joinParts(parts: readonly (string | null | undefined)[]): string {
  return cleanParts(parts).join(' · ')
}

export function pdfLines(match: LibrarySectionMatch): string[] {
  return cleanParts([
    joinParts([match.author, match.workTitle]),
    joinParts(['PDF', pageRangeLabel(match.section), match.section.context]),
  ])
}

/** "27/09/2026"; aceita `Date` ou texto ISO (o cache devolve datas como texto). */
export function shortDate(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : null
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`
}

/** "01/11/2026 14:05". */
export function shortDateTime(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `${shortDate(date)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** "14:05". */
export function shortTime(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function siteEditorialContext(site: Pick<FavoriteSite, 'detail' | 'tradition' | 'language'>): string {
  return joinParts([
    site.detail,
    site.tradition.trim() ? `Tradição/jurisdição: ${site.tradition.trim()}` : null,
    site.language.trim() ? `Idioma: ${site.language.trim()}` : null,
  ])
}

export function articleLines(article: FavoriteSiteArticle): string[] {
  const passage = article.passageReference
    ? article.match === 'partial' && article.overlapReference
      ? `Trecho comum: ${article.overlapReference} · material: ${article.passageReference}`
      : article.passageReference
    : null
  return cleanParts([
    joinParts([article.author, article.site.title]),
    joinParts([
      siteEditorialContext(article.site),
      shortDate(article.publishedAt as Date | string | null),
      passage,
    ]),
  ])
}

/** Metadados da pesquisa, só os presentes: nunca inferidos nem preenchidos com texto genérico. */
export function researchLines(source: AIResearchSource): string[] {
  return cleanParts([
    joinParts([
      source.author ? `Autor: ${source.author}` : null,
      source.publisher ? `Instituição: ${source.publisher}` : null,
      source.tradition ? `Tradição: ${source.tradition}` : null,
      source.language ? `Idioma: ${source.language}` : null,
    ]),
    joinParts([researchDomain(source.url), source.publishedDate]),
  ])
}

export function researchDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url
  } catch {
    return url
  }
}

/** Fontes da pesquisa sem endereços repetidos. */
export function uniqueResearchSources(sources: readonly AIResearchSource[]): AIResearchSource[] {
  const seen = new Set<string>()
  return sources.filter((source) => {
    const key = normalizedArticleURL(source.url)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export interface OpenMode {
  /** Nova aba ao fundo (botão do meio, ⌘clique no macOS, Ctrl+clique nos outros sistemas). */
  background: boolean
  /** ⇧ junto: seleciona a nova aba. */
  select: boolean
}

/** Como abrir um material a partir do clique, como `readerTabGesture` no app Swift. */
export function openModeFromEvent(
  event: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey'>,
  isMac: boolean,
): OpenMode {
  const newTab = event.button === 1 || (isMac ? event.metaKey : event.ctrlKey)
  return { background: newTab, select: newTab && event.shiftKey }
}

function normalizedLocation(kind: ReaderTabKind, location: string): string {
  if (kind === 'pdf') return location.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalizedArticleURL(location)
}

/** Aba do Leitor já aberta para este material na preparação (estado "aberto"). */
export function findReaderTab(
  tabs: readonly ReaderTab[],
  kind: ReaderTabKind,
  location: string,
  sermonDateKey: string,
): ReaderTab | undefined {
  const target = normalizedLocation(kind, location)
  return tabs.find(
    (tab) =>
      tab.kind === kind &&
      tab.sermonDateKey === sermonDateKey &&
      normalizedLocation(kind, tab.location) === target,
  )
}

export function totalItems(groups: readonly MaterialGroup[]): number {
  return groups.reduce((sum, group) => sum + group.items.length, 0)
}
