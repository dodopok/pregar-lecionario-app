/**
 * Folha do púlpito: o mesmo HTML alimenta a impressão direta, o PDF e a prévia. As anotações do
 * pregador ficam de fora porque `toRichDocument` já as descarta.
 */
import { parseDateKey, sermonDateOf, shortDatePt } from '@pregar/core/util/dates'
import { htmlForPrint } from '@pregar/editor'
import type { AppSettings } from '@shared/settings'
import { invoke } from '@/lib/api'
import { editorRichDocument } from '@/lib/editorBridge'
import type { useAppStore } from '@/stores/app'
import type { useMesaStore } from '@/stores/mesa'
import { sermonTitle } from './panels/manuscript'

type Mesa = ReturnType<typeof useMesaStore>
type App = Pick<ReturnType<typeof useAppStore>, 'settings'>

/** "08/11/2026 · 24º Domingo depois de Pentecostes" */
export function pulpitSubtitle(mesa: Mesa): string {
  const date = parseDateKey(sermonDateOf(mesa.selectedDateKey))
  return [date ? shortDatePt(date) : mesa.selectedDateKey, mesa.occasion].filter(Boolean).join(' · ')
}

export function pulpitOptions(settings: AppSettings['tablet']) {
  return {
    fontFamily: settings.fontFamily,
    fontSizePt: settings.fontSize,
    includeFootnotes: settings.includeNotes,
  }
}

/** HTML paginado da folha, ou nulo sem manuscrito aberto. */
export function buildPulpitHtml(mesa: Mesa, app: App): { html: string; title: string } | null {
  const title = sermonTitle(mesa)
  const document = editorRichDocument(title)
  if (!document) return null
  const html = htmlForPrint(document, {
    title,
    occasion: pulpitSubtitle(mesa),
    ...pulpitOptions(app.settings.tablet),
  })
  return { html, title: mesa.record?.mainReadingReference || title }
}

/** Abre o diálogo de impressão do sistema com a folha atual. */
export async function printPulpitSheet(
  mesa: Mesa,
  app: App,
): Promise<{ printed: boolean; message: string | null }> {
  await mesa.flush()
  const built = buildPulpitHtml(mesa, app)
  if (!built) return { printed: false, message: 'Abra o manuscrito na Mesa para imprimir.' }
  if (!mesa.record?.plainText.trim() && mesa.wordCount === 0)
    return { printed: false, message: 'O manuscrito está vazio.' }
  return invoke('tablet:print', built)
}
