<script setup lang="ts">
/**
 * Trilho à esquerda da Mesa: as áreas do Pregar (Mesa, Bíblia, Leitor, Biblioteca, Arquivo),
 * o estado da conexão (leituras e IA), ajuda e Preferências. Largo com rótulos a partir de
 * 1100 px; só ícones abaixo disso.
 */
import { computed } from 'vue'
import { BookOpen, CircleHelp, FileText, Library, PanelsTopLeft, ScrollText, Settings } from 'lucide-vue-next'
import type { WindowKind } from '@shared/types'
import PopMenu from '@/components/PopMenu.vue'
import { invoke, shortcut } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { useMesaStore } from '@/stores/mesa'

defineProps<{ compact: boolean }>()
const app = useAppStore()
const mesa = useMesaStore()

const AREAS: { kind: WindowKind; label: string; icon: typeof BookOpen; keys: string; title: string }[] = [
  {
    kind: 'mesa',
    label: 'Mesa',
    icon: PanelsTopLeft,
    keys: '⌘0',
    title: 'Mesa: calendário, leituras, manuscrito e materiais',
  },
  { kind: 'biblia', label: 'Bíblia', icon: BookOpen, keys: '⌘1', title: 'Bíblia: ler e comparar traduções' },
  {
    kind: 'leitor',
    label: 'Leitor',
    icon: FileText,
    keys: '⌘2',
    title: 'Leitor: PDFs e sites abertos para esta preparação',
  },
  {
    kind: 'biblioteca',
    label: 'Biblioteca',
    icon: Library,
    keys: '⌘3',
    title: 'Biblioteca: comentários em PDF indexados por passagem',
  },
  {
    kind: 'arquivo',
    label: 'Arquivo',
    icon: ScrollText,
    keys: '⌘4',
    title: 'Arquivo: todas as preparações, por data, ocasião ou passagem',
  },
]

const connection = computed(() => {
  switch (app.liturgyAccess.mode) {
    case 'proxy':
      return { tone: 'ok', label: 'Conectado', title: 'Leituras e revisão pela sua assinatura do Pregar' }
    case 'direct':
      return { tone: 'ok', label: 'Com chave', title: 'Leituras com a sua chave da Estêvão API' }
    case 'preview':
      return {
        tone: 'preview',
        label: 'Degustação',
        title: 'Leituras das próximas semanas sem conta. Conecte para ver tudo.',
      }
    default:
      return {
        tone: 'off',
        label: 'Conectar',
        title: 'Conecte as leituras e a revisão: assinatura ou chaves próprias',
      }
  }
})

function open(kind: WindowKind): void {
  if (kind === 'mesa') return
  void invoke('app:openWindow', { window: kind })
}
</script>

