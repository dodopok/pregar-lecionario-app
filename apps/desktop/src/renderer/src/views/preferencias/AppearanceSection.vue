<script setup lang="ts">
/** Aparência: automático, claro ou escuro para todas as janelas; o acento segue a cor litúrgica. */
import { computed } from 'vue'
import { Monitor, Moon, Sun } from 'lucide-vue-next'
import { TEXT_SCALES } from '@shared/settings'
import type { AppearanceMode } from '@shared/settings'
import { normalizeLiturgicalColor } from '@pregar/core/liturgy/types'
import { useAppStore } from '@/stores/app'
import PrefGroup from './ui/PrefGroup.vue'
import PrefRow from './ui/PrefRow.vue'

const app = useAppStore()

const MODES: { value: AppearanceMode; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'Automático', icon: Monitor },
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
]
const COLOR_NAMES: Record<string, string> = {
  green: 'verde',
  white: 'branco',
  red: 'vermelho',
  purple: 'roxo',
  rose: 'rosa',
  black: 'preto',
  blue: 'azul',
  gold: 'dourado',
}

const colorName = computed(() => COLOR_NAMES[normalizeLiturgicalColor(app.settings.liturgy.lastColor) ?? 'green'] ?? 'verde')

function choose(mode: AppearanceMode): void {
  void app.updateSettings({ appearance: mode })
}

function chooseScale(value: number): void {
  void app.updateSettings({ textScale: value })
}

function onKeydown(event: KeyboardEvent): void {
  const index = MODES.findIndex((mode) => mode.value === app.settings.appearance)
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
  if (!step) return
  event.preventDefault()
  const next = MODES[(index + step + MODES.length) % MODES.length]
  if (next) {
    choose(next.value)
    ;(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="radio"]')[MODES.indexOf(next)]?.focus()
  }
}
</script>

<template>
  <div class="section-stack">
    <PrefGroup>
      <PrefRow label="Aparência">
        <div class="modes" role="radiogroup" aria-label="Aparência" @keydown="onKeydown">
          <button
            v-for="mode in MODES"
            :key="mode.value"
            type="button"
            role="radio"
            class="mode"
            :class="{ 'mode--active': app.settings.appearance === mode.value }"
            :aria-checked="app.settings.appearance === mode.value"
            :tabindex="app.settings.appearance === mode.value ? 0 : -1"
            @click="choose(mode.value)"
          >
            <component :is="mode.icon" :size="14" aria-hidden="true" />{{ mode.label }}
          </button>
        </div>
      </PrefRow>
      <PrefRow label="Cor de acento">
        <span class="accent">
          <span class="accent__swatch" aria-hidden="true" />
          Segue a cor litúrgica do dia selecionado na Mesa (agora, {{ colorName }}).
        </span>
      </PrefRow>
    </PrefGroup>
    <PrefGroup label="Texto da interface">
      <PrefRow label="Tamanho" top hint="Vale para menus, painéis e leituras em todas as janelas. O manuscrito tem o próprio tamanho na barra do editor.">
        <div class="modes" role="radiogroup" aria-label="Tamanho do texto da interface">
          <button
            v-for="scale in TEXT_SCALES"
            :key="scale.value"
            type="button"
            role="radio"
            class="mode"
            :class="{ 'mode--active': app.settings.textScale === scale.value }"
            :aria-checked="app.settings.textScale === scale.value"
            @click="chooseScale(scale.value)"
          >
            {{ scale.label }} <span class="mode__pct">{{ Math.round(scale.value * 100) }}%</span>
          </button>
        </div>
        <p class="sample" :style="{ fontSize: `${13 * app.settings.textScale}px` }">Assim fica o texto dos painéis e das leituras.</p>
      </PrefRow>
    </PrefGroup>
    <p class="help">A aparência vale para todas as janelas e folhas. “Automático” acompanha o ajuste do sistema.</p>
  </div>
</template>

<style scoped>
.modes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mode__pct {
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--muted);
}
.sample {
  margin: 4px 0 0;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-button);
  background: var(--paper);
  line-height: 1.45;
}
.mode {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--control);
  padding: 0 12px;
  border-radius: var(--radius-button);
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-size: 12px;
  font-weight: 500;
}
.mode:hover {
  background: color-mix(in srgb, var(--ink) 4%, var(--surface));
}
.mode--active,
.mode--active:hover {
  color: var(--accent-ink);
  font-weight: 600;
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 50%, transparent);
}
.accent {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
}
.accent__swatch {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent);
  transition: background 0.3s var(--ease);
}
.help {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
</style>
