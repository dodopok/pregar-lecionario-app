<script setup lang="ts">
import { ref } from 'vue'
import { ArrowRight, Globe } from 'lucide-vue-next'
import { INVALID_WEB_ADDRESS_MESSAGE, readerWebUrl } from '@pregar/core/reader'
import Sheet from '@/components/Sheet.vue'
import SheetHeader from '@/components/SheetHeader.vue'
import PButton from '@/components/PButton.vue'

const emit = defineEmits<{ close: []; open: [url: string] }>()
const address = ref('https://')
const error = ref<string | null>(null)

function submit(): void {
  const url = readerWebUrl(address.value)
  if (url === null) {
    error.value = INVALID_WEB_ADDRESS_MESSAGE
    return
  }
  emit('open', url)
}
</script>

<template>
  <Sheet label="Nova aba" :width="500" @close="emit('close')">
    <form class="new-tab" @submit.prevent="submit">
      <SheetHeader title="Nova aba" subtitle="Abra um artigo ou site no Leitor, ao lado dos PDFs da Biblioteca." :icon="Globe" />
      <input
        v-model="address"
        class="field new-tab__field"
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder="Endereço web"
        aria-label="Endereço web"
        :aria-invalid="error !== null || undefined"
        aria-describedby="new-tab-error"
        autofocus
        @input="error = null"
      />
      <p v-if="error" id="new-tab-error" class="new-tab__error" role="alert">{{ error }}</p>
      <div class="new-tab__actions">
        <PButton @click="emit('close')">Cancelar</PButton>
        <PButton variant="primary" type="submit">Abrir <ArrowRight :size="14" aria-hidden="true" /></PButton>
      </div>
    </form>
  </Sheet>
</template>

<style scoped>
.new-tab {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.new-tab__field {
  width: 100%;
}
.new-tab__error {
  margin: -8px 0 0;
  font-size: 12px;
  color: var(--danger);
}
.new-tab__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}
</style>
