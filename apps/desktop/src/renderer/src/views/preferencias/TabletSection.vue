<script setup lang="ts">
/** Cópia de leitura para o tablet: tipografia, notas, formato (PDF ou Google Doc) e pasta. */
import { computed, onMounted, ref } from 'vue'
import { Folder, Minus, Plus } from 'lucide-vue-next'
import type { AppSettings } from '@shared/settings'
import PButton from '@/components/PButton.vue'
import Segmented from '@/components/Segmented.vue'
import Toggle from '@/components/Toggle.vue'
import { invoke } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import PrefGroup from './ui/PrefGroup.vue'
import PrefRow from './ui/PrefRow.vue'

const MIN_SIZE = 12
const MAX_SIZE = 32
const FONTS = ['Georgia', 'Charter', 'Palatino', 'Times New Roman', 'Arial', 'Verdana', 'Helvetica']

const app = useAppStore()
const suggestedFolder = ref<string | null>(null)

const tablet = computed(() => app.settings.tablet)
const fontOptions = computed(() => (FONTS.includes(tablet.value.fontFamily) ? FONTS : [tablet.value.fontFamily, ...FONTS]))
const folder = computed(() => tablet.value.lastExportFolder ?? suggestedFolder.value)

function update(patch: Partial<AppSettings['tablet']>): void {
  void app.updateSettings({ tablet: patch })
}

function setSize(value: number): void {
  if (Number.isNaN(value)) return
  update({ fontSize: Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(value))) })
}

async function chooseFolder(): Promise<void> {
  const chosen = await invoke('app:chooseFolder', { title: 'Pasta para as cópias do tablet' }).catch(() => null)
  if (chosen) update({ lastExportFolder: chosen })
}

onMounted(async () => {
  suggestedFolder.value = await invoke('tablet:suggestedFolder').catch(() => null)
})
</script>

<template>
  <div class="section-stack">
    <PrefGroup label="Leitura no tablet">
      <PrefRow label="Fonte de leitura" for="tablet-font">
        <select id="tablet-font" class="field select" :value="tablet.fontFamily" @change="update({ fontFamily: ($event.target as HTMLSelectElement).value })">
          <option v-for="font in fontOptions" :key="font" :value="font">{{ font }}</option>
        </select>
      </PrefRow>
      <PrefRow label="Tamanho">
        <div class="stepper" role="group" aria-label="Tamanho da letra">
          <PButton variant="icon" compact label="Diminuir a letra" :disabled="tablet.fontSize <= MIN_SIZE" @click="setSize(tablet.fontSize - 1)">
            <Minus :size="14" />
          </PButton>
          <output class="stepper__value" aria-live="polite">{{ tablet.fontSize }} pt</output>
          <PButton variant="icon" compact label="Aumentar a letra" :disabled="tablet.fontSize >= MAX_SIZE" @click="setSize(tablet.fontSize + 1)">
            <Plus :size="14" />
          </PButton>
        </div>
      </PrefRow>
      <PrefRow label="Prévia" top>
        <p class="preview" :style="{ fontFamily: `'${tablet.fontFamily}', var(--font-serif)`, fontSize: `${tablet.fontSize}px` }">
          No princípio era o Verbo, e o Verbo estava com Deus, e o Verbo era Deus.
        </p>
      </PrefRow>
      <PrefRow label="Notas">
        <Toggle
          class="wide"
          :model-value="tablet.includeNotes"
          label="Incluir as notas de rodapé"
          description="As notas aparecem no fim da cópia de leitura."
          @update:model-value="update({ includeNotes: $event })"
        />
      </PrefRow>
    </PrefGroup>

    <PrefGroup label="Formato">
      <PrefRow label="Enviar como" top>
        <Segmented
          :model-value="tablet.format"
          label="Formato da cópia do tablet"
          :options="[
            { value: 'pdf', label: 'PDF' },
            { value: 'gdoc', label: 'Google Doc' },
          ]"
          @update:model-value="update({ format: $event })"
        />
        <p class="hint">
          {{
            tablet.format === 'pdf'
              ? 'Um arquivo PDF para abrir no tablet (por exemplo, pela pasta do Drive ou por um app de leitura).'
              : 'Um documento no seu Google Drive, que você abre no app Google Docs do tablet.'
          }}
          <RouterLink v-if="tablet.format === 'gdoc'" to="/preferencias/drive" replace>Conectar o Google Drive</RouterLink>
        </p>
      </PrefRow>
      <PrefRow v-if="tablet.format === 'pdf'" label="Pasta dos PDFs">
        <div class="folder">
          <span class="folder__path selectable" :class="{ 'folder__path--empty': !folder }" :title="folder ?? ''">{{ folder ?? 'Escolha uma pasta' }}</span>
          <PButton compact @click="chooseFolder"><Folder :size="13" aria-hidden="true" />Escolher…</PButton>
        </div>
      </PrefRow>
    </PrefGroup>
  </div>
</template>

<style scoped>
.select {
  min-width: 220px;
  height: 30px;
}
.stepper {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.stepper__value {
  min-width: 52px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}
.preview {
  margin: 0;
  max-width: 460px;
  padding: 12px 16px;
  border-radius: var(--radius-button);
  background: var(--manuscript);
  border: 1px solid var(--line);
  line-height: 1.45;
}
.wide {
  width: 100%;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.folder {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.folder__path {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.folder__path--empty {
  color: var(--muted);
  font-family: var(--font-ui);
  direction: ltr;
}
</style>
