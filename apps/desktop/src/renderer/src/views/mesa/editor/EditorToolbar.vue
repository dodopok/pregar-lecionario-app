<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Editor } from '@tiptap/core'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  PaintRoller,
  Palette,
  Quote,
  Redo2,
  Search,
  Strikethrough,
  Superscript,
  Underline,
  Undo2,
} from 'lucide-vue-next'
import type { SelectionFormatting } from '@pregar/editor'
import { shortcut } from '@/lib/api'

const props = defineProps<{ editor: Editor; formatting: SelectionFormatting; zoom: number; compact: boolean }>()
const emit = defineEmits<{ find: []; link: []; zoom: [value: number] }>()

type Commands = Record<string, (...args: unknown[]) => { run(): boolean }>
const chain = () => props.editor.chain().focus() as unknown as Commands & { run(): boolean }
function run(command: string, ...args: unknown[]): void {
  ;(chain()[command]!(...args) as { run(): boolean }).run()
}

const STYLES = [
  { value: 'normal', label: 'Texto normal' },
  { value: 'heading1', label: 'Título 1' },
  { value: 'heading2', label: 'Título 2' },
  { value: 'heading3', label: 'Título 3' },
  { value: 'heading4', label: 'Título 4' },
  { value: 'heading5', label: 'Título 5' },
  { value: 'heading6', label: 'Título 6' },
]
const FONTS = ['Arial', 'Georgia', 'Times New Roman', 'Garamond', 'Palatino', 'Book Antiqua', 'Helvetica', 'Verdana', 'Calibri', 'Cambria', 'Trebuchet MS', 'Courier New']
const COLORS = ['#000000', '#5f6368', '#c5221f', '#e37400', '#188038', '#1a73e8', '#7b1fa2', '#b06000']
const HIGHLIGHTS = ['#fff475', '#ccff90', '#a7ffeb', '#cbf0f8', '#fdcfe8', '#e6c9a8']
const SPACINGS = [1, 1.15, 1.5, 2]
const ZOOMS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 2]

const openPalette = ref<null | 'color' | 'highlight' | 'spacing'>(null)
const fontSizeText = computed(() => String(Math.round(props.formatting.fontSizePt * 10) / 10).replace('.', ','))

function setFontSize(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value.replace(',', '.'))
  if (Number.isFinite(value) && value >= 6 && value <= 96) run('setFontSizePt', value)
}

function toggleList(kind: 'bullet' | 'ordered' | 'check'): void {
  const command = kind === 'bullet' ? 'toggleBulletList' : kind === 'ordered' ? 'toggleOrderedList' : 'toggleTaskList'
  run(command)
}

function pick(kind: 'color' | 'highlight' | 'spacing', value: string | number | null): void {
  if (kind === 'color') run('setTextColor', value)
  else if (kind === 'highlight') run('setHighlightColor', value)
  else run('setLineSpacing', value)
  openPalette.value = null
}
</script>

