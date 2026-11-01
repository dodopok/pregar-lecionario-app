<script setup lang="ts">
/** Folha para adicionar ou editar um site favorito (FavoriteSiteEditor do Swift). */
import { computed, reactive, ref } from 'vue'
import { Globe } from 'lucide-vue-next'
import { FAVORITE_SITE_ADAPTERS, favoriteSiteAdapterTitle } from '@pregar/core/sources/favorites'
import type { FavoriteSite } from '@pregar/core/sources/favorites'
import Sheet from '@/components/Sheet.vue'
import SheetHeader from '@/components/SheetHeader.vue'
import PButton from '@/components/PButton.vue'
import { TEMPLATE_VARIABLES, adapterUsesTemplate, validateFavoriteSite } from '../sources-form'

const props = defineProps<{ site: FavoriteSite; isNew: boolean; busy?: boolean }>()
const emit = defineEmits<{ save: [site: FavoriteSite]; close: [] }>()

const draft = reactive<FavoriteSite>({ ...props.site, feedURL: props.site.feedURL ?? '' })
const error = ref<{ field: string; message: string } | null>(null)
const usesTemplate = computed(() => adapterUsesTemplate(draft.adapter))

const ADAPTER_HELP: Record<string, string> = {
  workingPreacherArchive: 'Consulta o arquivo de comentários do Working Preacher pela passagem.',
  anglicanCompass: 'Consulta o Anglican Compass pelo domingo do calendário (Proper).',
  wordpress: 'Para blogs em WordPress próprios: busca pela API do site.',
  wordpressCom: 'Para blogs hospedados no WordPress.com.',
  blogger: 'Para blogs do Blogger (Blogspot).',
  rssAtom: 'Lê o feed do site e procura a passagem nos títulos e resumos.',
  websiteSearch: 'Abre a página de busca do site com a passagem já digitada.',
}

function save(): void {
  const result = validateFavoriteSite({ ...draft, feedURL: draft.feedURL || null })
  if (!result.ok) {
    error.value = { field: result.field, message: result.message }
    document.getElementById(`site-${result.field}`)?.focus()
    return
  }
  error.value = null
  emit('save', result.site)
}
</script>

<template>
  <Sheet :label="isNew ? 'Adicionar site favorito' : 'Editar site favorito'" :width="600" @close="emit('close')">
    <form class="editor" novalidate @submit.prevent="save">
      <SheetHeader
        :title="isNew ? 'Adicionar site favorito' : 'Editar site favorito'"
        subtitle="Fontes favoritas são consultadas por passagem na aba Materiais da Mesa."
        :icon="Globe"
      />
      <div class="editor__grid">
        <label for="site-title">Nome</label>
        <input id="site-title" v-model="draft.title" class="field" autofocus :aria-invalid="error?.field === 'title'" />

        <label for="site-baseURL">Endereço base (HTTPS)</label>
        <input id="site-baseURL" v-model="draft.baseURL" class="field" spellcheck="false" placeholder="https://" :aria-invalid="error?.field === 'baseURL'" />

        <label for="site-detail">Descrição</label>
        <input id="site-detail" v-model="draft.detail" class="field" placeholder="Ex.: Comentários semanais" />

        <label for="site-tradition">Tradição / jurisdição (opcional)</label>
        <input id="site-tradition" v-model="draft.tradition" class="field" placeholder="Ex.: Anglicana (ACNA)" />

        <label for="site-language">Idioma</label>
        <input id="site-language" v-model="draft.language" class="field" placeholder="Ex.: inglês" />

        <label for="site-adapter">Tipo de site</label>
        <div class="editor__control">
          <select id="site-adapter" v-model="draft.adapter" class="field">
            <option v-for="adapter in FAVORITE_SITE_ADAPTERS" :key="adapter" :value="adapter">{{ favoriteSiteAdapterTitle(adapter) }}</option>
          </select>
          <span class="editor__hint">{{ ADAPTER_HELP[draft.adapter] }}</span>
        </div>

        <template v-if="draft.adapter === 'rssAtom'">
          <label for="site-feedURL">URL do feed</label>
          <div class="editor__control">
            <input id="site-feedURL" v-model="draft.feedURL" class="field" spellcheck="false" placeholder="Vazio = /feed" :aria-invalid="error?.field === 'feedURL'" />
          </div>
        </template>

        <template v-if="usesTemplate">
          <label for="site-searchURLTemplate">URL de busca</label>
          <div class="editor__control">
            <input
              id="site-searchURLTemplate"
              v-model="draft.searchURLTemplate"
              class="field mono"
              spellcheck="false"
              :aria-invalid="error?.field === 'searchURLTemplate'"
              aria-describedby="site-variables"
            />
            <span id="site-variables" class="editor__hint">
              Variáveis: <code v-for="variable in TEMPLATE_VARIABLES" :key="variable">{{ variable }}</code>. Por exemplo, {query} vira “Matthew 21”.
            </span>
          </div>
        </template>
      </div>

      <p v-if="error" class="editor__error" role="alert">{{ error.message }}</p>

      <div class="editor__actions">
        <PButton @click="emit('close')">Cancelar</PButton>
        <PButton variant="primary" type="submit" :busy="busy" :disabled="!draft.title.trim()">Salvar</PButton>
      </div>
    </form>
  </Sheet>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.editor__grid {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  align-items: center;
  gap: 10px 14px;
  font-size: 12px;
}
.editor__grid > label {
  color: var(--muted);
  align-self: start;
  padding-top: 6px;
}
.editor__grid .field {
  width: 100%;
  height: 30px;
}
.editor__control {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.editor__hint {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
}
.editor__hint code {
  font-family: var(--font-mono);
  font-size: 10px;
  margin: 0 2px;
  padding: 1px 4px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--ink) 7%, transparent);
}
.mono {
  font-family: var(--font-mono);
  font-size: 12px;
}
.editor__error {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}
.editor__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
[aria-invalid='true'] {
  border-color: var(--danger);
}
</style>
