import type { MainContext } from '../../context'
import { handle } from '../../ipc/router'

/** Biblioteca de PDFs: importação, índice, OCR e protocolo pregar-pdf. Implementação no módulo da Biblioteca. */
export function registerLibrary(context: MainContext): void {
  handle('library:matches', () => [])
  handle('library:count', () => ({ works: 0, sections: 0 }))
  context.modules.library = {
    extractReviewSources: async () => [],
    isRegisteredPath: () => false,
    pdfURL: (path) => `pregar-pdf://open/${Buffer.from(path).toString('base64url')}`,
    importFiles: async () => {},
    exportRecords: () => [],
    replaceRecords: async () => {},
    exportSectionLinks: () => ({}),
    replaceSectionLinks: () => {},
  }
}
