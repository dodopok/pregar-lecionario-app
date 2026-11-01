import { computed, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import type { ReviewSourceSummary } from '@shared/ipc-ai'
import { errorMessage, invoke } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { useMesaStore } from '@/stores/mesa'

/** O processo principal guarda as fontes conferidas por 15 minutos; antes disso, confere de novo. */
const SOURCES_MAX_AGE_MS = 10 * 60 * 1000

/**
 * Fontes que acompanham um pedido de IA: a leitura principal na tradução da Mesa e nas que já
 * foram carregadas nas leituras, mais os materiais marcados no Leitor. Nada é enviado aqui; o
 * processo principal só confere e mede o que iria.
 */
export function useReviewSources(enabled: Ref<boolean>) {
  const app = useAppStore()
  const mesa = useMesaStore()
  const sources = shallowRef<ReviewSourceSummary[]>([])
  const totalBytes = ref(0)
  const blockedReason = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let fetchedAt = 0
  let request = 0

  const bibles = computed(() =>
    [...new Set([app.settings.liturgy.bible, ...Object.keys(mesa.alternativeTexts)].filter(Boolean))].slice(
      0,
      6,
    ),
  )
  const bibleSources = computed(() => sources.value.filter((source) => source.kind === 'bible'))
  const materials = computed(() => sources.value.filter((source) => source.kind !== 'bible'))

  async function load(): Promise<void> {
    const current = (request += 1)
    if (!enabled.value) {
      sources.value = []
      totalBytes.value = 0
      blockedReason.value = null
      error.value = null
      loading.value = false
      return
    }
    loading.value = true
    error.value = null
    try {
      const result = await invoke('ai:reviewSources', {
        dateKey: mesa.selectedDateKey,
        mainReference: mesa.mainReference,
        bibles: bibles.value,
        includeMaterials: true,
      })
      if (current !== request) return
      sources.value = result.sources
      totalBytes.value = result.totalBytes
      blockedReason.value = result.blockedReason
      fetchedAt = Date.now()
    } catch (failure) {
      if (current !== request) return
      sources.value = []
      totalBytes.value = 0
      error.value = errorMessage(failure)
    } finally {
      if (current === request) loading.value = false
    }
  }

  /** Antes do envio: confere de novo se a conferência anterior pode ter expirado. */
  async function ensureFresh(): Promise<void> {
    if (enabled.value && Date.now() - fetchedAt > SOURCES_MAX_AGE_MS) await load()
  }

  watch(enabled, () => void load(), { immediate: true })

  return { sources, bibleSources, materials, totalBytes, blockedReason, loading, error, load, ensureFresh }
}
