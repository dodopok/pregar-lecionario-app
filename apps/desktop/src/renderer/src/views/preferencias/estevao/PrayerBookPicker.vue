<script setup lang="ts">
/** Folha de escolha do livro de oração: busca, capas, metadados e recomendados primeiro. */
import { computed, ref } from 'vue'
import { BookMarked, CircleCheck, KeyRound, Search } from 'lucide-vue-next'
import { prayerBookDescription, prayerBookSubtitle } from '@pregar/core/liturgy/types'
import type { PrayerBookCatalogEntry } from '@pregar/core/liturgy/types'
import Sheet from '@/components/Sheet.vue'
import SheetHeader from '@/components/SheetHeader.vue'
import PButton from '@/components/PButton.vue'
import Spinner from '@/components/Spinner.vue'
import EmptyState from '@/components/EmptyState.vue'
import PrayerBookCover from './PrayerBookCover.vue'
import { filterPrayerBooks } from './catalog'

const props = defineProps<{
  books: PrayerBookCatalogEntry[]
  selectedCode: string
  loading: boolean
  error: string | null
  hasAccess: boolean
}>()
const emit = defineEmits<{ select: [code: string]; close: []; retry: [] }>()

const query = ref('')
const filtered = computed(() => filterPrayerBooks(props.books, query.value))
</script>

<template>
  <Sheet label="Livro de oração" :width="720" @close="emit('close')">
    <div class="picker">
      <SheetHeader title="Livro de oração" subtitle="Escolha pelo nome, jurisdição e descrição." :icon="BookMarked">
        <PButton @click="emit('close')">Fechar</PButton>
      </SheetHeader>

      <label class="picker__search">
        <Search :size="14" aria-hidden="true" />
        <input v-model="query" type="search" placeholder="Buscar nome, jurisdição ou descrição" aria-label="Buscar livros de oração" autofocus />
      </label>

      <div v-if="error && books.length > 0" class="picker__error" role="alert">
        {{ error }}
        <PButton compact :disabled="loading" @click="emit('retry')">Tentar novamente</PButton>
      </div>

      <div class="picker__body">
        <div v-if="loading && books.length === 0" class="picker__loading" role="status">
          <Spinner />
          <span>Carregando livros de oração…</span>
        </div>
        <EmptyState
          v-else-if="books.length === 0"
          :icon="hasAccess ? BookMarked : KeyRound"
          :title="hasAccess ? 'Catálogo indisponível' : 'Conecte a Estêvão API'"
          :message="
            hasAccess
              ? (error ?? 'Não foi possível carregar os livros agora.')
              : 'Salve sua chave da API nas Preferências (ou assine o Proper) para carregar os livros disponíveis.'
          "
        >
          <PButton v-if="hasAccess" compact :disabled="loading" @click="emit('retry')">Tentar novamente</PButton>
        </EmptyState>
        <EmptyState v-else-if="filtered.length === 0" :icon="Search" title="Nenhum livro encontrado" :message="`Nada corresponde a “${query}”.`" />
        <ul v-else class="picker__list" role="listbox" aria-label="Livros de oração">
          <li v-for="book in filtered" :key="book.code" role="presentation">
            <button
              type="button"
              role="option"
              class="book-row"
              :class="{ 'book-row--selected': book.code === selectedCode }"
              :aria-selected="book.code === selectedCode"
              :title="`Selecionar ${book.name}`"
              @click="emit('select', book.code)"
            >
              <PrayerBookCover :book="book" :width="54" :height="72" />
              <span class="book-row__text">
                <span class="book-row__title">
                  <span class="book-row__name">{{ book.name }}</span>
                  <span v-if="book.isRecommended" class="book-row__tag">Recomendado</span>
                </span>
                <span class="book-row__subtitle">{{ prayerBookSubtitle(book) }}</span>
                <span class="book-row__description">{{ prayerBookDescription(book) }}</span>
              </span>
              <CircleCheck v-if="book.code === selectedCode" :size="19" class="book-row__check" aria-label="Selecionado" />
            </button>
          </li>
        </ul>
      </div>
    </div>
  </Sheet>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.picker__search {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 36px;
  padding: 0 11px;
  border-radius: var(--radius-button);
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--muted);
}
.picker__search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.picker__search input {
  flex: 1;
  border: none;
  outline: none;
  background: none;
  color: var(--ink);
  font-size: 13px;
}
.picker__error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: var(--warning);
}
.picker__body {
  min-height: 320px;
  max-height: min(56vh, 520px);
  overflow: auto;
  margin: 0 -10px;
  padding: 0 10px;
}
.picker__loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 80px 0;
  font-size: 12px;
  color: var(--muted);
}
.picker__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.picker__list li + li {
  border-top: 1px solid var(--line);
}
.book-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 9px;
  border: none;
  border-radius: var(--radius-button);
  background: none;
  text-align: left;
}
.book-row:hover {
  background: color-mix(in srgb, var(--ink) 4%, transparent);
}
.book-row--selected,
.book-row--selected:hover {
  background: var(--accent-softer);
}
.book-row__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.book-row__title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.book-row__name {
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.book-row__tag {
  flex: none;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--accent);
}
.book-row__subtitle {
  font-size: 11px;
  font-weight: 500;
  color: var(--muted);
}
.book-row__description {
  font-size: 12px;
  color: color-mix(in srgb, var(--ink) 84%, transparent);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.book-row__check {
  flex: none;
  color: var(--accent);
}
</style>
