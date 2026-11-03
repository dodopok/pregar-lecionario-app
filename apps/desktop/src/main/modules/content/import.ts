import { app, BrowserWindow, dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { LiturgicalAPIError } from '@pregar/core/liturgy/client'
import type { LiturgicalDay } from '@pregar/core/liturgy/types'
import { isDateKey } from '@pregar/core/util/dates'
import type { ImportConfirmItem, ImportResult } from '@shared/ipc-import'
import type { MainContext } from '../../context'
import { handle } from '../../ipc/router'
import {
  IMPORT_EXTENSIONS,
  MAX_IMPORT_FILES,
  expandPaths,
  liturgicalFieldsFor,
  mapLimit,
  prepareCandidate,
  sermonPatchFor,
} from './import-convert'
import type { PreparedCandidate } from './import-convert'

const LITURGY_TIMEOUT_MS = 4000
const LITURGY_MAX_FAILURES = 3
const CONVERSION_CONCURRENCY = 4

const confirmItem = z.object({
  id: z.string().min(1).max(80),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().trim().min(1).max(500),
  mainReadingReference: z.string().trim().max(200).nullable(),
})

/**
 * Importação de sermões antigos: o diálogo escolhe arquivos (ou pastas, no macOS), cada um é
 * convertido e fica em memória como candidato até a pessoa confirmar a data, o título e a passagem.
 * Só então vira uma preparação no Arquivo; nada sai do computador.
 */
export function registerImport(context: MainContext): void {
  const pending = new Map<string, PreparedCandidate>()

  /** Leituras do dia com prazo curto; falhas só tiram os campos litúrgicos, nunca a importação. */
  async function loadDay(dateKey: string): Promise<{ day: LiturgicalDay | null; keepTrying: boolean }> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const day = await Promise.race([
        context.liturgy.day(dateKey),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), LITURGY_TIMEOUT_MS)
        }),
      ])
      return { day, keepTrying: true }
    } catch (error) {
      context.integrationLog.log.record({
        level: 'AVISO',
        integration: 'Estêvão API',
        operation: 'importação: leituras do dia',
        note: dateKey,
        error,
      })
      const timedOut = error instanceof Error && error.message === 'timeout'
      const noAccess =
        error instanceof LiturgicalAPIError &&
        (error.status === undefined || error.status === 401 || error.status === 403)
      return { day: null, keepTrying: !timedOut && !noAccess }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  function failed(item: ImportConfirmItem, message: string): ImportResult {
    return { id: item.id, status: 'failed', dateKey: item.dateKey, message, record: null }
  }

  handle('import:pick', async (_request, event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const isMac = process.platform === 'darwin'
    const result = await dialog.showOpenDialog(window!, {
      title: 'Importar sermões antigos',
      message: isMac
        ? 'Escolha arquivos ou uma pasta inteira com sermões (.docx, .rtf, .txt ou .md).'
        : undefined,
      buttonLabel: 'Importar',
      defaultPath: app.getPath('documents'),
      // Só o macOS aceita arquivos e pastas no mesmo diálogo; nos outros sistemas vão vários arquivos de uma vez.
      properties: isMac ? ['openFile', 'openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
      filters: [
        {
          name: process.platform === 'win32' ? 'Sermões' : 'Sermões (*.docx, *.rtf, *.txt, *.md)',
          extensions: [...IMPORT_EXTENSIONS],
        },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return []
    pending.clear()
    const expanded = await expandPaths(result.filePaths)
    const prepared = await mapLimit(expanded.files, CONVERSION_CONCURRENCY, (path) =>
      prepareCandidate(path, randomUUID()),
    )
    for (const item of prepared) {
      pending.set(item.candidate.id, item)
      if (item.candidate.error)
        console.warn(`[importação] ${item.candidate.fileName}: ${item.candidate.error}`)
    }
    const candidates = prepared.map((item) => item.candidate)
    if (expanded.truncated && candidates[0]) {
      candidates[0].warnings.unshift(
        `Só os primeiros ${MAX_IMPORT_FILES} arquivos foram lidos; os demais ficaram de fora.`,
      )
    }
    return candidates
  })

  handle('import:confirm', async ({ items }, event) => {
    const parsed = z.array(confirmItem).min(1).max(MAX_IMPORT_FILES).parse(items)
    const prayerBook = context.currentSettings().liturgy.prayerBook
    const results: ImportResult[] = []
    let liturgyFailures = 0
    let liturgyAvailable = true
    for (const item of parsed) {
      const prepared = pending.get(item.id)
      if (!prepared || !prepared.doc) {
        results.push(failed(item, 'Este arquivo não está mais pronto para importar. Escolha-o de novo.'))
        continue
      }
      if (!isDateKey(item.dateKey)) {
        results.push(failed(item, 'Data inválida.'))
        continue
      }
      const existing = context.sermons.get(item.dateKey)
      if (existing && existing.plainText.trim() !== '') {
        results.push({
          id: item.id,
          status: 'skipped',
          dateKey: item.dateKey,
          message: 'Já existe uma preparação com texto nessa data.',
          record: null,
        })
        continue
      }
      let day: LiturgicalDay | null = null
      if (liturgyAvailable) {
        const loaded = await loadDay(item.dateKey)
        day = loaded.day
        liturgyFailures = day ? 0 : liturgyFailures + 1
        if (!loaded.keepTrying || liturgyFailures >= LITURGY_MAX_FAILURES) liturgyAvailable = false
      }
      const reference = item.mainReadingReference?.trim() || null
      const fields = liturgicalFieldsFor(day, reference, prayerBook)
      try {
        const record = context.sermons.save(item.dateKey, sermonPatchFor(prepared, item.title.trim(), fields))
        context.windows.broadcast('sermon:changed', { dateKey: record.dateKey, origin: event.sender.id })
        pending.delete(item.id)
        results.push({ id: item.id, status: 'imported', dateKey: record.dateKey, message: null, record })
      } catch (error) {
        console.warn(`[importação] falha ao gravar ${item.dateKey}:`, error)
        results.push(failed(item, 'Não foi possível gravar esta preparação. Tente de novo.'))
      }
    }
    return results
  })

  handle('import:cancel', () => {
    pending.clear()
  })
}
