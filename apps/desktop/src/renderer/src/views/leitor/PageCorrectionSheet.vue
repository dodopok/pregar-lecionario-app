<script setup lang="ts">
import { ref } from 'vue'
import { Minus, Pencil, Plus } from 'lucide-vue-next'
import Sheet from '@/components/Sheet.vue'
import SheetHeader from '@/components/SheetHeader.vue'
import PButton from '@/components/PButton.vue'
import { clampPage } from './reader-ui'

const props = defineProps<{ title: string; page: number; pageCount: number }>()
const emit = defineEmits<{ close: []; save: [page: number] }>()
const page = ref(clampPage(props.page, props.pageCount))

function step(delta: number): void {
  page.value = clampPage(page.value + delta, props.pageCount)
}

function onInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value) && value > 0) page.value = clampPage(value, props.pageCount)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault()
    step(event.key === 'ArrowUp' ? 1 : -1)
  }
}
</script>

<template>
  <Sheet label="Corrigir página inicial" :width="500" @close="emit('close')">
    <form class="correction" @submit.prevent="emit('save', page)">
      <SheetHeader title="Corrigir página inicial" :subtitle="title" :icon="Pencil" />
      <div class="correction__stepper">
        <label for="correction-page">Página física</label>
        <PButton variant="icon" compact label="Página anterior" :disabled="page <= 1" @click="step(-1)">
          <Minus :size="14" aria-hidden="true" />
        </PButton>
        <input
          id="correction-page"
          class="field correction__input"
          type="number"
          min="1"
          :max="pageCount"
          :value="page"
          autofocus
          @change="onInput"
          @keydown="onKeydown"
        />
        <PButton variant="icon" compact label="Próxima página" :disabled="page >= pageCount" @click="step(1)">
          <Plus :size="14" aria-hidden="true" />
        </PButton>
        <span class="muted">de {{ pageCount }}</span>
      </div>
      <div class="correction__actions">
        <PButton @click="emit('close')">Cancelar</PButton>
        <PButton variant="primary" type="submit">Salvar</PButton>
      </div>
    </form>
  </Sheet>
</template>

<style scoped>
.correction {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.correction__stepper {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-variant-numeric: tabular-nums;
}
.correction__stepper label {
  margin-right: var(--space-xs);
}
.correction__input {
  width: 76px;
  text-align: center;
}
.correction__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}
</style>
