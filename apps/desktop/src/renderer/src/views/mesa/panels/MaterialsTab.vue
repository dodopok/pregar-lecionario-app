<script setup lang="ts">
/**
 * Aba Materiais: seções dos PDFs da Biblioteca e artigos das fontes favoritas que tratam da
 * passagem principal, agrupados por correspondência, e a pesquisa de outros materiais por IA
 * (só sob comando; envia passagem e ocasião, nunca o manuscrito).
 */
import { computed, onActivated, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { ArrowUpRight, BookOpen, Globe, History, RefreshCw, Settings, Sparkles } from 'lucide-vue-next'
import type { AIResearchSource } from '@pregar/core/ai'
import { parseReference } from '@pregar/core/bible/reference'
import { isTabIncludedForReview } from '@pregar/core/reader'
import type { ReaderTab } from '@pregar/core/reader'
import {
  FavoriteSourceURLs,
  favoriteSiteMatchLabel,
  favoriteSiteUsesAnglicanCompassDestination,
} from '@pregar/core/sources'
import type { FavoriteSiteArticle, FavoriteSiteSearchGroup } from '@pregar/core/sources'
import { parseDateKey } from '@pregar/core/util/dates'
import type { InvokeResponse } from '@shared/ipc'
import type { LibrarySectionMatch } from '@shared/ipc-library'
import type { ReaderOpenRequest } from '@shared/ipc-reader'
import PButton from '@/components/PButton.vue'
import SectionLabel from '@/components/SectionLabel.vue'
import Spinner from '@/components/Spinner.vue'
import { errorMessage, invoke, on } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { useMesaStore } from '@/stores/mesa'
import { useToasts } from '@/stores/toasts'
import MaterialCard from './MaterialCard.vue'
import {
  MATERIAL_FILTERS,
  MATERIALS_SEARCH_DELAY_MS,
  articleLines,
  findReaderTab,
  groupMaterials,
  isPortugueseOrUnknown,
  joinParts,
  languageTag,
  materialsEmptyMessage,
  pdfLines,
  pdfMaterialId,
  relatedMetaLine,
  relatedRelationLabel,
  researchLines,
  shortDateTime,
  showsPDFs,
  showsSites,
  siteArticles,
  siteEditorialContext,
  sitesToConsult,
  totalItems,
  uniqueResearchSources,
} from './materials'
import type { MaterialFilter, MatchTone, OpenMode } from './materials'
import { isQuotaError, newRequestId } from './review'
import { useAIAccess } from './useAIAccess'

const mesa = useMesaStore()
const app = useAppStore()
const toasts = useToasts()
const { access: researchAccess } = useAIAccess('research')

const filter = ref<MaterialFilter>('all')
const pending = ref(false)
const pdfMatches = shallowRef<LibrarySectionMatch[]>([])
const pdfLoading = ref(false)
const siteReport = shallowRef<InvokeResponse<'sources:search'> | null>(null)
const sitesLoading = ref(false)
const sitesError = ref<string | null>(null)
const libraryWorks = ref<number | null>(null)
const favoriteSiteCount = ref<number | null>(null)
const research = shallowRef<{ sources: AIResearchSource[]; searchedAt: string } | null>(null)
const researchBusy = ref(false)
const researchError = ref<{ message: string; needsSetup: boolean } | null>(null)
const readerTabs = shallowRef<ReaderTab[]>([])
/** Aba selecionada no Leitor, conhecida pelo aviso `reader:changed`. */
const selectedReaderTab = ref<string | null>(null)
const openingId = ref<string | null>(null)

const reference = computed(() => mesa.mainReference.trim())
const searchable = computed(() => reference.value.length > 0 && parseReference(reference.value) !== null)
const searchKey = computed(() =>
  JSON.stringify([mesa.selectedDateKey, reference.value, mesa.occasion, mesa.isSunday]),
)
const visible = computed(() => mesa.contextTab === 'materials')
const liturgicalDate = computed(() => parseDateKey(mesa.selectedDateKey) ?? new Date())

const onlyPortuguese = computed(() => app.settings.materials.onlyPortuguese)
const allArticles = computed(() => siteArticles(siteReport.value?.groups))
const articles = computed(() =>
  onlyPortuguese.value
    ? allArticles.value.filter((article) => isPortugueseOrUnknown(article.site.language))
    : allArticles.value,
)
const hiddenByLanguage = computed(() => allArticles.value.length - articles.value.length)
const groups = computed(() => groupMaterials(pdfMatches.value, articles.value, filter.value))
const related = computed(() => mesa.related)
const relatedShown = computed(() => (showAllRelated.value ? related.value : related.value.slice(0, 4)))
const showAllRelated = ref(false)
const consultGroups = computed(() =>
  showsSites(filter.value) ? sitesToConsult(siteReport.value?.groups) : [],
)
const researchSources = computed(() => {
  const sources = uniqueResearchSources(research.value?.sources ?? [])
  return onlyPortuguese.value ? sources.filter((source) => isPortugueseOrUnknown(source.language)) : sources
})
const busyLine = computed(() => {
  if (!reference.value) return null
  if (showsSites(filter.value) && (sitesLoading.value || (pending.value && searchable.value)))
    return 'Consultando as fontes favoritas…'
  if (showsPDFs(filter.value) && (pdfLoading.value || pending.value))
    return 'Comparando referências nos PDFs…'
  return null
})
const emptyMessage = computed(() => {
  if (!reference.value || busyLine.value || totalItems(groups.value) > 0) return null
  return materialsEmptyMessage({
    filter: filter.value,
    libraryWorks: libraryWorks.value ?? 1,
    favoriteSites: favoriteSiteCount.value ?? 1,
  })
})
const researchHelp = computed(() =>
  researchAccess.value?.mode === 'pro'
    ? 'Usa a sua assinatura do Pregar (conta como uma pesquisa de materiais). Envia somente passagem e ocasião; o manuscrito não é enviado.'
    : 'Usa o provedor de pesquisa escolhido. Envia somente passagem e ocasião; o manuscrito não é enviado. O provedor pode cobrar a busca.',
)

// Busca ------------------------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null
let pdfRequest = 0
let siteRequest = 0
let researchRequest = 0
let pdfKey = ''
let sitesKey = ''

function invalidate(): void {
  pdfRequest += 1
  siteRequest += 1
  researchRequest += 1
  pdfKey = ''
  sitesKey = ''
  pdfMatches.value = []
  siteReport.value = null
  sitesError.value = null
  research.value = null
  researchError.value = null
  pdfLoading.value = false
  sitesLoading.value = false
}

function schedule(delay = MATERIALS_SEARCH_DELAY_MS): void {
  if (timer) clearTimeout(timer)
  timer = null
  if (!visible.value || !reference.value) {
    pending.value = false
    return
  }
  const key = searchKey.value
  const needsPdfs = showsPDFs(filter.value) && pdfKey !== key
  const needsSites = showsSites(filter.value) && searchable.value && sitesKey !== key
  if (!needsPdfs && !needsSites) {
    pending.value = false
    return
  }
  pending.value = true
  timer = setTimeout(() => {
    timer = null
    pending.value = false
    void loadPdfs(false)
    void loadSites(false)
  }, delay)
}

async function loadPdfs(force: boolean): Promise<void> {
  const key = searchKey.value
  if (!showsPDFs(filter.value) || !reference.value || (!force && pdfKey === key)) return
  const request = (pdfRequest += 1)
  pdfLoading.value = true
  try {
    const matches = await invoke('library:matches', { reference: reference.value })
    if (request !== pdfRequest) return
    pdfMatches.value = matches
  } catch {
    // A Biblioteca pode estar indisponível; os sites continuam.
    if (request === pdfRequest) pdfMatches.value = []
  } finally {
    if (request === pdfRequest) {
      pdfKey = key
      pdfLoading.value = false
    }
  }
}

async function loadSites(force: boolean): Promise<void> {
  const key = searchKey.value
  if (!showsSites(filter.value) || !searchable.value || (!force && sitesKey === key)) return
  const request = (siteRequest += 1)
  sitesLoading.value = true
  sitesError.value = null
  try {
    const report = await invoke('sources:search', {
      reference: reference.value,
      occasion: mesa.occasion,
      dateKey: mesa.selectedDateKey,
      isSunday: mesa.isSunday,
      ...(force ? { force: true } : {}),
    })
    if (request !== siteRequest) return
    siteReport.value = report
  } catch (error) {
    if (request === siteRequest) sitesError.value = errorMessage(error)
  } finally {
    if (request === siteRequest) {
      sitesKey = key
      sitesLoading.value = false
    }
  }
}

function refreshAll(): void {
  if (timer) clearTimeout(timer)
  pending.value = false
  void loadPdfs(true)
  void loadSites(true)
  void loadCounts()
}

async function loadCachedResearch(): Promise<void> {
  if (!reference.value) return
  const request = researchRequest
  try {
    const cached = await invoke('ai:researchCached', {
      reference: reference.value,
      occasion: mesa.occasion,
      dateKey: mesa.selectedDateKey,
    })
    if (request === researchRequest && cached) research.value = cached
  } catch {
    // Sem cache: o botão "Buscar outros materiais" continua disponível.
  }
}

async function searchForMaterials(): Promise<void> {
  if (!reference.value || researchBusy.value) return
  researchBusy.value = true
  researchError.value = null
  const request = researchRequest
  try {
    const result = await invoke('ai:research', {
      requestId: newRequestId(),
      reference: reference.value,
      occasion: mesa.occasion,
      dateKey: mesa.selectedDateKey,
    })
    if (request === researchRequest)
      research.value = { sources: result.sources, searchedAt: result.searchedAt }
  } catch (error) {
    if (request !== researchRequest) return
    const message = errorMessage(error)
    const code = (error as { code?: string }).code
    researchError.value = {
      message,
      needsSetup: code === 'ai_unavailable' || isQuotaError(error) || /chave/i.test(message),
    }
  } finally {
    researchBusy.value = false
  }
}

async function loadCounts(): Promise<void> {
  const [library, profiles] = await Promise.all([
    invoke('library:count').catch(() => null),
    invoke('sources:profiles').catch(() => null),
  ])
  const works = library?.works ?? null
  const sites = profiles?.sites.length ?? null
  // PDFs importados ou fontes editadas em outra janela mudam o resultado da passagem.
  if (libraryWorks.value !== null && works !== null && works !== libraryWorks.value) pdfKey = ''
  if (favoriteSiteCount.value !== null && sites !== null && sites !== favoriteSiteCount.value) sitesKey = ''
  libraryWorks.value = works
  favoriteSiteCount.value = sites
}

// Leitor -----------------------------------------------------------------------------------

let tabsTimer: ReturnType<typeof setTimeout> | null = null

async function refreshReaderTabs(): Promise<void> {
  const key = mesa.selectedDateKey
  try {
    const tabs = await invoke('reader:tabsForSermon', { dateKey: key })
    if (key === mesa.selectedDateKey) readerTabs.value = tabs
  } catch {
    readerTabs.value = []
  }
}

function scheduleTabsRefresh(delay = 700): void {
  if (tabsTimer) clearTimeout(tabsTimer)
  tabsTimer = setTimeout(() => void refreshReaderTabs(), delay)
}

function tabFor(kind: 'pdf' | 'web', location: string): ReaderTab | undefined {
  return findReaderTab(readerTabs.value, kind, location, mesa.selectedDateKey)
}

/** Marcação para a revisão: só para a aba aberta desta passagem e data (como no app Swift). */
function reviewState(tab: ReaderTab | undefined): boolean | null {
  if (!tab || tab.reference !== reference.value) return null
  return isTabIncludedForReview(tab)
}

async function setReviewInclusion(tab: ReaderTab | undefined, included: boolean): Promise<void> {
  if (!tab) return
  readerTabs.value = readerTabs.value.map((item) =>
    item.id === tab.id ? { ...item, includedInReview: included, reviewInclusionConfirmed: true } : item,
  )
  try {
    await invoke('reader:setReviewInclusion', { tabID: tab.id, included })
  } catch (error) {
    toasts.show(errorMessage(error), 'error')
  } finally {
    void refreshReaderTabs()
  }
}

function openLabel(tab: ReaderTab | undefined, unopened: string): string {
  if (!tab) return unopened
  return tab.id === selectedReaderTab.value ? 'Aberto no leitor' : 'Ir para a aba'
}

async function openInReader(request: ReaderOpenRequest, openingKey: string | null): Promise<void> {
  if (openingKey) openingId.value = openingKey
  try {
    await invoke('reader:open', request)
  } catch (error) {
    toasts.show(errorMessage(error), 'error')
  } finally {
    if (openingKey && openingId.value === openingKey) openingId.value = null
    scheduleTabsRefresh()
  }
}

function openPdf(match: LibrarySectionMatch, mode: OpenMode): void {
  if (!mode.background && openingId.value) return
  void openInReader(
    {
      kind: 'pdf',
      location: match.path,
      title: match.workTitle,
      reference: reference.value,
      sermonDateKey: mesa.selectedDateKey,
      physicalPage: match.section.startPage,
      background: mode.background,
      select: mode.select,
    },
    mode.background ? null : `pdf:${pdfMaterialId(match)}`,
  )
}

function openWeb(url: string, title: string, mode: OpenMode): void {
  void openInReader(
    {
      kind: 'web',
      location: url,
      title,
      reference: reference.value,
      sermonDateKey: mesa.selectedDateKey,
      background: mode.background,
      select: mode.select,
    },
    null,
  )
}

function pdfAction(match: LibrarySectionMatch): string {
  if (openingId.value === `pdf:${pdfMaterialId(match)}`) return 'Abrindo PDF…'
  return openLabel(tabFor('pdf', match.path), 'Abrir')
}

function webAction(url: string, unopened = 'Abrir'): string {
  return openLabel(tabFor('web', url), unopened)
}

function articleMatchTone(article: FavoriteSiteArticle): MatchTone {
  return article.match === 'same' || article.match === 'contains' ? 'accent' : 'warning'
}

function siteContext(group: FavoriteSiteSearchGroup): string {
  const destination = favoriteSiteUsesAnglicanCompassDestination(group.site)
    ? FavoriteSourceURLs.anglicanCompassDetail(mesa.occasion, liturgicalDate.value, mesa.isSunday)
    : null
  return joinParts([destination, siteEditorialContext(group.site)])
}

function siteNote(group: FavoriteSiteSearchGroup): string {
  if (group.site.adapter === 'workingPreacherArchive')
    return 'Arquivo da perícope. Confira o intervalo bíblico em cada resultado.'
  if (group.site.adapter === 'websiteSearch') return 'Abra o site para buscar esta passagem.'
  return group.errorMessage ?? 'Nenhuma correspondência explícita nesta busca.'
}

function openPreferences(section: string): void {
  void invoke('app:openWindow', { window: 'preferencias', route: `/preferencias/${section}` })
}

function toggleLanguage(): void {
  void app.updateSettings({ materials: { onlyPortuguese: !onlyPortuguese.value } })
}

function openRelatedInMesa(dateKey: string): void {
  void mesa.selectDate(dateKey)
}

function openRelatedInArchive(dateKey: string): void {
  void invoke('app:openWindow', { window: 'arquivo', route: `/arquivo?date=${dateKey}` })
}

// Ciclo de vida ----------------------------------------------------------------------------

watch(
  searchKey,
  () => {
    invalidate()
    void loadCachedResearch()
    void refreshReaderTabs()
  },
  { immediate: true },
)
watch([searchKey, visible, filter], () => schedule(), { immediate: true })

function onWindowFocus(): void {
  if (!visible.value) return
  void refreshReaderTabs()
  void loadCounts().then(() => schedule(0))
}

// Abas abertas, fechadas ou marcadas em qualquer janela atualizam o estado "aberto".
const stopReaderEvents = on('reader:changed', (event) => {
  selectedReaderTab.value = event.selectedID
  scheduleTabsRefresh(150)
})

onMounted(() => {
  void loadCounts()
  window.addEventListener('focus', onWindowFocus)
})
onActivated(() => {
  void refreshReaderTabs()
})
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  if (tabsTimer) clearTimeout(tabsTimer)
  stopReaderEvents()
  window.removeEventListener('focus', onWindowFocus)
})
</script>

