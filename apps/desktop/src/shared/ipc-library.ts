import type { PdfSectionLocation } from '@pregar/core/library'

/** Resultado de seção de PDF que corresponde à passagem, para o painel Materiais. */
export interface LibrarySectionMatch {
  recordId: string
  path: string
  workTitle: string
  author: string | null
  section: PdfSectionLocation
  kind: 'exact' | 'partial' | 'context'
}

/** Canais da Biblioteca. O módulo da Biblioteca acrescenta os seus próprios aqui. */
export interface LibraryInvokeChannels {
  'library:matches': { req: { reference: string }; res: LibrarySectionMatch[] }
  'library:count': { req: void; res: { works: number; sections: number } }
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LibraryEventChannels {}
