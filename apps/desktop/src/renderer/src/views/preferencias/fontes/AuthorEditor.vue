<script setup lang="ts">
/** Folha para adicionar ou editar um autor favorito. */
import { reactive, ref } from 'vue'
import { UserPen } from 'lucide-vue-next'
import type { FavoriteAuthor } from '@pregar/core/sources/favorites'
import Sheet from '@/components/Sheet.vue'
import SheetHeader from '@/components/SheetHeader.vue'
import PButton from '@/components/PButton.vue'
import { validateFavoriteAuthor } from '../sources-form'

const props = defineProps<{ author: FavoriteAuthor; isNew: boolean; busy?: boolean }>()
const emit = defineEmits<{ save: [author: FavoriteAuthor]; close: [] }>()

const draft = reactive({ ...props.author, referenceURL: props.author.referenceURL ?? '' })
const error = ref<{ field: string; message: string } | null>(null)

function save(): void {
  const result = validateFavoriteAuthor({ ...draft, referenceURL: draft.referenceURL || null })
  if (!result.ok) {
    error.value = { field: result.field, message: result.message }
    return
  }
  error.value = null
  emit('save', result.author)
}
</script>

<template>
  <Sheet :label="isNew ? 'Adicionar autor favorito' : 'Editar autor favorito'" :width="520" @close="emit('close')">
    <form class="editor" novalidate @submit.prevent="save">
      <SheetHeader
        :title="isNew ? 'Adicionar autor favorito' : 'Editar autor favorito'"
        subtitle="A pesquisa de materiais prioriza estes autores; o sermão nunca é enviado."
        :icon="UserPen"
      />
      <div class="editor__grid">
        <label for="author-name">Nome do autor</label>
        <input id="author-name" v-model="draft.name" class="field" autofocus :aria-invalid="error?.field === 'name'" />
        <label for="author-url">Site do autor (opcional)</label>
        <input id="author-url" v-model="draft.referenceURL" class="field" spellcheck="false" placeholder="https://" :aria-invalid="error?.field === 'referenceURL'" />
      </div>
      <p v-if="error" class="editor__error" role="alert">{{ error.message }}</p>
      <div class="editor__actions">
        <PButton @click="emit('close')">Cancelar</PButton>
        <PButton variant="primary" type="submit" :busy="busy" :disabled="!draft.name.trim()">Salvar</PButton>
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
  grid-template-columns: 160px minmax(0, 1fr);
  align-items: center;
  gap: 10px 14px;
  font-size: 12px;
}
.editor__grid > label {
  color: var(--muted);
}
.editor__grid .field {
  width: 100%;
  height: 30px;
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