<template>
  <div class="materials">
    <header class="materials__header">
      <h2 class="serif materials__title">{{ reference ? `Materiais para ${reference}` : 'Materiais' }}</h2>
      <PButton
        variant="icon"
        compact
        label="Atualizar materiais"
        title="Consultar a Biblioteca e as fontes favoritas de novo"
        :disabled="!reference || pdfLoading || sitesLoading"
        @click="refreshAll"
      >
        <RefreshCw :size="13" />
      </PButton>
    </header>

    <div class="materials__filters" role="group" aria-label="Filtrar materiais">
      <button
        v-for="option in MATERIAL_FILTERS"
        :key="option.value"
        type="button"
        class="chip"
        :class="{ 'chip--active': filter === option.value }"
        :aria-pressed="filter === option.value"
        :title="option.title"
        @click="filter = option.value"
      >
        {{ option.label }}
      </button>
      <button
        type="button"
        class="chip chip--language"
        :class="{ 'chip--accent': onlyPortuguese }"
        :aria-pressed="onlyPortuguese"
        title="Mostrar só fontes que se declaram em português (PDFs sem idioma continuam)"
        @click="toggleLanguage"
      >
        Em português
      </button>
    </div>

    <section v-if="related.length > 0" class="materials__group related" aria-label="Já preguei sobre isto">
      <div class="group-heading">
        <SectionLabel title="Já preguei sobre isto" tag="h3" class="tone--accent" />
        <span class="group-heading__count">{{ related.length }}</span>
        <span class="group-heading__rule" aria-hidden="true" />
      </div>
      <article
        v-for="item in relatedShown"
        :key="item.dateKey"
        class="past"
        :aria-label="`Preparação de ${item.dateKey}`"
      >
        <div class="past__head">
          <History :size="13" class="past__icon" aria-hidden="true" />
          <div class="past__text">
            <p class="serif past__title">{{ item.title || item.mainReadingReference || 'Sem título' }}</p>
            <p class="past__line">{{ relatedMetaLine(item) }}</p>
            <p class="past__relation">
              {{ relatedRelationLabel(item)
              }}<template v-if="item.matchedReference && item.relation === 'passage'">
                · {{ item.mainReadingReference }}</template
              >
            </p>
          </div>
        </div>
        <div class="past__actions">
          <button
            type="button"
            class="past__open"
            title="Abrir esta preparação na Mesa (a de hoje fica salva)"
            @click="openRelatedInMesa(item.dateKey)"
          >
            <ArrowUpRight :size="12" aria-hidden="true" /> Abrir na Mesa
          </button>
          <PButton
            variant="link"
            compact
            title="Ver no Arquivo, com busca e trechos"
            @click="openRelatedInArchive(item.dateKey)"
            >Ver no Arquivo</PButton
          >
        </div>
      </article>
      <PButton
        v-if="related.length > 4"
        variant="link"
        compact
        class="materials__link"
        @click="showAllRelated = !showAllRelated"
      >
        {{ showAllRelated ? 'Mostrar menos' : `Mostrar as outras ${related.length - 4}` }}
      </PButton>
    </section>

    <p v-if="!reference" class="materials__hint">
      Escolha o texto principal nas leituras para reunir comentários e artigos desta passagem.
    </p>
    <p v-else-if="busyLine" class="materials__busy" role="status">
      <Spinner :size="12" label="Buscando materiais" /> {{ busyLine }}
    </p>

    <section v-for="group in groups" :key="group.id" class="materials__group" :aria-label="group.title">
      <div class="group-heading">
        <SectionLabel :title="group.title" tag="h3" :class="`tone--${group.tone}`" />
        <span class="group-heading__count">{{ group.items.length }}</span>
        <span class="group-heading__rule" aria-hidden="true" />
      </div>
      <template v-for="item in group.items" :key="item.id">
        <MaterialCard
          v-if="item.kind === 'pdf'"
          icon="pdf"
          :title="item.match.section.title"
          :lines="pdfLines(item.match)"
          :action-label="pdfAction(item.match)"
          :is-open="Boolean(tabFor('pdf', item.match.path))"
          :busy="openingId !== null && openingId === `pdf:${pdfMaterialId(item.match)}`"
          :review="reviewState(tabFor('pdf', item.match.path))"
          @review="setReviewInclusion(tabFor('pdf', item.match.path), $event)"
          @open="openPdf(item.match, $event)"
        />
        <MaterialCard
          v-else
          icon="web"
          :title="item.article.title"
          :lines="articleLines(item.article)"
          :language="languageTag(item.article.site.language)"
          :match-label="favoriteSiteMatchLabel(item.article.match)"
          :match-tone="articleMatchTone(item.article)"
          :action-label="webAction(item.article.url)"
          :is-open="Boolean(tabFor('web', item.article.url))"
          :review="reviewState(tabFor('web', item.article.url))"
          @review="setReviewInclusion(tabFor('web', item.article.url), $event)"
          @open="openWeb(item.article.url, item.article.title, $event)"
        />
      </template>
    </section>

    <p v-if="emptyMessage" class="materials__hint">{{ emptyMessage }}</p>
    <p v-if="hiddenByLanguage > 0" class="materials__hint">
      {{
        hiddenByLanguage === 1
          ? '1 artigo em outro idioma escondido'
          : `${hiddenByLanguage} artigos em outros idiomas escondidos`
      }}
      pelo filtro Em português.
    </p>

    <template v-if="showsSites(filter) && reference">
      <p v-if="sitesError" class="materials__warning" role="alert">{{ sitesError }}</p>

      <section v-if="consultGroups.length > 0" class="materials__group" aria-label="Fontes para consultar">
        <div class="group-heading">
          <SectionLabel title="Fontes para consultar" tag="h3" class="tone--muted" />
          <span class="group-heading__count">{{ consultGroups.length }}</span>
          <span class="group-heading__rule" aria-hidden="true" />
        </div>
        <MaterialCard
          v-for="group in consultGroups"
          :key="group.site.id"
          icon="web"
          compact-title
          :title="group.site.title"
          :lines="siteContext(group) ? [siteContext(group)] : []"
          :language="languageTag(group.site.language)"
          :note="siteNote(group)"
          :action-label="
            webAction(
              group.searchURL,
              group.site.adapter === 'workingPreacherArchive'
                ? 'Abrir arquivo da perícope'
                : 'Buscar no site',
            )
          "
          :is-open="Boolean(tabFor('web', group.searchURL))"
          @open="openWeb(group.searchURL, group.site.title, $event)"
        />
      </section>

      <PButton
        v-if="favoriteSiteCount === 0 && !sitesLoading"
        variant="link"
        compact
        class="materials__link"
        title="Abre as Preferências na seção Fontes"
        @click="openPreferences('fontes')"
      >
        <Globe :size="13" /> Adicionar fontes favoritas
      </PButton>

      <section v-if="researchSources.length > 0" class="materials__group" aria-label="Outros materiais">
        <div class="group-heading">
          <SectionLabel title="Outros materiais" tag="h3" class="tone--accent" />
          <span class="group-heading__count">{{ researchSources.length }}</span>
          <span class="group-heading__rule" aria-hidden="true" />
        </div>
        <p class="materials__meta">
          {{ shortDateTime(research?.searchedAt) ?? 'Pesquisa' }} · metadados da busca; confirme na página
        </p>
        <MaterialCard
          v-for="source in researchSources"
          :key="source.url"
          icon="web"
          :title="source.title"
          :lines="researchLines(source)"
          :language="languageTag(source.language)"
          :action-label="webAction(source.url)"
          :is-open="Boolean(tabFor('web', source.url))"
          :review="reviewState(tabFor('web', source.url))"
          @review="setReviewInclusion(tabFor('web', source.url), $event)"
          @open="openWeb(source.url, source.title, $event)"
        />
      </section>
      <p v-else-if="research && !researchBusy" class="materials__hint">
        A pesquisa não encontrou outros materiais verificáveis para esta passagem.
      </p>

      <p v-if="researchBusy" class="materials__busy" role="status">
        <Spinner :size="12" label="Pesquisando" /> Pesquisando outras fontes…
      </p>
      <div v-if="researchError" class="materials__error" role="alert">
        <p class="materials__warning">{{ researchError.message }}</p>
        <PButton v-if="researchError.needsSetup" variant="link" compact @click="openPreferences('ia')"
          ><Settings :size="13" /> Configurar IA</PButton
        >
      </div>
    </template>

    <footer class="materials__footer">
      <PButton
        v-if="showsPDFs(filter)"
        compact
        title="Importar e indexar comentários em PDF (⌘3)"
        @click="invoke('app:openWindow', { window: 'biblioteca' })"
      >
        <BookOpen :size="13" /> Biblioteca de PDFs
      </PButton>
      <PButton
        v-if="showsSites(filter)"
        compact
        :disabled="!reference || researchBusy"
        :busy="researchBusy"
        :title="researchHelp"
        @click="searchForMaterials"
      >
        <Sparkles v-if="!researchBusy" :size="13" />
        {{ research ? 'Atualizar pesquisa' : 'Buscar outros materiais' }}
      </PButton>
    </footer>
  </div>
