<script setup lang="ts">
/** Fontes: sites e autores favoritos (listar, adicionar, editar, remover e voltar aos padrões). */
import { onMounted, ref } from 'vue'
import { Globe, Info, Pencil, Plus, RotateCcw, Search, Trash2, UserRound } from 'lucide-vue-next'
import {
  DEFAULT_FAVORITE_AUTHORS,
  DEFAULT_FAVORITE_SITES,
  favoriteSiteAdapterTitle,
  newFavoriteAuthor,
  newFavoriteSite,
} from '@pregar/core/sources/favorites'
import type { FavoriteAuthor, FavoriteSite } from '@pregar/core/sources/favorites'
import PButton from '@/components/PButton.vue'
import Spinner from '@/components/Spinner.vue'
import { errorMessage, invoke } from '@/lib/api'
import { useToasts } from '@/stores/toasts'
import PrefGroup from './ui/PrefGroup.vue'
import Notice from './ui/Notice.vue'
import ConfirmSheet from './ui/ConfirmSheet.vue'
import SiteEditor from './fontes/SiteEditor.vue'
import AuthorEditor from './fontes/AuthorEditor.vue'
import { displayHost } from './sources-form'
import { isNotImplemented } from './format'

const toasts = useToasts()

const sites = ref<FavoriteSite[]>([])
const authors = ref<FavoriteAuthor[]>([])
const loading = ref(true)
const readOnly = ref(false)
const loadError = ref<string | null>(null)
const saving = ref(false)
const editingSite = ref<{ site: FavoriteSite; isNew: boolean } | null>(null)
const editingAuthor = ref<{ author: FavoriteAuthor; isNew: boolean } | null>(null)
const removing = ref<{ kind: 'site'; item: FavoriteSite } | { kind: 'author'; item: FavoriteAuthor } | null>(null)
const resetting = ref(false)

function cloneDefaults(): void {
  sites.value = DEFAULT_FAVORITE_SITES.map((site) => ({ ...site }))
  authors.value = DEFAULT_FAVORITE_AUTHORS.map((author) => ({ ...author }))
}

