import { activeEditor, editorPlainText } from '@/lib/editorBridge'
import type { useMesaStore } from '@/stores/mesa'

/**
 * Texto atual do manuscrito, lido sob demanda (nunca a cada tecla): o do editor aberto ou, sem
 * editor montado, o último texto salvo. É o mesmo texto cuja impressão digital a revisão guarda.
 */
export function currentManuscript(mesa: ReturnType<typeof useMesaStore>): string {
  return activeEditor.value ? editorPlainText() : (mesa.record?.plainText ?? '')
}

/** Título usado nos envios e exportações: título do sermão, senão a passagem principal. */
export function sermonTitle(mesa: ReturnType<typeof useMesaStore>, fallback = 'Sermão'): string {
  const title = mesa.record?.title?.trim()
  if (title) return title
  return mesa.record?.mainReadingReference?.trim() || fallback
}
