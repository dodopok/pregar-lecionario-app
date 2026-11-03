<script setup lang="ts">
/**
 * Primeiros passos: o que vale preparar antes do primeiro sermão, com o estado de cada item lido
 * do app (conexão, fontes e autores, comentários em PDF, Google Drive, sermões antigos e ritmo).
 * Cada cartão leva ao lugar certo; nada aqui é obrigatório.
 */
import { computed, onMounted, ref } from 'vue'
import { BookOpen, Check, Cloud, FileUp, Globe, KeyRound, Rocket, Timer } from 'lucide-vue-next'
import type { Component } from 'vue'
import PButton from '@/components/PButton.vue'
import Sheet from '@/components/Sheet.vue'
import SheetHeader from '@/components/SheetHeader.vue'
import { invoke } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { useMesaStore } from '@/stores/mesa'
import { driveStatus, ensureDriveStatus } from '../panels/driveState'

interface Step {
  id: string
  icon: Component
  title: string
  text: string
  status: string
  done: boolean
  action: string
  run: () => void
}

const emit = defineEmits<{ close: [] }>()
const app = useAppStore()
const mesa = useMesaStore()

const sites = ref<number | null>(null)
const authors = ref<number | null>(null)
const sourcesCustomized = ref(false)
const works = ref<number | null>(null)
const sermons = ref<number | null>(null)

const connected = computed(() => app.liturgyAccess.mode === 'proxy' || app.liturgyAccess.mode === 'direct')
const rhythmSet = computed(
  () =>
    app.settings.rhythm.measuredAt !== null ||
    app.settings.rhythm.preachingDay !== 0 ||
    app.settings.rhythm.targetMinutes !== 20,
)

function openPreferences(section: string): void {
  void invoke('app:openWindow', { window: 'preferencias', route: `/preferencias/${section}` })
}

const count = (value: number | null, one: string, many: string) =>
  value === null ? '…' : `${value} ${value === 1 ? one : many}`

const steps = computed<Step[]>(() => [
  {
    id: 'connect',
    icon: KeyRound,
    title: 'Conectar leituras e revisão',
    text: 'Assine o Proper ou use as suas chaves da Estêvão API e de um provedor de IA. Em degustação, só as próximas semanas aparecem.',
    status: connected.value
      ? app.liturgyAccess.message
      : app.liturgyAccess.mode === 'preview'
        ? 'Em degustação'
        : 'Ainda não conectado',
    done: connected.value,
    action: connected.value ? 'Ver conta' : 'Conectar',
    run: () =>
      connected.value ? openPreferences('conta') : mesa.openSheet('connect', { returnTo: 'setup' }),
  },
  {
    id: 'sources',
    icon: Globe,
    title: 'Sites e autores favoritos',
    text: 'Os sites que você já lê e os autores em quem confia. Os materiais de cada passagem passam a vir deles, com os seus autores na frente.',
    status: `${count(sites.value, 'site', 'sites')} · ${count(authors.value, 'autor', 'autores')}${sourcesCustomized.value ? '' : ' · os padrões do app'}`,
    done: sourcesCustomized.value,
    action: 'Adicionar fontes',
    run: () => openPreferences('fontes'),
  },
  {
    id: 'library',
    icon: BookOpen,
    title: 'Comentários em PDF',
    text: 'Importe os comentários bíblicos que você tem em PDF. A Biblioteca indexa por passagem e a Mesa mostra a seção certa para cada leitura.',
    status:
      works.value === 0 ? 'Nenhum PDF importado' : count(works.value, 'obra indexada', 'obras indexadas'),
    done: (works.value ?? 0) > 0,
    action: 'Abrir a Biblioteca',
    run: () => void invoke('app:openWindow', { window: 'biblioteca' }),
  },
  {
    id: 'drive',
    icon: Cloud,
    title: 'Google Drive',
    text: 'Opcional: o Google Doc do sermão na pasta do Drive e as ideias anotadas pelo celular. O Proper só vê os arquivos que ele mesmo cria.',
    status: !driveStatus.value
      ? '…'
      : !driveStatus.value.available
        ? 'Indisponível nesta versão'
        : driveStatus.value.connected
          ? 'Conectado'
          : 'Não conectado',
    done: Boolean(driveStatus.value?.connected),
    action: driveStatus.value?.connected ? 'Ver Drive' : 'Conectar o Drive',
    run: () => mesa.openSheet('drive', { returnTo: 'setup' }),
  },
  {
    id: 'archive',
    icon: FileUp,
    title: 'Sermões antigos',
    text: 'Traga o que você já pregou (.docx, .rtf, .txt, .md). Eles voltam em “Já preguei sobre isto” quando a mesma passagem chegar de novo.',
    status:
      sermons.value === 0
        ? 'Arquivo vazio'
        : count(sermons.value, 'preparação no Arquivo', 'preparações no Arquivo'),
    done: (sermons.value ?? 0) > 0,
    action: 'Importar no Arquivo',
    run: () => void invoke('app:openWindow', { window: 'arquivo' }),
  },
  {
    id: 'rhythm',
    icon: Timer,
    title: 'Dia de pregar e duração',
    text: 'Em que dia você prega, quantos minutos costuma durar o sermão e o seu ritmo de fala, para a Mesa estimar com os seus números.',
    status: rhythmSet.value
      ? `${app.settings.rhythm.targetMinutes} min · ${app.settings.rhythm.wordsPerMinute} palavras por minuto`
      : 'Padrão: domingo, 20 min',
    done: rhythmSet.value,
    action: 'Ajustar',
    run: () => openPreferences('ritmo'),
  },
])
const doneCount = computed(() => steps.value.filter((step) => step.done).length)