async function load(): Promise<void> {
  loading.value = true
  loadError.value = null
  try {
    const profiles = await invoke('sources:profiles')
    sites.value = profiles.sites
    authors.value = profiles.authors
    readOnly.value = false
  } catch (caught) {
    cloneDefaults()
    if (isNotImplemented(caught)) readOnly.value = true
    else loadError.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

async function persist(payload: { sites?: FavoriteSite[]; authors?: FavoriteAuthor[] }, success: string): Promise<boolean> {
  saving.value = true
  try {
    const profiles = await invoke('sources:saveProfiles', payload)
    sites.value = profiles.sites
    authors.value = profiles.authors
    toasts.show(success, 'success')
    return true
  } catch (caught) {
    toasts.show(isNotImplemented(caught) ? 'As fontes ainda não podem ser alteradas nesta versão.' : errorMessage(caught), 'error')
    return false
  } finally {
    saving.value = false
  }
}

async function saveSite(site: FavoriteSite): Promise<void> {
  const next = sites.value.some((item) => item.id === site.id) ? sites.value.map((item) => (item.id === site.id ? site : item)) : [...sites.value, site]
  if (await persist({ sites: next }, `“${site.title}” salvo.`)) editingSite.value = null
}

async function saveAuthor(author: FavoriteAuthor): Promise<void> {
  const next = authors.value.some((item) => item.id === author.id)
    ? authors.value.map((item) => (item.id === author.id ? author : item))
    : [...authors.value, author]
  if (await persist({ authors: next }, `${author.name} salvo.`)) editingAuthor.value = null
}

async function confirmRemoval(): Promise<void> {
  const target = removing.value
  if (!target) return
  const ok =
    target.kind === 'site'
      ? await persist({ sites: sites.value.filter((site) => site.id !== target.item.id) }, `“${target.item.title}” removido.`)
      : await persist({ authors: authors.value.filter((author) => author.id !== target.item.id) }, `${target.item.name} removido.`)
  if (ok) removing.value = null
}

async function resetDefaults(): Promise<void> {
  saving.value = true
  try {
    const profiles = await invoke('sources:resetProfiles')
    sites.value = profiles.sites
    authors.value = profiles.authors
    resetting.value = false
    toasts.show('Fontes e autores voltaram ao padrão.', 'success')
  } catch (caught) {
    toasts.show(errorMessage(caught), 'error')
  } finally {
    saving.value = false
  }
}

function siteContext(site: FavoriteSite): string {
  return [favoriteSiteAdapterTitle(site.adapter), displayHost(site.baseURL), site.language, site.tradition].filter(Boolean).join(' · ')
}

onMounted(load)
</script>

<template>
  <div class="section-stack">
    <Notice v-if="readOnly" tone="info">Mostrando as fontes iniciais. A edição chega numa próxima atualização do Proper.</Notice>
    <Notice v-if="loadError" tone="error">
      {{ loadError }}
      <template #actions><PButton compact @click="load">Tentar de novo</PButton></template>
    </Notice>

    <PrefGroup label="Fontes favoritas">
      <div v-if="loading" class="list-state"><Spinner :size="14" /> Carregando…</div>
      <ul v-else class="items">
        <li v-for="site in sites" :key="site.id" class="item">
          <Globe :size="16" class="item__icon" aria-hidden="true" />
          <div class="item__text">
            <span class="item__title">{{ site.title }}</span>
            <span class="item__detail">{{ siteContext(site) }}</span>
            <span v-if="site.detail" class="item__description">{{ site.detail }}</span>
          </div>
          <PButton variant="icon" compact :label="`Editar ${site.title}`" :disabled="readOnly" @click="editingSite = { site: { ...site }, isNew: false }">
            <Pencil :size="14" />
          </PButton>
          <PButton variant="icon" compact :label="`Remover ${site.title}`" :disabled="readOnly" @click="removing = { kind: 'site', item: site }">
            <Trash2 :size="14" />
          </PButton>
        </li>
        <li v-if="sites.length === 0" class="list-state">Nenhum site favorito.</li>
      </ul>
      <div class="group-footer">
        <span class="group-footer__note"><Info :size="13" aria-hidden="true" />As fontes ficam neste computador e aparecem na Mesa.</span>
        <PButton compact :disabled="readOnly || loading" @click="editingSite = { site: newFavoriteSite(), isNew: true }">
          <Plus :size="13" aria-hidden="true" />Adicionar site
        </PButton>
      </div>
    </PrefGroup>

    <PrefGroup label="Autores favoritos">
      <ul v-if="!loading" class="items">
        <li v-for="author in authors" :key="author.id" class="item">
          <UserRound :size="16" class="item__icon" aria-hidden="true" />
          <div class="item__text">
            <span class="item__title">{{ author.name }}</span>
            <span v-if="author.referenceURL" class="item__detail">{{ displayHost(author.referenceURL) }}</span>
          </div>
          <PButton variant="icon" compact :label="`Editar ${author.name}`" :disabled="readOnly" @click="editingAuthor = { author: { ...author }, isNew: false }">
            <Pencil :size="14" />
          </PButton>
          <PButton variant="icon" compact :label="`Remover ${author.name}`" :disabled="readOnly" @click="removing = { kind: 'author', item: author }">
            <Trash2 :size="14" />
          </PButton>
        </li>
        <li v-if="authors.length === 0" class="list-state">Nenhum autor favorito.</li>
      </ul>
      <div class="group-footer">
        <span class="group-footer__note"><Search :size="13" aria-hidden="true" />A IA os prioriza ao localizar fontes; não recebe o sermão.</span>
        <PButton compact :disabled="readOnly || loading" @click="editingAuthor = { author: newFavoriteAuthor(), isNew: true }">
          <Plus :size="13" aria-hidden="true" />Adicionar autor
        </PButton>
      </div>
    </PrefGroup>

    <div>
      <PButton variant="ghost" compact :disabled="readOnly || loading" @click="resetting = true">
        <RotateCcw :size="13" aria-hidden="true" />Voltar às fontes iniciais…
      </PButton>
    </div>

    <SiteEditor v-if="editingSite" :site="editingSite.site" :is-new="editingSite.isNew" :busy="saving" @save="saveSite" @close="editingSite = null" />
    <AuthorEditor
      v-if="editingAuthor"
      :author="editingAuthor.author"
      :is-new="editingAuthor.isNew"
      :busy="saving"
      @save="saveAuthor"
      @close="editingAuthor = null"
    />
    <ConfirmSheet
      v-if="removing"
      :title="removing.kind === 'site' ? 'Remover fonte favorita?' : 'Remover autor favorito?'"
      :message="
        removing.kind === 'site'
          ? `${removing.item.title} deixa de ser consultado na Mesa. Você pode adicioná-lo de novo depois.`
          : `${removing.item.name} deixa de ser priorizado na pesquisa de materiais.`
      "
      confirm-label="Remover"
      :busy="saving"
      @confirm="confirmRemoval"
      @cancel="removing = null"
    />
    <ConfirmSheet
      v-if="resetting"
      title="Voltar às fontes iniciais?"
      message="Os sites e autores que você adicionou ou alterou serão substituídos pelos perfis iniciais do Proper: Working Preacher, Anglican Compass, My Pastoral Ponderings, Ponderings on a Faith Journey e seis autores."
      confirm-label="Voltar às iniciais"
      :busy="saving"
      @confirm="resetDefaults"
      @cancel="resetting = false"
    />
  </div>
</template>

<style scoped>
.items {
  list-style: none;
  margin: 0;
  padding: 0;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 54px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
}
.item__icon {
  flex: none;
  color: var(--accent);
}
.item__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.item__title {
  font-size: 13px;
  font-weight: 500;
}
.item__detail,
.item__description {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.list-state {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 0;
  font-size: 12px;
  color: var(--muted);
}
.group-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 46px;
}
.group-footer__note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--muted);
}
</style>
