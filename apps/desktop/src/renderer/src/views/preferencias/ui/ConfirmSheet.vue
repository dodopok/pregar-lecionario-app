<script setup lang="ts">
/**
 * Confirmação de ação destrutiva. Com `requireText`, o botão só libera depois que a pessoa digita a
 * palavra pedida (por exemplo APAGAR).
 */
import { computed, ref } from 'vue'
import type { Component } from 'vue'
import Sheet from '@/components/Sheet.vue'
import SheetHeader from '@/components/SheetHeader.vue'
import PButton from '@/components/PButton.vue'

const props = withDefaults(
  defineProps<{
    title: string
    message: string
    confirmLabel: string
    cancelLabel?: string
    danger?: boolean
    busy?: boolean
    requireText?: string
    icon?: Component
    error?: string | null
  }>(),
  { cancelLabel: 'Cancelar', danger: true, busy: false, requireText: undefined, icon: undefined, error: null },
)
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const typed = ref('')
const unlocked = computed(() => !props.requireText || typed.value.trim().toUpperCase() === props.requireText)

function submit(): void {
  if (unlocked.value && !props.busy) emit('confirm')
}
</script>

<template>
  <Sheet :label="title" :width="480" @close="emit('cancel')">
    <form class="confirm" @submit.prevent="submit">
      <SheetHeader :title="title" :icon="icon" />
      <p class="confirm__message">{{ message }}</p>
      <slot />
      <label v-if="requireText" class="confirm__typed">
        <span>Para confirmar, digite <strong>{{ requireText }}</strong>:</span>
        <input v-model="typed" class="field" autocomplete="off" spellcheck="false" :aria-label="`Digite ${requireText} para confirmar`" autofocus />
      </label>
      <p v-if="error" class="confirm__error" role="alert">{{ error }}</p>
      <div class="confirm__actions">
        <PButton @click="emit('cancel')">{{ cancelLabel }}</PButton>
        <PButton :variant="danger ? 'danger' : 'primary'" type="submit" :disabled="!unlocked" :busy="busy">{{ confirmLabel }}</PButton>
      </div>
    </form>
  </Sheet>
</template>

<style scoped>
.confirm {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.confirm__message {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}
.confirm__typed {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}
.confirm__typed .field {
  height: 32px;
  font-family: var(--font-mono);
  letter-spacing: 0.08em;
}
.confirm__error {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}
.confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
