import type { MainContext } from '../../context'
import { handle } from '../../ipc/router'

/** Leitor: abas de PDFs e sites por preparação. Implementação completa no módulo do Leitor. */
export function registerReader(context: MainContext): void {
  handle('reader:open', () => {
    context.windows.open('leitor')
  })
  handle('reader:tabsForSermon', () => [])
  context.modules.reviewMaterials = { marked: () => [], collect: async () => [], exportArchive: () => ({ tabs: [] }), replaceArchive: () => {} }
}