async function load(): Promise<void> {
  void ensureDriveStatus()
  const [profiles, library, list] = await Promise.all([
    invoke('sources:profiles').catch(() => null),
    invoke('library:count').catch(() => null),
    invoke('sermons:list').catch(() => null),
  ])
  sites.value = profiles?.sites.length ?? 0
  authors.value = profiles?.authors.length ?? 0
  sourcesCustomized.value = profiles?.customized === true
  works.value = library?.works ?? 0
  sermons.value = list?.length ?? 0
}

onMounted(load)
</script>

<template>
  <Sheet :width="720" label="Primeiros passos" @close="emit('close')">
    <div class="setup">
      <SheetHeader
        title="Primeiros passos"
        :subtitle="`${doneCount} de ${steps.length} prontos. Nada aqui é obrigatório; faça na ordem que quiser e volte por Ajuda › Primeiros passos.`"
        :icon="Rocket"
      />
      <ol class="setup__list">
        <li v-for="step in steps" :key="step.id" class="step" :class="{ 'step--done': step.done }">
          <span class="step__icon" aria-hidden="true">
            <Check v-if="step.done" :size="15" />
            <component :is="step.icon" v-else :size="15" />
          </span>
          <div class="step__text">
            <h3 class="serif step__title">{{ step.title }}</h3>
            <p class="step__body">{{ step.text }}</p>
            <p class="step__status" :class="{ 'step__status--done': step.done }">{{ step.status }}</p>
          </div>
          <PButton
            :variant="step.done ? 'secondary' : 'primary'"
            compact
            class="step__action"
            @click="step.run"
            >{{ step.action }}</PButton
          >
        </li>
      </ol>
      <footer class="setup__footer">
        <span class="setup__note"
          >O app funciona desde já; cada item só melhora o que a Mesa encontra para você.</span
        >
        <span class="spacer" />
        <PButton @click="emit('close')">Fechar</PButton>
      </footer>
    </div>
  </Sheet>
</template>

<style scoped>
.setup {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.setup__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.step {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--surface);
}
.step--done {
  background: var(--accent-softer);
  border-color: color-mix(in srgb, var(--accent) 25%, transparent);
}
.step__icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-button);
  color: var(--accent-ink);
  background: var(--accent-soft);
}
.step--done .step__icon {
  color: var(--accent-contrast);
  background: var(--accent);
}
.step__text {
  min-width: 0;
}
.step__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.step__body {
  margin: 2px 0 0;
  font-size: var(--text-sm);
  line-height: 1.5;
  color: var(--ink-soft);
}
.step__status {
  margin: 4px 0 0;
  font-size: var(--text-xs);
  color: var(--muted);
}
.step__status--done {
  color: var(--accent-ink);
  font-weight: 600;
}
.step__action {
  white-space: nowrap;
}
.setup__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}
.setup__note {
  font-size: var(--text-xs);
  color: var(--muted);
}
@media (max-width: 640px) {
  .step {
    grid-template-columns: 34px minmax(0, 1fr);
  }
  .step__action {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
