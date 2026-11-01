<script setup lang="ts">
import { computed, reactive } from 'vue'
import { Pencil } from 'lucide-vue-next'
import type { PdfLibraryMetadataOverrides } from '@pregar/core/library/model'
import type { LibraryWork } from '@shared/ipc-library'
import PButton from '@/components/PButton.vue'
import Sheet from '@/components/Sheet.vue'
import SheetHeader from '@/components/SheetHeader.vue'
import { fileName } from './library-helpers'

/**
 * Correção local de metadados. Os campos começam com o que está sendo exibido; os valores lidos
 * do PDF aparecem como sugestão e "restaurar" volta cada campo a eles. Salvar sem diferenças em
 * relação ao PDF descarta a correção.
 */
const props = defineProps<{ work: LibraryWork; saving?: boolean }>()
const emit = defineEmits<{ close: []; save: [metadata: PdfLibraryMetadataOverrides | null] }>()

type Field = keyof PdfLibraryMetadataOverrides

const defaults: PdfLibraryMetadataOverrides = {
  title: props.work.extracted.title,
  author: props.work.extracted.author ?? '',
  publisher: '',
  year: '',
  volume: '',
  edition: '',
  language: '',
}

const values = reactive<PdfLibraryMetadataOverrides>({ ...defaults, ...(props.work.overrides ?? {}) })
if (props.work.overrides && props.work.overrides.title.trim() === '') values.title = defaults.title

const fields: { key: Field; label: string; hint: string; half?: boolean }[] = [
  { key: 'title', label: 'Título', hint: 'Título da obra' },
  { key: 'author', label: 'Autor', hint: 'Autoria ou organização' },
  { key: 'publisher', label: 'Editora', hint: 'Editora' },
  { key: 'year', label: 'Ano', hint: 'Ano', half: true },
  { key: 'volume', label: 'Volume', hint: 'Volume', half: true },
  { key: 'edition', label: 'Edição', hint: 'Edição', half: true },
  { key: 'language', label: 'Idioma', hint: 'Idioma', half: true },
]

function placeholder(field: (typeof fields)[number]): string {
  const extracted = defaults[field.key]
  return extracted ? `PDF: ${extracted}` : field.hint
}

function canRestore(key: Field): boolean {
  return values[key].trim() !== defaults[key].trim()
}

function restore(key: Field): void {
  values[key] = defaults[key]
}

const cleaned = computed<PdfLibraryMetadataOverrides>(() => ({
  title: values.title.trim(),
  author: values.author.trim(),
  publisher: values.publisher.trim(),
  year: values.year.trim(),
  volume: values.volume.trim(),
  edition: values.edition.trim(),
  language: values.language.trim(),
}))
const hasTitle = computed(() => cleaned.value.title !== '')
const matchesPdf = computed(() => (Object.keys(defaults) as Field[]).every((key) => cleaned.value[key] === defaults[key].trim()))

function submit(): void {
  if (!hasTitle.value || props.saving) return
  emit('save', matchesPdf.value ? null : cleaned.value)
}
</script>

<template>
  <Sheet label="Corrigir metadados" :width="560" @close="emit('close')">
    <form class="metadata" @submit.prevent="submit">
      <SheetHeader
        title="Corrigir metadados"
        subtitle="Os valores substituem os dados lidos do PDF; o arquivo não é alterado."
        :icon="Pencil"
      />
      <div class="metadata__fields">
        <div v-for="field in fields" :key="field.key" class="metadata__field" :class="{ 'metadata__field--half': field.half }">
          <label :for="`metadata-${field.key}`">{{ field.label }}</label>
          <input
            :id="`metadata-${field.key}`"
            v-model="values[field.key]"
            class="field"
            type="text"
            spellcheck="false"
            :placeholder="placeholder(field)"
            :autofocus="field.key === 'title'"
            :aria-describedby="defaults[field.key] ? `metadata-${field.key}-hint` : undefined"
          />
          <span v-if="defaults[field.key]" :id="`metadata-${field.key}-hint`" class="visually-hidden">
            Valor lido do PDF: {{ defaults[field.key] }}
          </span>
          <PButton
            variant="link"
            compact
            class="metadata__restore"
            :class="{ 'metadata__restore--hidden': !canRestore(field.key) }"
            :disabled="!canRestore(field.key)"
            :title="defaults[field.key] ? `Restaurar “${defaults[field.key]}”, lido do PDF` : 'Restaurar (deixar em branco)'"
            :label="`Restaurar ${field.label.toLowerCase()}`"
            @click="restore(field.key)"
          >
            restaurar
          </PButton>
        </div>
      </div>
      <footer class="metadata__footer">
        <span class="metadata__file" :title="work.path">{{ fileName(work.path) }}</span>
        <PButton @click="emit('close')">Cancelar</PButton>
        <PButton variant="primary" type="submit" :disabled="!hasTitle" :busy="saving">Salvar metadados</PButton>
      </footer>
    </form>
  </Sheet>
</template>

<style scoped>
.metadata {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}
.metadata__fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 11px 12px;
  padding: var(--space-lg) 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.metadata__field {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr) 64px;
  align-items: center;
  gap: 8px;
}
.metadata__field--half {
  grid-column: auto;
  grid-template-columns: 74px minmax(0, 1fr) 64px;
}
.metadata__field label {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
}
.metadata__restore {
  justify-self: start;
}
.metadata__restore--hidden {
  visibility: hidden;
}
.metadata__footer {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.metadata__file {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}
@media (max-width: 620px) {
  .metadata__field--half {
    grid-column: 1 / -1;
  }
}
</style>