</template>

<style scoped>
.materials {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.materials__header {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}
.materials__title {
  flex: 1;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.materials__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip--language {
  margin-left: auto;
}
.related {
  padding: 10px 10px 8px;
  border-radius: var(--radius-card);
  background: var(--accent-softer);
  border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
}
.past {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 9px;
  border-radius: var(--radius-button);
  background: color-mix(in srgb, var(--manuscript) 80%, transparent);
  border: 1px solid var(--line);
}
.past__head {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.past__icon {
  flex: none;
  margin-top: 3px;
  color: var(--accent-ink);
}
.past__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.past__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.past__line {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}
.past__relation {
  margin: 0;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--accent-ink);
}
.past__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-left: 21px;
}
.past__open {
  height: var(--control-compact);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--surface);
  font-size: var(--text-xs);
  font-weight: 500;
  white-space: nowrap;
}
.past__open:hover {
  background: color-mix(in srgb, var(--ink) 4%, var(--surface));
}
.materials__hint,
.materials__meta {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}
.materials__busy {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}
.materials__warning {
  margin: 0;
  font-size: 11px;
  color: var(--warning);
}
.materials__error {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
.materials__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.group-heading {
  display: flex;
  align-items: center;
  gap: 7px;
  padding-top: var(--space-xs);
}
.group-heading__count {
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.group-heading__rule {
  flex: 1;
  height: 1px;
  background: var(--line);
}
/* Mais específico que a cor própria do SectionLabel. */
.group-heading .tone--accent {
  color: var(--accent);
}
.group-heading .tone--warning {
  color: var(--warning);
}
.group-heading .tone--muted {
  color: var(--muted);
}
.materials__link {
  align-self: flex-start;
}
.materials__footer {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  padding-top: var(--space-xs);
}
</style>
