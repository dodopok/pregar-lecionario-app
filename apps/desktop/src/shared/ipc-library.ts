import type {
  PdfLibraryMetadataOverrides,
  PdfSectionComponentKind,
  PdfSectionFindingMethod,
  PdfSectionLocation,
} from '@pregar/core/library'

/** Resultado de seção de PDF que corresponde à passagem, para o painel Materiais. */
export interface LibrarySectionMatch {
  recordId: string
  path: string
  workTitle: string
  author: string | null
  section: PdfSectionLocation
  kind: 'exact' | 'partial' | 'context'
}

/** Confiança da localização da seção: bookmark (alta), cabeçalho textual (média), OCR (baixa). */
export type LibrarySectionConfidence = 'high' | 'medium' | 'low' | 'unverified'

/** Seção de uma obra, pronta para listas (Biblioteca e painel de seções do Leitor). */
export interface LibrarySectionRow {
  /** `título|página inicial`, estável entre reindexações. */
  id: string
  title: string
  context: string | null
  /** Páginas físicas, 1-based e inclusivas. */
  startPage: number
  endPage: number
  method: PdfSectionFindingMethod
  /** "bookmark do PDF", "cabeçalho textual", "cabeçalho reconhecido por OCR" ou "não identificado". */
  methodLabel: string
  confidence: LibrarySectionConfidence
  /** "alta", "média", "baixa · conferir" ou "não verificada". */
  confidenceLabel: string
  /** O título é uma referência bíblica (exibido com mais peso). */
  isReference: boolean
  /** Texto bíblico e perspectivas delimitados (Feasting). */
  components: { kind: PdfSectionComponentKind; title: string; author: string | null; startPage: number }[]
}

/** Obra da Biblioteca, sem as seções (lista à esquerda e cabeçalho do detalhe). */
export interface LibraryWork {
  /** Identificador do registro: o caminho do PDF. */
  id: string
  path: string
  /** `pregar-pdf://open/<base64url(caminho)>`, para renderizar capa e páginas do OCR. */
  pdfURL: string
  /** Título exibido (correção local ou extraído do PDF). */
  title: string
  author: string | null
  /** Autoria, editora, ano, volume, edição, idioma e cópia, na ordem do app. */
  credits: string[]
  /** Valores lidos do PDF, mostrados como sugestão na folha de correção. */
  extracted: { title: string; author: string | null }
  overrides: PdfLibraryMetadataOverrides | null
  pageCount: number
  bookmarkCount: number
  sectionCount: number
  copyLabel: string | null
  /** Páginas físicas já examinadas pelo OCR. */
  ocrPageCount: number
  /** `pregar-asset://cover/…`, ou `null` enquanto a capa não foi gerada. */
  coverURL: string | null
  /** O arquivo ainda está no caminho original. */
  available: boolean
  /** Na fila de indexação ou sendo indexada agora. */
  indexing: boolean
}

export interface LibraryStatus {
  indexing: boolean
  /** Arquivos concluídos e total do lote atual. */
  done: number
  total: number
  /** Nome do arquivo em indexação. */
  current: string | null
  /** Arquivos do lote atual que não puderam ser indexados. */
  failures: { name: string; reason: string }[]
}

export interface LibraryImportResult {
  /** PDFs aceitos e enviados à indexação. */
  queued: number
  /** Já estavam na Biblioteca. */
  alreadyInLibrary: number
  skipped: { name: string; reason: string }[]
}

export interface LibraryOcrCandidates {
  pageCount: number
  /** Páginas sem texto selecionável. */
  candidatePageCount: number
  /** Páginas físicas (1-based) a reconhecer agora: as candidatas ainda não examinadas. */
  pages: number[]
}

export interface LibraryOcrOutcome {
  /** Aviso do domínio (`ocrResultNotice`). */
  notice: string
  work: LibraryWork
}

/** Canais da Biblioteca. */
export interface LibraryInvokeChannels {
  'library:matches': { req: { reference: string }; res: LibrarySectionMatch[] }
  'library:count': { req: void; res: { works: number; sections: number } }
  /** Seções indexadas de um PDF da Biblioteca (vazio quando o caminho não está registrado). */
  'library:sectionsForPath': { req: { path: string }; res: LibrarySectionRow[] }
  /** Quantas seções coincidem com cada passagem (contagem do Arquivo). */
  'library:matchCounts': { req: { references: string[] }; res: Record<string, number> }

  'library:works': { req: void; res: LibraryWork[] }
  'library:sections': { req: { id: string }; res: LibrarySectionRow[] }
  'library:status': { req: void; res: LibraryStatus }
  /** Escolhe PDFs no diálogo do sistema e os indexa; `null` quando o diálogo é cancelado. */
  'library:import': { req: void; res: LibraryImportResult | null }
  /** Importa caminhos absolutos de PDFs já no disco (validação estrita: extensão, assinatura e tamanho). */
  'library:importPaths': { req: { paths: string[] }; res: LibraryImportResult }
  /** Reindexa uma obra, ou todas sem `id`. */
  'library:reindex': { req: { id?: string }; res: void }
  /** Remove da Biblioteca; o arquivo do usuário nunca é apagado. */
  'library:remove': { req: { id: string }; res: void }
  /** Grava a correção local de metadados; `null` volta aos dados do PDF. */
  'library:saveMetadata': { req: { id: string; metadata: PdfLibraryMetadataOverrides | null }; res: LibraryWork }
  /** Capa JPEG renderizada pela janela da Biblioteca. */
  'library:saveCover': { req: { id: string; jpeg: Uint8Array }; res: { coverURL: string } }

  'library:ocrCandidates': { req: { id: string }; res: LibraryOcrCandidates }
  /** Baixa (uma vez) os dados de idioma por/eng e devolve a pasta servida para o tesseract. */
  'library:ocrLanguages': { req: void; res: { langPath: string } }
  /** Texto reconhecido por página física; o índice só muda aqui. */
  'library:ocrApply': { req: { id: string; texts: Record<number, string> }; res: LibraryOcrOutcome }

  /** Página lembrada para a passagem neste PDF (correção feita no Leitor). */
  'library:rememberedPage': { req: { path: string; reference: string }; res: number | null }
  /** Lembra (ou esquece, com `page: null`) a página física da passagem neste PDF. */
  'library:rememberPage': { req: { path: string; reference: string; page: number | null }; res: void }
}

export interface LibraryEventChannels {
  /** O acervo mudou (importação, reindexação, metadados, capa, remoção). */
  'library:changed': { revision: number }
  'library:status': LibraryStatus
  /** Download dos dados de idioma do OCR. */
  'library:ocrDownload': { loaded: number; total: number }
}
