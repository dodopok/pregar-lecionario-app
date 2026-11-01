import type { PdfMetadata, PdfOutlineItem, PdfPageText, PdfTextSource } from '../../src/library'

export interface FakePdfOptions {
  /** Texto de cada página física; `null` ou "" simulam páginas só com imagem. */
  pages: (string | null)[]
  outline?: PdfOutlineItem[]
  metadata?: PdfMetadata
}

/** PDF sintético: texto por página, sumário e metadados, registrando as leituras de página. */
export class FakePdfTextSource implements PdfTextSource {
  readonly reads: number[] = []

  constructor(private readonly options: FakePdfOptions) {}

  get pageCount(): number {
    return this.options.pages.length
  }

  async outline(): Promise<readonly PdfOutlineItem[]> {
    return this.options.outline ?? []
  }

  async pageText(pageIndex: number): Promise<PdfPageText | null> {
    this.reads.push(pageIndex)
    const text = this.options.pages[pageIndex]
    return text === null || text === undefined ? null : { text }
  }

  async metadata(): Promise<PdfMetadata> {
    return this.options.metadata ?? {}
  }
}

export function bookmark(
  title: string,
  page: number | null,
  children: PdfOutlineItem[] = [],
): PdfOutlineItem {
  return { title, pageIndex: page === null ? null : page - 1, children }
}

/** Páginas de preenchimento com prosa, sem referências. */
export function filler(count: number, prefix = 'Body text'): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${prefix} ${index + 1}.\nMore prose without any heading.`,
  )
}

/** Página do Feasting: leitura, quatro perspectivas e autores, opcionalmente com a próxima leitura. */
export const FEASTING_PAGES: Record<number, string> = {
  10: 'Psalm 122 continues here.\nELIZABETH P. RANDALL\nRomans 13:8-14\n8 Owe no one anything.\nTheological Perspective\nTheological body begins.',
  11: 'Theological body continues.\nELEAZAR S. FERNANDEZ\nPastoral Perspective\nPastoral body begins.',
  12: 'Pastoral body continues.\nROCHELLE A. STACKHOUSE\nExegetical Perspective\nExegetical body begins.\nCHRISTOPHER R. HUTSON\n',
  13: 'Homiletical Perspective\nHomiletical body ends here.\nDAVID L. BARTLETT\nMatthew 18:15-20\nNext reading.',
}