<template>
  <div class="toolbar" role="toolbar" aria-label="Formatação do manuscrito">
    <button type="button" class="tool" :disabled="!formatting.canUndo" :title="`Desfazer (${shortcut('⌘Z')})`" aria-label="Desfazer" @click="run('undo')"><Undo2 :size="15" /></button>
    <button type="button" class="tool" :disabled="!formatting.canRedo" :title="`Refazer (${shortcut('⇧⌘Z')})`" aria-label="Refazer" @click="run('redo')"><Redo2 :size="15" /></button>
    <select class="tool-select tool-select--zoom" :value="zoom" aria-label="Zoom" title="Zoom" @change="emit('zoom', Number(($event.target as HTMLSelectElement).value))">
      <option v-for="value in ZOOMS" :key="value" :value="value">{{ Math.round(value * 100) }}%</option>
    </select>
    <span class="sep" />
    <select class="tool-select tool-select--style" :value="formatting.paragraphStyle" aria-label="Estilo do parágrafo" :title="`Estilo (${shortcut('⌥⌘0')}…${shortcut('⌥⌘6')})`" @change="run('setParagraphStyle', ($event.target as HTMLSelectElement).value)">
      <option v-for="style in STYLES" :key="style.value" :value="style.value">{{ style.label }}</option>
    </select>
    <template v-if="!compact">
      <select class="tool-select tool-select--font" :value="formatting.fontFamily" aria-label="Fonte" title="Fonte" @change="run('setFontFamily', ($event.target as HTMLSelectElement).value)">
        <option v-for="font in FONTS" :key="font" :value="font" :style="{ fontFamily: font }">{{ font }}</option>
        <option v-if="!FONTS.includes(formatting.fontFamily)" :value="formatting.fontFamily">{{ formatting.fontFamily }}</option>
      </select>
      <span class="sep" />
      <button type="button" class="tool" aria-label="Diminuir fonte" title="Diminuir fonte" @click="run('decreaseFontSize')">−</button>
      <input class="tool-size" :value="fontSizeText" aria-label="Tamanho da fonte em pontos" inputmode="decimal" @change="setFontSize" @keydown.enter.prevent="setFontSize" />
      <button type="button" class="tool" aria-label="Aumentar fonte" title="Aumentar fonte" @click="run('increaseFontSize')">+</button>
    </template>
    <span class="sep" />
    <button type="button" class="tool" :class="{ on: formatting.bold }" :aria-pressed="formatting.bold" :title="`Negrito (${shortcut('⌘B')})`" aria-label="Negrito" @click="run('toggleBold')"><Bold :size="15" /></button>
    <button type="button" class="tool" :class="{ on: formatting.italic }" :aria-pressed="formatting.italic" :title="`Itálico (${shortcut('⌘I')})`" aria-label="Itálico" @click="run('toggleItalic')"><Italic :size="15" /></button>
    <button type="button" class="tool" :class="{ on: formatting.underline }" :aria-pressed="formatting.underline" :title="`Sublinhado (${shortcut('⌘U')})`" aria-label="Sublinhado" @click="run('toggleUnderline')"><Underline :size="15" /></button>
    <button v-if="!compact" type="button" class="tool" :class="{ on: formatting.strike }" :aria-pressed="formatting.strike" :title="`Tachado (${shortcut('⇧⌘X')})`" aria-label="Tachado" @click="run('toggleStrike')"><Strikethrough :size="15" /></button>
    <div class="popover-anchor">
      <button type="button" class="tool" title="Cor do texto" aria-label="Cor do texto" :aria-expanded="openPalette === 'color'" @click="openPalette = openPalette === 'color' ? null : 'color'"><Palette :size="15" /></button>
      <div v-if="openPalette === 'color'" class="palette" role="menu" aria-label="Cores do texto">
        <button v-for="color in COLORS" :key="color" type="button" class="swatch" :style="{ background: color }" :aria-label="`Cor ${color}`" role="menuitem" @click="pick('color', color)" />
        <button type="button" class="swatch-reset" role="menuitem" @click="pick('color', null)">Automática</button>
      </div>
    </div>
    <div class="popover-anchor">
      <button type="button" class="tool" title="Cor de realce" aria-label="Cor de realce" :aria-expanded="openPalette === 'highlight'" @click="openPalette = openPalette === 'highlight' ? null : 'highlight'"><Highlighter :size="15" /></button>
      <div v-if="openPalette === 'highlight'" class="palette" role="menu" aria-label="Cores de realce">
        <button v-for="color in HIGHLIGHTS" :key="color" type="button" class="swatch" :style="{ background: color }" :aria-label="`Realce ${color}`" role="menuitem" @click="pick('highlight', color)" />
        <button type="button" class="swatch-reset" role="menuitem" @click="pick('highlight', null)">Nenhum</button>
      </div>
    </div>
    <button type="button" class="tool" :class="{ on: formatting.link }" :title="`Link (${shortcut('⌘K')})`" aria-label="Link" @click="emit('link')"><Link2 :size="15" /></button>
    <button type="button" class="tool" :class="{ on: formatting.superscript }" :title="`Nota de rodapé (${shortcut('⌥⌘F')})`" aria-label="Inserir nota de rodapé" @click="run('insertFootnote', {})"><Superscript :size="15" /></button>
    <span class="sep" />
    <template v-if="!compact">
      <button type="button" class="tool" :class="{ on: formatting.alignment === 'left' }" :title="`Alinhar à esquerda (${shortcut('⇧⌘L')})`" aria-label="Alinhar à esquerda" @click="run('setTextAlign', 'left')"><AlignLeft :size="15" /></button>
      <button type="button" class="tool" :class="{ on: formatting.alignment === 'center' }" :title="`Centralizar (${shortcut('⇧⌘E')})`" aria-label="Centralizar" @click="run('setTextAlign', 'center')"><AlignCenter :size="15" /></button>
      <button type="button" class="tool" :class="{ on: formatting.alignment === 'right' }" :title="`Alinhar à direita (${shortcut('⇧⌘R')})`" aria-label="Alinhar à direita" @click="run('setTextAlign', 'right')"><AlignRight :size="15" /></button>
      <button type="button" class="tool" :class="{ on: formatting.alignment === 'justify' }" :title="`Justificar (${shortcut('⇧⌘J')})`" aria-label="Justificar" @click="run('setTextAlign', 'justify')"><AlignJustify :size="15" /></button>
      <div class="popover-anchor">
        <button type="button" class="tool tool--text" title="Espaçamento entre linhas" aria-label="Espaçamento entre linhas" :aria-expanded="openPalette === 'spacing'" @click="openPalette = openPalette === 'spacing' ? null : 'spacing'">{{ String(formatting.lineHeight).replace('.', ',') }}</button>
        <div v-if="openPalette === 'spacing'" class="palette palette--list" role="menu" aria-label="Espaçamento">
          <button v-for="value in SPACINGS" :key="value" type="button" role="menuitemradio" :aria-checked="formatting.lineHeight === value" class="menu-item" @click="pick('spacing', value)">
            {{ value === 1 ? 'Simples' : value === 2 ? 'Duplo' : String(value).replace('.', ',') }}
          </button>
        </div>
      </div>
      <span class="sep" />
    </template>
    <button type="button" class="tool" :class="{ on: formatting.list === 'bullet' }" :title="`Lista com marcadores (${shortcut('⇧⌘8')})`" aria-label="Lista com marcadores" @click="toggleList('bullet')"><List :size="15" /></button>
    <button type="button" class="tool" :class="{ on: formatting.list === 'ordered' }" :title="`Lista numerada (${shortcut('⇧⌘7')})`" aria-label="Lista numerada" @click="toggleList('ordered')"><ListOrdered :size="15" /></button>
    <button v-if="!compact" type="button" class="tool" :class="{ on: formatting.list === 'check' }" :title="`Lista de verificação (${shortcut('⇧⌘9')})`" aria-label="Lista de verificação" @click="toggleList('check')"><ListChecks :size="15" /></button>
    <button type="button" class="tool" :class="{ on: formatting.quote }" title="Citação em bloco" aria-label="Citação em bloco" @click="run('toggleQuote')"><Quote :size="15" /></button>
    <template v-if="!compact">
      <button type="button" class="tool" :title="`Diminuir recuo (${shortcut('⌘[')})`" aria-label="Diminuir recuo" @click="run('outdent')"><IndentDecrease :size="15" /></button>
      <button type="button" class="tool" :title="`Aumentar recuo (${shortcut('⌘]')})`" aria-label="Aumentar recuo" @click="run('indent')"><IndentIncrease :size="15" /></button>
      <button type="button" class="tool" :class="{ on: formatting.hasCopiedFormatting }" :title="`Copiar formatação (${shortcut('⌥⌘C')}) · colar (${shortcut('⌥⌘V')})`" aria-label="Copiar formatação" @click="formatting.hasCopiedFormatting ? run('pasteFormatting') : run('copyFormatting')"><PaintRoller :size="15" /></button>
    </template>
    <button type="button" class="tool" :title="`Limpar formatação (${shortcut('⌘\\\\')})`" aria-label="Limpar formatação" @click="run('clearFormatting')"><Eraser :size="15" /></button>
    <span class="spacer" />
    <button type="button" class="tool" :title="`Localizar e substituir (${shortcut('⌘F')})`" aria-label="Localizar e substituir" @click="emit('find')"><Search :size="15" /></button>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 1px;
  min-height: 40px;
  padding: 4px 10px;
  margin: 8px 12px 0;
  border-radius: 20px;
  background: var(--doc-toolbar);
  color: var(--doc-ink);
  overflow: visible;
  flex-wrap: wrap;
}
.tool {
  min-width: 28px;
  height: 28px;
  padding: 0 4px;
  border: none;
  border-radius: 5px;
  background: none;
  color: var(--doc-ink);
  display: inline-grid;
  place-items: center;
  font-size: 14px;
}
.tool--text {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.tool:hover:not(:disabled) {
  background: color-mix(in srgb, var(--doc-ink) 8%, transparent);
}
.tool:disabled {
  opacity: 0.35;
}
.tool.on {
  color: var(--doc-blue);
  background: color-mix(in srgb, var(--doc-blue) 16%, transparent);
}
.tool-select {
  height: 28px;
  border: none;
  border-radius: 5px;
  background: none;
  color: var(--doc-ink);
  font-size: 12px;
  padding: 0 4px;
}
.tool-select:hover {
  background: color-mix(in srgb, var(--doc-ink) 8%, transparent);
}
.tool-select--style {
  width: 112px;
}
.tool-select--font {
  width: 120px;
}
.tool-size {
  width: 40px;
  height: 24px;
  border: 1px solid var(--doc-border);
  border-radius: 4px;
  text-align: center;
  font-size: 12px;
  background: var(--doc-paper);
  color: var(--doc-ink);
}
.sep {
  width: 1px;
  height: 18px;
  margin: 0 4px;
  background: var(--doc-border);
}
.popover-anchor {
  position: relative;
}
.palette {
  position: absolute;
  top: 32px;
  left: 0;
  z-index: 30;
  display: grid;
  grid-template-columns: repeat(4, 22px);
  gap: 6px;
  padding: 10px;
  border-radius: 8px;
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-pop);
}
.palette--list {
  grid-template-columns: 1fr;
  min-width: 110px;
  padding: 4px;
  gap: 0;
}
.swatch {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--line-strong);
}
.swatch-reset {
  grid-column: 1 / -1;
  border: none;
  background: none;
  font-size: 11px;
  color: var(--muted);
  text-align: left;
}
.menu-item {
  height: 28px;
  border: none;
  background: none;
  text-align: left;
  padding: 0 10px;
  border-radius: 5px;
  font-size: 12px;
}
.menu-item:hover,
.menu-item[aria-checked='true'] {
  background: color-mix(in srgb, var(--doc-blue) 12%, transparent);
}
</style>
