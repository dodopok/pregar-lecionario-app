<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ExternalLink, RotateCw, WifiOff, X } from 'lucide-vue-next'
import { INVALID_WEB_ADDRESS_MESSAGE, readerWebUrl } from '@pregar/core/reader'
import type { ReaderRect, ReaderTabView, ReaderWebAction, ReaderWebState } from '@shared/ipc-reader'
import PButton from '@/components/PButton.vue'
import EmptyState from '@/components/EmptyState.vue'
import Spinner from '@/components/Spinner.vue'
import { invoke, shortcut } from '@/lib/api'
import { sameRect } from './reader-ui'

const props = defineProps<{
  tab: ReaderTabView
  state: ReaderWebState | null
  /** Folha aberta sobre a janela: a página nativa fica oculta para não cobri-la. */
  suspended: boolean
}>()

const emit = defineEmits<{ action: [action: ReaderWebAction, url?: string] }>()

const host = ref<HTMLDivElement | null>(null)
const addressInput = ref<HTMLInputElement | null>(null)
const address = ref(props.state?.url ?? props.tab.location)
const addressFocused = ref(false)
const invalidAddress = ref(false)
const loading = computed(() => props.state?.loading ?? true)
const progress = computed(() => props.state?.progress ?? 0.05)
const error = computed(() => props.state?.error ?? null)

watch(
  () => props.state?.url ?? props.tab.location,
  (url) => {
    if (!addressFocused.value) address.value = url
  },
)
watch(
  () => props.tab.id,
  () => {
    address.value = props.state?.url ?? props.tab.location
    invalidAddress.value = false
  },
)

function submit(): void {
  const url = readerWebUrl(address.value)
  if (url === null) {
    invalidAddress.value = true
    return
  }
  invalidAddress.value = false
  address.value = url
  addressInput.value?.blur()
  emit('action', 'load', url)
}

function cancelEditing(): void {
  address.value = props.state?.url ?? props.tab.location
  invalidAddress.value = false
  addressInput.value?.blur()
}

function focusAddress(): void {
  address.value = props.state?.url ?? props.tab.location
  addressInput.value?.focus()
  addressInput.value?.select()
}

// Posição da página nativa: a janela informa a área reservada sempre que ela muda.

let lastSent: { tabID: string | null; bounds: ReaderRect | null } = { tabID: null, bounds: null }
let frame = 0
let observer: ResizeObserver | null = null
let unmounted = false

function send(tabID: string | null, bounds: ReaderRect | null): void {
  if (lastSent.tabID === tabID && sameRect(lastSent.bounds, bounds)) return
  lastSent = { tabID, bounds }
  void invoke('reader:webViewport', { tabID, bounds }).catch(() => undefined)
}

function sync(): void {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    if (unmounted) return
    const element = host.value
    if (!element || props.suspended) return send(null, null)
    const rect = element.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return send(null, null)
    send(props.tab.id, { x: rect.left, y: rect.top, width: rect.width, height: rect.height })
  })
}

onMounted(() => {
  if (host.value) {
    observer = new ResizeObserver(sync)
    observer.observe(host.value)
  }
  window.addEventListener('resize', sync)
  sync()
})
onBeforeUnmount(() => {
  unmounted = true
  cancelAnimationFrame(frame)
  observer?.disconnect()
  window.removeEventListener('resize', sync)
  send(null, null)
})
watch(
  () => [props.tab.id, props.suspended, error.value, invalidAddress.value],
  () => void nextTick(sync),
)

defineExpose({ focusAddress, sync })
</script>

<template>
  <section class="web-pane" aria-label="Página web">
    <div class="web-toolbar">
      <PButton
        variant="icon"
        compact
        :label="loading ? 'Interromper carregamento' : 'Recarregar'"
        :title="loading ? 'Interromper carregamento' : `Recarregar (${shortcut('⌘R')})`"
        @click="emit('action', loading ? 'stop' : 'reload')"
      >
        <X v-if="loading" :size="15" aria-hidden="true" />
        <RotateCw v-else :size="14" aria-hidden="true" />
      </PButton>
      <input
        ref="addressInput"
        v-model="address"
        class="field web-toolbar__address"
        :class="{ 'web-toolbar__address--invalid': invalidAddress }"
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder="Endereço do site"
        :aria-label="`Endereço do site (${shortcut('⌘L')})`"
        :aria-invalid="invalidAddress || undefined"
        aria-describedby="reader-address-error"
        @focus="addressFocused = true"
        @blur="addressFocused = false"
        @keydown.enter.prevent="submit"
        @keydown.esc.prevent="cancelEditing"
      />
      <PButton variant="icon" compact label="Abrir no navegador" title="Abrir esta página no navegador padrão" @click="emit('action', 'openExternal')">
        <ExternalLink :size="14" aria-hidden="true" />
      </PButton>
    </div>
    <div class="web-progress" :class="{ 'web-progress--active': loading }" aria-hidden="true">
      <div class="web-progress__bar" :style="{ transform: `scaleX(${progress})` }" />
    </div>
    <p v-if="invalidAddress" id="reader-address-error" class="web-invalid" role="alert">{{ INVALID_WEB_ADDRESS_MESSAGE }}</p>
    <div ref="host" class="web-host">
      <div v-if="error" class="web-failure">
        <EmptyState :icon="WifiOff" title="Não foi possível carregar a página" :message="error">
          <PButton @click="emit('action', 'reload')"><RotateCw :size="13" aria-hidden="true" /> Tentar novamente</PButton>
        </EmptyState>
      </div>
      <div v-else class="web-placeholder" role="status">
        <Spinner v-if="loading" :size="18" label="Carregando página" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.web-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.web-toolbar {
  flex: none;
  height: 42px;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 0 var(--space-md);
  background: var(--canvas);
}
.web-toolbar__address {
  flex: 1;
  min-width: 0;
  font-size: 12px;
}
.web-toolbar__address--invalid,
.web-toolbar__address--invalid:focus {
  border-color: var(--danger);
}
.web-progress {
  flex: none;
  height: 2px;
  background: var(--line);
  opacity: 0;
  transition: opacity 0.3s;
}
.web-progress--active {
  opacity: 1;
}
.web-progress__bar {
  height: 100%;
  background: var(--accent);
  transform-origin: left center;
  transition: transform 0.25s var(--ease);
}
.web-invalid {
  flex: none;
  margin: 0;
  padding: 6px var(--space-md);
  font-size: 11px;
  color: var(--danger);
  background: var(--canvas);
}
.web-host {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--paper);
}
.web-failure,
.web-placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}
</style>
