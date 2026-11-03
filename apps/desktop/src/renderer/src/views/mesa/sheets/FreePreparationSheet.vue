<script setup lang="ts">
/**
 * Nova preparação avulsa: um casamento, um funeral ou uma segunda pregação no mesmo dia. Ganha
 * uma chave com sufixo na data escolhida, a ocasião que você escrever e, se quiser, uma passagem
 * livre como texto principal.
 */
import { computed, ref } from 'vue'
import { CalendarPlus } from 'lucide-vue-next'
import { parseBrazilianDate, parseDateKey, shortDatePt } from '@pregar/core/util/dates'
import { sermonDateOf } from '@shared/sermon-key'
import PButton from '@/components/PButton.vue'
import Sheet from '@/components/Sheet.vue'
import SheetHeader from '@/components/SheetHeader.vue'
import { errorMessage } from '@/lib/api'
import { useMesaStore } from '@/stores/mesa'

const emit = defineEmits<{ close: [] }>()
const mesa = useMesaStore()

const initial = parseDateKey(sermonDateOf(mesa.selectedDateKey))
const dateText = ref(initial ? shortDatePt(initial) : '')
const occasion = ref('')
const reference = ref('')
const busy = ref(false)
const failure = ref<string | null>(null)

const dateKey = computed(() => parseBrazilianDate(dateText.value))
const canCreate = computed(() => Boolean(dateKey.value) && occasion.value.trim().length > 0 && !busy.value)

async function create(): Promise<void> {
  if (!canCreate.value || !dateKey.value) return
  busy.value = true
  failure.value = null
  try {
    await mesa.createFreePreparation({
      dateKey: dateKey.value,
      occasion: occasion.value.trim(),
      reference: reference.value.trim() || null,
    })
    emit('close')
  } catch (error) {
    failure.value = errorMessage(error)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Sheet :width="520" label="Nova preparação avulsa" :dismissible="!busy" @close="emit('close')">
    <form class="free" @submit.prevent="create">
      <SheetHeader
        title="Nova preparação avulsa"
        subtitle="Para um casamento, um funeral, uma celebração fora do lecionário ou uma segunda pregação no mesmo dia. Fica no calendário e no Arquivo junto da data."
        :icon="CalendarPlus"
      />
      <div class="free__field">
        <label for="free-date">Data da pregação</label>
        <input
          id="free-date"
          v-model="dateText"
          class="field free__date"
          placeholder="dd/mm/aaaa"
          inputmode="numeric"
          :aria-invalid="dateText.trim() !== '' && !dateKey"
        />
        <span v-if="dateText.trim() !== '' && !dateKey" class="free__error">Use o formato dd/mm/aaaa.</span>
      </div>
      <div class="free__field">
        <label for="free-occasion">Ocasião</label>
        <input
          id="free-occasion"
          v-model="occasion"
          class="field"
          placeholder="Casamento de Ana e Pedro"
          autofocus
          maxlength="200"
        />
        <span class="free__hint">Aparece no cabeçalho da Mesa, no calendário e no Arquivo.</span>
      </div>
      <div class="free__field">
        <label for="free-reference">Passagem principal (opcional)</label>
        <input
          id="free-reference"
          v-model="reference"
          class="field"
          placeholder="1 Coríntios 13:1-13"
          maxlength="200"
        />
        <span class="free__hint">Qualquer passagem; as leituras do dia continuam disponíveis no painel.</span>
      </div>
      <p v-if="failure" class="free__error" role="alert">{{ failure }}</p>
      <footer class="free__footer">
        <span class="spacer" />
        <PButton :disabled="busy" @click="emit('close')">Cancelar</PButton>
        <PButton variant="primary" type="submit" :busy="busy" :disabled="!canCreate"
          >Criar preparação</PButton
        >
      </footer>
    </form>
  </Sheet>
</template>

<style scoped>
.free {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.free__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--text-md);
}
.free__field label {
  font-weight: 500;
}
.free__field .field {
  height: 32px;
}
.free__date {
  width: 140px;
  font-variant-numeric: tabular-nums;
}
.free__hint {
  font-size: var(--text-xs);
  color: var(--muted);
}
.free__error {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--danger);
}
.free__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}
</style>
