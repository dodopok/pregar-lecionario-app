<script setup lang="ts">
/**
 * Cobrança Pix em aberto: QR code, código "copia e cola", valor e prazo. Enquanto `waiting`, mostra
 * que o app está esperando a confirmação do banco (a consulta fica com quem usa o componente).
 */
import { computed, ref, watch } from 'vue'
import { Check, Copy } from 'lucide-vue-next'
import type { BillingMethod, PixCharge } from '@pregar/core/plans/contract'
import PButton from '@/components/PButton.vue'
import Spinner from '@/components/Spinner.vue'
import { useToasts } from '@/stores/toasts'
import { copyText, useNow } from '../composables'
import { describeCountdown, formatBRL, formatCountdown, remainingMs } from '../format'

const props = withDefaults(defineProps<{ charge: PixCharge; method: BillingMethod; waiting?: boolean; firstCharge?: boolean }>(), {
  waiting: true,
  firstCharge: true,
})
const emit = defineEmits<{ expired: [] }>()

const toasts = useToasts()
const now = useNow()
const copied = ref(false)

const remaining = computed(() => remainingMs(props.charge.expiresAt, now.value))
const expired = computed(() => remaining.value !== null && remaining.value <= 0)
const imageSource = computed(() => `data:image/png;base64,${props.charge.image}`)

watch(expired, (value) => {
  if (value) emit('expired')
})

async function copy(): Promise<void> {
  const ok = await copyText(props.charge.payload)
  if (ok) {
    copied.value = true
    toasts.show('Código Pix copiado. Cole no app do seu banco, na opção Pix Copia e Cola.', 'success')
    setTimeout(() => (copied.value = false), 2500)
  } else {
    toasts.show('Não foi possível copiar. Selecione o código abaixo e copie manualmente.', 'error')
  }
}
</script>

<template>
  <div class="pix" :class="{ 'pix--expired': expired }">
    <div class="pix__qr">
      <img :src="imageSource" width="188" height="188" alt="QR code do Pix. Leia com a câmera do app do seu banco." />
      <span v-if="expired" class="pix__qr-overlay">Código expirado</span>
    </div>
    <div class="pix__info">
      <div class="pix__amount">
        <span class="pix__value">{{ formatBRL(charge.valueCents) }}</span>
        <span v-if="remaining !== null && !expired" class="pix__countdown" :aria-label="`O código vale por mais ${describeCountdown(remaining)}`">
          O código vale por <strong>{{ formatCountdown(remaining) }}</strong>
        </span>
      </div>
      <ol class="pix__steps">
        <li>Abra o app do seu banco e escolha <strong>Pix</strong>.</li>
        <li>Leia o QR code com a câmera ou use <strong>Pix Copia e Cola</strong> com o código abaixo.</li>
        <li v-if="method === 'pix_automatico' && firstCharge">
          Confirme o pagamento e <strong>autorize o Pix Automático</strong>. As próximas cobranças serão debitadas sozinhas.
        </li>
        <li v-else>Confirme o pagamento. A confirmação aparece aqui sozinha.</li>
      </ol>
      <div class="pix__copy">
        <PButton variant="primary" :disabled="expired" @click="copy">
          <component :is="copied ? Check : Copy" :size="14" aria-hidden="true" />{{ copied ? 'Código copiado' : 'Copiar código Pix' }}
        </PButton>
      </div>
      <label class="pix__payload-label" for="pix-payload">Código Pix (copia e cola)</label>
      <textarea id="pix-payload" class="pix__payload selectable" readonly rows="4" :value="charge.payload" @focus="($event.target as HTMLTextAreaElement).select()" />
      <p v-if="waiting && !expired" class="pix__waiting" role="status">
        <Spinner :size="13" label="Aguardando pagamento" />
        Aguardando a confirmação do banco. Pode levar alguns segundos depois do pagamento.
      </p>
    </div>
  </div>
</template>

<style scoped>
.pix {
  display: flex;
  gap: 22px;
  align-items: flex-start;
  padding: 16px 0;
}
.pix__qr {
  flex: none;
  position: relative;
  padding: 8px;
  border-radius: var(--radius-card);
  background: var(--surface);
  border: 1px solid var(--line-strong);
  line-height: 0;
}
.pix__qr img {
  display: block;
  width: 188px;
  height: 188px;
  image-rendering: pixelated;
  border-radius: 4px;
}
.pix--expired .pix__qr img {
  opacity: 0.18;
  filter: grayscale(1);
}
.pix__qr-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--ink);
}
.pix__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pix__amount {
  display: flex;
  align-items: baseline;
  gap: 14px;
  flex-wrap: wrap;
}
.pix__value {
  font-family: var(--font-serif);
  font-size: 24px;
  font-weight: 600;
}
.pix__countdown {
  font-size: 12px;
  color: var(--muted);
}
.pix__countdown strong {
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.pix__steps {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  line-height: 1.45;
}
.pix__copy {
  display: flex;
  gap: 8px;
}
.pix__payload-label {
  font-size: 11px;
  color: var(--muted);
  margin-bottom: -6px;
}
.pix__payload {
  width: 100%;
  resize: none;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.4;
  padding: 6px 8px;
  border-radius: var(--radius-control);
  border: 1px solid var(--line);
  background: color-mix(in srgb, var(--ink) 4%, var(--surface));
  color: var(--muted);
  word-break: break-all;
  overflow-y: auto;
  scrollbar-width: thin;
}
.pix__waiting {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
}
@media (max-width: 760px) {
  .pix {
    flex-direction: column;
  }
}
</style>