<template>
  <nav class="rail" :class="{ 'rail--compact': compact }" aria-label="Áreas do Pregar" data-tour="rail">
    <div class="rail__mark drag-region" aria-hidden="true"><span class="serif">P</span></div>
    <button
      v-for="area in AREAS"
      :key="area.kind"
      type="button"
      class="rail__item"
      :class="{ 'rail__item--current': area.kind === 'mesa' }"
      :aria-current="area.kind === 'mesa' ? 'page' : undefined"
      :aria-label="compact ? area.label : undefined"
      :title="`${area.title} (${shortcut(area.keys)})`"
      @click="open(area.kind)"
    >
      <component :is="area.icon" :size="17" aria-hidden="true" />
      <span v-if="!compact" class="rail__label">{{ area.label }}</span>
    </button>
    <span class="spacer" />
    <button
      type="button"
      class="rail__item rail__item--status"
      :class="`rail__item--${connection.tone}`"
      :aria-label="compact ? connection.label : undefined"
      :title="connection.title"
      data-tour="connect"
      @click="mesa.openSheet('connect')"
    >
      <span class="rail__dot" aria-hidden="true"><span /></span>
      <span v-if="!compact" class="rail__label">{{ connection.label }}</span>
    </button>
    <PopMenu label="Ajuda" align="left" :width="240">
      <template #default="{ toggle, open: isOpen }">
        <button
          type="button"
          class="rail__item rail__item--small"
          aria-label="Ajuda e tour"
          title="Ajuda e tour"
          :aria-expanded="isOpen"
          aria-haspopup="menu"
          @click="toggle"
        >
          <CircleHelp :size="17" aria-hidden="true" />
        </button>
      </template>
      <template #menu>
        <button type="button" role="menuitem" class="menu__item" @click="mesa.tourOpen = true">
          Rever o tour da Mesa
        </button>
        <button type="button" role="menuitem" class="menu__item" @click="mesa.openSheet('shortcuts')">
          Atalhos de teclado<kbd class="menu__keys">{{ shortcut('⌘/') }}</kbd>
        </button>
        <button type="button" role="menuitem" class="menu__item" @click="mesa.openSheet('commands')">
          Pesquisar comandos<kbd class="menu__keys">{{ shortcut('⌥/') }}</kbd>
        </button>
        <div class="menu__separator" role="separator" />
        <button
          type="button"
          role="menuitem"
          class="menu__item"
          @click="invoke('app:openWindow', { window: 'preferencias', route: '/preferencias/sobre' })"
        >
          Sobre o Pregar e registros
        </button>
      </template>
    </PopMenu>
    <button
      type="button"
      class="rail__item rail__item--small"
      aria-label="Preferências"
      :title="`Preferências (${shortcut('⌘,')})`"
      @click="invoke('app:openWindow', { window: 'preferencias' })"
    >
      <Settings :size="17" aria-hidden="true" />
    </button>
  </nav>
</template>

<style scoped>
.rail {
  flex: none;
  width: var(--rail-width);
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: calc(12px + var(--window-controls-top, 0px)) 0 10px;
  background: var(--sidebar);
  border-right: 1px solid var(--line);
}
.rail--compact {
  width: 48px;
  gap: 2px;
}
.rail__mark {
  width: 100%;
  display: grid;
  place-items: center;
  margin-bottom: 8px;
  padding-top: var(--window-controls-mesa-inset, 0px);
}
.rail__mark span {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  font-size: 17px;
  font-weight: 600;
  color: var(--accent-contrast);
  background: var(--accent);
  transition: background 0.3s;
}
.rail--compact .rail__mark span {
  width: 28px;
  height: 28px;
  font-size: 16px;
}
.rail__item {
  width: 60px;
  height: 50px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: none;
  border-radius: 10px;
  background: none;
  color: var(--ink-soft);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 1;
}
.rail--compact .rail__item {
  width: 38px;
  height: 38px;
  border-radius: 9px;
}
.rail__item:hover:not(.rail__item--current) {
  background: color-mix(in srgb, var(--ink) 6%, transparent);
  color: var(--ink);
}
.rail__item--current {
  color: var(--accent-ink);
  background: var(--paper);
  box-shadow: 0 0 0 1px var(--line);
  font-weight: 600;
}
.rail__item--small {
  height: 40px;
}
.rail--compact .rail__item--small,
.rail--compact .rail__item--status {
  height: 34px;
}
.rail__item--status {
  height: 44px;
}
.rail__label {
  max-width: 58px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: -0.01em;
}
.rail__dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--muted) 20%, transparent);
}
.rail__dot span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--muted);
}
.rail__item--ok .rail__dot {
  background: var(--accent-soft);
}
.rail__item--ok .rail__dot span {
  background: var(--accent);
}
.rail__item--preview .rail__dot {
  background: var(--warning-soft);
}
.rail__item--preview .rail__dot span {
  background: var(--warning);
}
.rail__item--off .rail__dot {
  box-shadow: inset 0 0 0 1.5px var(--muted);
  background: none;
}
.rail__item--off .rail__dot span {
  display: none;
}
</style>
