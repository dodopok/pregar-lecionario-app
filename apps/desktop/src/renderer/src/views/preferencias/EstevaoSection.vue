<script setup lang="ts">
/**
 * Estêvão API: de onde vêm as leituras (assinatura ou chave própria), a chave X-API-Key e o contexto
 * litúrgico (livro de oração, leituras dominicais, tradução e idioma).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ChevronsUpDown, ExternalLink, KeyRound, Trash2 } from 'lucide-vue-next'
import { ESTEVAO_API_BASE_URL, prayerBookDescription, prayerBookSubtitle } from '@pregar/core/liturgy/types'
import type { BibleVersion, PrayerBookCatalogEntry } from '@pregar/core/liturgy/types'
import type { AppSettings } from '@shared/settings'
import PButton from '@/components/PButton.vue'
import { errorMessage, invoke, platform } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import PrefGroup from './ui/PrefGroup.vue'
import PrefRow from './ui/PrefRow.vue'
import Notice from './ui/Notice.vue'
import PrayerBookCover from './estevao/PrayerBookCover.vue'
import PrayerBookPicker from './estevao/PrayerBookPicker.vue'
import { FALLBACK_BIBLES, bibleVersionLabel, languageOptions, selectedPrayerBook } from './estevao/catalog'
import { openExternal } from './composables'

const ESTEVAO_SITE = 'https://estevao.caminhoanglicano.com.br'

const app = useAppStore()

const key = ref('')
const saving = ref(false)
const removing = ref(false)
const result = ref<{ tone: 'success' | 'error'; text: string } | null>(null)
const books = ref<PrayerBookCatalogEntry[]>([])
const booksLoading = ref(false)
const booksError = ref<string | null>(null)
const versions = ref<BibleVersion[]>([])
const showPicker = ref(false)

const liturgy = computed(() => app.settings.liturgy)
const viaSubscription = computed(() => app.liturgyAccess.mode === 'proxy')
const subscriptionAvailable = computed(() => app.account.loggedIn && Boolean(app.account.account?.features.estevaoProxy))
const hasKey = computed(() => app.secrets?.estevao === true)
const hasAccess = computed(() => app.liturgyAccess.mode !== 'none')
const vaultMissing = computed(() => app.secrets !== null && !app.secrets.encryptionAvailable && platform() === 'linux')
const selectedBook = computed(() => selectedPrayerBook(books.value, liturgy.value.prayerBook))
const bibleOptions = computed(() => {
  const list = versions.value.length > 0 ? versions.value : FALLBACK_BIBLES
  if (list.some((version) => version.code === liturgy.value.bible)) return list
  return [...list, { code: liturgy.value.bible, name: liturgy.value.bible.toUpperCase() }]
})
const languages = computed(() => languageOptions(books.value, liturgy.value.language))

async function loadCatalogues(): Promise<void> {
  if (!hasAccess.value) {
    books.value = []
    versions.value = []
    booksError.value = null
    return
  }
  booksLoading.value = true
  booksError.value = null
  const [loadedBooks, loadedVersions] = await Promise.allSettled([invoke('liturgy:prayerBooks'), invoke('liturgy:bibleVersions')])
  if (loadedBooks.status === 'fulfilled') books.value = loadedBooks.value
  else booksError.value = errorMessage(loadedBooks.reason)
  if (loadedVersions.status === 'fulfilled') versions.value = loadedVersions.value
  booksLoading.value = false
}

async function saveAndTest(): Promise<void> {
  saving.value = true
  result.value = null
  try {
    const value = key.value.trim()
    if (value) {
      await invoke('secrets:set', { name: 'estevao', value })
      key.value = ''
      await app.refreshSecrets()
    }
    if (!app.secrets?.estevao) {
      result.value = { tone: 'error', text: 'Informe sua chave pessoal da Estêvão API para consultar a v2.' }
      return
    }
    const loaded = await invoke('liturgy:prayerBooks')
    books.value = loaded
    booksError.value = null
    result.value = {
      tone: 'success',
      text: `Conectado. A API respondeu com ${loaded.length} ${loaded.length === 1 ? 'livro de oração' : 'livros de oração'}.`,
    }
    void loadCatalogues()
  } catch (caught) {
    result.value = { tone: 'error', text: errorMessage(caught) }
  } finally {
    saving.value = false
  }
}

async function removeKey(): Promise<void> {
  removing.value = true
  result.value = null
  try {
    await invoke('secrets:delete', { name: 'estevao' })
    await app.refreshSecrets()
    result.value = { tone: 'success', text: 'Chave removida deste computador.' }
  } catch (caught) {
    result.value = { tone: 'error', text: errorMessage(caught) }
  } finally {
    removing.value = false
  }
}

function update(patch: Partial<AppSettings['liturgy']>): void {
  void app.updateSettings({ liturgy: patch })
}

function selectBook(code: string): void {
  update({ prayerBook: code })
  showPicker.value = false
}

watch(() => app.liturgyAccess.mode, () => void loadCatalogues())
onMounted(loadCatalogues)
</script>

<template>
  <div class="section-stack">
    <Notice v-if="viaSubscription" tone="success" title="As leituras vêm da sua assinatura">
      Calendário, leituras e textos bíblicos chegam pelo servidor do Proper. Você não precisa de chave. O livro de oração, a tradução e o
      idioma abaixo continuam valendo.
    </Notice>
    <Notice v-else-if="subscriptionAvailable" tone="info">
      Você escolheu usar as suas próprias chaves (em Inteligência artificial). Por isso, as leituras usam a chave salva abaixo.
    </Notice>

    <template v-if="!viaSubscription">
      <PrefGroup label="Conexão">
        <PrefRow label="Endereço">
          <span class="mono selectable">{{ ESTEVAO_API_BASE_URL }}</span>
        </PrefRow>
        <PrefRow label="Chave X-API-Key" for="estevao-key">
          <form class="key-form" @submit.prevent="saveAndTest">
            <input
              id="estevao-key"
              v-model="key"
              class="field key-form__input"
              type="password"
              autocomplete="off"
              spellcheck="false"
              :placeholder="hasKey ? 'Chave salva; deixe vazio para mantê-la' : 'estevao_…'"
            />
            <PButton variant="primary" type="submit" :busy="saving">Salvar e testar</PButton>
          </form>
          <div class="key-status">
            <span class="key-status__label" :class="{ 'key-status__label--saved': hasKey }">
              <KeyRound :size="13" aria-hidden="true" />{{ hasKey ? 'Chave salva neste computador' : 'Nenhuma chave salva' }}
            </span>
            <PButton v-if="hasKey" variant="ghost" compact class="danger-text" :busy="removing" @click="removeKey">
              <Trash2 :size="13" aria-hidden="true" />Remover chave
            </PButton>
          </div>
        </PrefRow>
      </PrefGroup>

      <Notice v-if="vaultMissing" tone="warning" title="Cofre de senhas indisponível">
        O Proper guarda chaves no cofre de senhas do sistema. Instale o gnome-keyring (ou o KWallet) e abra o Proper de novo.
      </Notice>
      <Notice v-if="result" :tone="result.tone">{{ result.text }}</Notice>

      <div class="help">
        <p>A chave é pessoal e fica só neste computador; a tela nunca a mostra de volta.</p>
        <p>
          Não tem chave?
          <a href="#" @click.prevent="openExternal(ESTEVAO_SITE)">Peça a sua no site da Estêvão API<ExternalLink :size="11" aria-hidden="true" class="help__icon" /></a>.
          <template v-if="!subscriptionAvailable">
            Prefere não lidar com chaves? <RouterLink to="/preferencias/conta" replace>Assine o Proper</RouterLink>.
          </template>
        </p>
      </div>
    </template>

    <PrefGroup label="Contexto litúrgico">
      <PrefRow label="Livro de oração" top>
        <button
          type="button"
          class="book-button"
          :title="'Escolher livro de oração'"
          :aria-label="`Livro de oração: ${selectedBook.name}. ${prayerBookSubtitle(selectedBook)}. ${prayerBookDescription(selectedBook)}. Escolher outro.`"
          @click="showPicker = true"
        >
          <PrayerBookCover :book="selectedBook" :width="42" :height="56" />
          <span class="book-button__text">
            <span class="book-button__name">{{ selectedBook.name }}</span>
            <span class="book-button__subtitle">{{ prayerBookSubtitle(selectedBook) }}</span>
            <span class="book-button__description">{{ prayerBookDescription(selectedBook) }}</span>
          </span>
          <ChevronsUpDown :size="14" class="book-button__chevron" aria-hidden="true" />
        </button>
      </PrefRow>
      <PrefRow label="Leituras dominicais" for="reading-type" hint="Alguns livros trazem duas séries de leituras para o Tempo Comum.">
        <select id="reading-type" class="field select" :value="liturgy.readingType" @change="update({ readingType: ($event.target as HTMLSelectElement).value })">
          <option value="">Padrão do LOC</option>
          <option value="complementary">Complementar</option>
          <option value="semicontinuous">Semicontínua</option>
        </select>
      </PrefRow>
      <PrefRow label="Tradução principal" for="main-bible" hint="Usada nas leituras da Mesa e como primeira coluna na Bíblia.">
        <select id="main-bible" class="field select select--wide" :value="liturgy.bible" @change="update({ bible: ($event.target as HTMLSelectElement).value })">
          <option v-for="version in bibleOptions" :key="version.code" :value="version.code">{{ bibleVersionLabel(version) }}</option>
        </select>
      </PrefRow>
      <PrefRow label="Idioma" for="liturgy-language" hint="Idioma dos nomes litúrgicos e das coletas.">
        <select id="liturgy-language" class="field select" :value="liturgy.language" @change="update({ language: ($event.target as HTMLSelectElement).value })">
          <option v-for="option in languages" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </PrefRow>
    </PrefGroup>

    <p class="access-line" role="status">{{ app.liturgyAccess.message }}</p>

    <PrayerBookPicker
      v-if="showPicker"
      :books="books"
      :selected-code="liturgy.prayerBook"
      :loading="booksLoading"
      :error="booksError"
      :has-access="hasAccess"
      @select="selectBook"
      @close="showPicker = false"
      @retry="loadCatalogues"
    />
  </div>
</template>

<style scoped>
.mono {
  font-family: var(--font-mono);
  font-size: 13px;
}
.key-form {
  display: flex;
  gap: 8px;
  width: 100%;
}
.key-form__input {
  flex: 1;
  max-width: 340px;
  height: 30px;
}
.key-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: -2px;
}
.key-status__label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.key-status__label--saved {
  color: var(--accent);
}
.danger-text {
  color: var(--danger);
}
.help {
  margin-top: -8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.6;
}
.help p {
  margin: 0;
}
.help__icon {
  margin-left: 3px;
  vertical-align: -1px;
}
.book-button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px;
  margin: -6px;
  border: none;
  border-radius: var(--radius-button);
  background: none;
  text-align: left;
}
.book-button:hover {
  background: color-mix(in srgb, var(--ink) 4%, transparent);
}
.book-button__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.book-button__name {
  font-family: var(--font-serif);
  font-size: 14px;
  font-weight: 600;
}
.book-button__subtitle {
  font-size: 11px;
  color: var(--muted);
}
.book-button__description {
  font-size: 11px;
  color: var(--muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.book-button__chevron {
  flex: none;
  color: var(--muted);
}
.select {
  min-width: 220px;
  height: 30px;
}
.select--wide {
  min-width: 300px;
  max-width: 100%;
}
.access-line {
  margin: -8px 0 0;
  font-size: 12px;
  color: var(--muted);
}
</style>
