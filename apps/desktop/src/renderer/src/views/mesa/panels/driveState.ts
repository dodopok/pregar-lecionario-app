import { ref, shallowRef } from 'vue'
import type { DriveStatus, IdeaNote } from '@shared/ipc-content'
import { errorMessage, invoke, on } from '@/lib/api'

/**
 * Estado do Google Drive na janela da Mesa (conexão e notas do documento de ideias), compartilhado
 * pela aba Ideias, pelo badge da aba e pelas folhas Drive e Tablet. Um por janela.
 */
export const driveStatus = shallowRef<DriveStatus | null>(null)
export const driveStatusLoading = ref(false)
export const ideaNotes = shallowRef<IdeaNote[]>([])
export const ideasDocumentURL = ref<string | null>(null)
export const ideasUpdatedAt = ref<Date | null>(null)
export const ideasLoading = ref(false)
export const ideasError = ref<string | null>(null)

let subscribed = false
let statusRequest: Promise<void> | null = null

function applyStatus(status: DriveStatus): void {
  const wasConnected = driveStatus.value?.connected ?? false
  driveStatus.value = status
  if (status.ideasDocumentURL) ideasDocumentURL.value = status.ideasDocumentURL
  if (!status.connected) {
    ideaNotes.value = []
    ideasUpdatedAt.value = null
    if (wasConnected) ideasDocumentURL.value = null
  }
}

/** Consulta a conexão uma vez e passa a ouvir as mudanças vindas do processo principal. */
export function ensureDriveStatus(): Promise<void> {
  if (!subscribed) {
    subscribed = true
    on('drive:status', applyStatus)
  }
  if (statusRequest) return statusRequest
  driveStatusLoading.value = true
  statusRequest = invoke('drive:status')
    .then(applyStatus)
    .catch(() => {
      driveStatus.value = { available: false, connected: false, ideasDocumentURL: null, message: 'Não foi possível verificar o Google Drive.' }
    })
    .finally(() => {
      driveStatusLoading.value = false
      statusRequest = null
    })
  return statusRequest
}

export function setDriveStatus(status: DriveStatus): void {
  applyStatus(status)
}

/**
 * Relê as notas do documento de ideias. Só cria o documento com `create`, depois de um clique:
 * entrar na aba nunca cria arquivos no Drive.
 */
export async function refreshIdeas(options: { create?: boolean } = {}): Promise<void> {
  if (ideasLoading.value) return
  const status = driveStatus.value
  if (!status?.connected) return
  if (!options.create && !status.ideasDocumentURL && !ideasDocumentURL.value) return
  ideasLoading.value = true
  try {
    const result = await invoke('drive:ideas', options.create ? { create: true } : {})
    ideaNotes.value = result.notes
    ideasDocumentURL.value = result.documentURL
    ideasUpdatedAt.value = new Date()
    ideasError.value = null
  } catch (error) {
    ideasError.value = errorMessage(error)
  } finally {
    ideasLoading.value = false
  }
}
