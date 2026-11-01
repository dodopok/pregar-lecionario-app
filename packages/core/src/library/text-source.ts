/**
 * Entrada abstrata do indexador. O app implementa `PdfTextSource` com o PDF.js (camada de
 * texto, sumário e metadados) e entrega o texto do OCR (tesseract.js) por `recognizePage` ou
 * pelo texto OCR já salvo no registro. O indexador não conhece nenhuma das duas bibliotecas.
 */

/** Item do sumário (bookmarks) do PDF. */
export interface PdfOutlineItem {
  /** Rótulo do bookmark; `null` quando o item não tem título. */
  title: string | null
  /** Página de destino, 0-based; `null` quando o destino não aponta para uma página. */
  pageIndex: number | null
  children: readonly PdfOutlineItem[]
}

/** Linha de texto em ordem de leitura, com posição opcional (camada de texto ou caixa do OCR). */
export interface PdfTextLine {
  text: string
  x?: number
  y?: number
  width?: number
  height?: number
}

/**
 * Texto de uma página. `text` é o texto completo em ordem de leitura, com uma quebra de linha
 * entre linhas (equivalente a `PDFPage.string`). Os offsets UTF-16 gravados nos componentes do
 * índice referem-se a este texto, portanto ele precisa ser estável entre execuções.
 */
export interface PdfPageText {
  text: string
  lines?: readonly PdfTextLine[]
}

/** Atributos do documento usados para título e autoria. */
export interface PdfMetadata {
  title?: string | null
  author?: string | null
}

export interface PdfTextSource {
  readonly pageCount: number
  outline(): Promise<readonly PdfOutlineItem[]>
  /** Texto da página `pageIndex` (0-based); `null` quando a página não tem camada de texto legível. */
  pageText(pageIndex: number): Promise<PdfPageText | null>
  metadata(): Promise<PdfMetadata>
}

/** Monta o texto da página a partir de linhas já ordenadas. */
export function pageTextFromLines(lines: readonly PdfTextLine[]): PdfPageText {
  return { text: lines.map((line) => line.text).join('\n'), lines }
}

/** Linha reconhecida por OCR em coordenadas da imagem (origem no canto superior esquerdo). */
export interface RecognizedLine {
  text: string
  left: number
  top: number
  bottom: number
}

/**
 * Ordena e junta as linhas do OCR como o app Swift fazia com o Vision: de cima para baixo e,
 * quando os centros verticais diferem menos de 1,2% da altura da página, da esquerda para a
 * direita.
 */
export function joinRecognizedLines(lines: readonly RecognizedLine[], pageHeight: number): string {
  const tolerance = 0.012 * pageHeight
  return [...lines]
    .sort((a, b) => {
      const middleA = (a.top + a.bottom) / 2
      const middleB = (b.top + b.bottom) / 2
      if (Math.abs(middleA - middleB) > tolerance) return middleA - middleB
      return a.left - b.left
    })
    .map((line) => line.text)
    .join('\n')
}

const CACHED = Symbol('pregar.cachedPdfTextSource')

interface CachedSource extends PdfTextSource {
  readonly [CACHED]: true
}

/**
 * Envolve a fonte guardando o texto de cada página, para que uma indexação leia cada página uma
 * única vez. As funções do indexador já aplicam o cache; envolver de novo não tem efeito.
 */
export function cachedPdfTextSource(source: PdfTextSource): PdfTextSource {
  if ((source as Partial<CachedSource>)[CACHED]) return source
  const pages = new Map<number, Promise<PdfPageText | null>>()
  let outline: Promise<readonly PdfOutlineItem[]> | null = null
  let metadata: Promise<PdfMetadata> | null = null
  const cached: CachedSource = {
    [CACHED]: true,
    get pageCount() {
      return source.pageCount
    },
    outline() {
      outline ??= source.outline()
      return outline
    },
    metadata() {
      metadata ??= source.metadata()
      return metadata
    },
    pageText(pageIndex: number) {
      let page = pages.get(pageIndex)
      if (!page) {
        page = source.pageText(pageIndex)
        pages.set(pageIndex, page)
      }
      return page
    },
  }
  return cached
}

/** Texto da camada do PDF na página física `pageNumber` (1-based), ou `null`. */
export async function pdfPageString(source: PdfTextSource, pageNumber: number): Promise<string | null> {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > source.pageCount) return null
  const page = await source.pageText(pageNumber - 1)
  return page ? page.text : null
}
