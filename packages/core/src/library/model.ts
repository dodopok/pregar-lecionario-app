/**
 * Tipos persistidos do índice de PDFs. Os nomes dos campos seguem o JSON gravado pelo app Swift
 * (`pregar.library.records.v1`): campos ausentes equivalem a `nil` e são omitidos ao gravar.
 */

export type PdfSectionComponentKind =
  'biblicalText' | 'theological' | 'pastoral' | 'exegetical' | 'homiletical'

export const PDF_SECTION_COMPONENT_KINDS: readonly PdfSectionComponentKind[] = [
  'biblicalText',
  'theological',
  'pastoral',
  'exegetical',
  'homiletical',
]

/** Como a seção foi localizada: bookmark (alta), cabeçalho textual (média), OCR (baixa) ou desconhecido. */
export type PdfSectionFindingMethod = 'bookmark' | 'textHeading' | 'ocrHeading' | 'unknown'

export const PDF_SECTION_FINDING_METHODS: readonly PdfSectionFindingMethod[] = [
  'bookmark',
  'textHeading',
  'ocrHeading',
  'unknown',
]

/** Posição dentro de uma página física (1-based), em unidades UTF-16 do texto da página. */
export interface PdfTextPosition {
  page: number
  utf16Offset: number
}

export interface PdfTextSpan {
  start: PdfTextPosition
  end: PdfTextPosition
}

/** Parte delimitada de uma seção (texto bíblico e perspectivas do Feasting). */
export interface PdfSectionComponent {
  kind: PdfSectionComponentKind
  title: string
  /** Assinatura do ensaio, em versais, quando encontrada. */
  author?: string
  /** Do cabeçalho do componente até o início do próximo. */
  location: PdfTextSpan
  /** Só o corpo: sem o cabeçalho e sem a linha do autor. */
  content: PdfTextSpan
}

/** Seção de uma obra com intervalo de páginas físicas (1-based, inclusivo). */
export interface PdfSectionLocation {
  title: string
  startPage: number
  endPage: number
  /** Título do bookmark pai (por exemplo, o domingo litúrgico). */
  context?: string
  components?: PdfSectionComponent[]
  /** Ausente em registros antigos, gravados antes de a origem ser registrada. */
  findingMethod?: PdfSectionFindingMethod
}

/** Correção local de metadados; sobrevive à reindexação e não altera o PDF. */
export interface PdfLibraryMetadataOverrides {
  title: string
  author: string
  publisher: string
  year: string
  volume: string
  edition: string
  language: string
}

export interface PdfLibraryRecord {
  /** Caminho do arquivo (também usado como identificador). */
  id: string
  /** Título extraído do PDF; a correção do usuário fica em `metadataOverrides`. */
  title: string
  path: string
  pageCount: number
  bookmarkCount: number
  author?: string
  /** Miniatura JPEG da capa em base64 (`Data` no Swift). */
  coverJPEG?: string
  sections?: PdfSectionLocation[]
  indexVersion?: number
  /** "Cópia 2" quando o nome do arquivo termina em " (1)". */
  copyLabel?: string
  metadataOverrides?: PdfLibraryMetadataOverrides
  /** Páginas físicas já examinadas pelo OCR. */
  ocrPageNumbers?: number[]
  /** Texto reconhecido por página física. No JSON, as chaves são números em texto ("1"). */
  ocrTextByPage?: Record<number, string>
  fileSizeBytes?: number
  /** Data de modificação em segundos desde 2001-01-01 UTC (codificação padrão de `Date` no Swift). */
  fileModificationDate?: number
}

export interface PdfLibraryOcrResult {
  record: PdfLibraryRecord
  /** Páginas sem texto selecionável. */
  candidatePageCount: number
  /** Páginas examinadas nesta execução (as já examinadas antes ficam de fora). */
  scannedPageCount: number
  recognizedTextPageCount: number
  /** Novas seções em relação ao índice anterior. */
  sectionsFound: number
}

/** Diferença entre a época do `Date` do Swift (2001-01-01) e a época Unix, em segundos. */
export const SWIFT_REFERENCE_DATE_OFFSET_SECONDS = 978_307_200

export function swiftDateFromDate(date: Date): number {
  return date.getTime() / 1000 - SWIFT_REFERENCE_DATE_OFFSET_SECONDS
}

export function dateFromSwiftDate(seconds: number): Date {
  return new Date((seconds + SWIFT_REFERENCE_DATE_OFFSET_SECONDS) * 1000)
}
