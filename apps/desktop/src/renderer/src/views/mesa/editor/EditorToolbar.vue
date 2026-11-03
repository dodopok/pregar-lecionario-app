<script setup lang="ts">
/**
 * Barra curta do manuscrito: desfazer, estilo, negrito/itálico/sublinhado, citação (com poema),
 * listas, anotação só sua, nota e link. O resto (fonte, cores, alinhamento, espaçamento, recuo,
 * zoom) fica no menu Mais, para não pesar a Mesa.
 */
import { computed, ref } from 'vue'
import type { Editor } from '@tiptap/core'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Eraser,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  MessageSquareText,
  PaintRoller,
  Palette,
  Quote,
  Redo2,
  Search,
  SlidersHorizontal,
  Strikethrough,
  Superscript,
  Underline,
  Undo2,
} from 'lucide-vue-next'
import type { SelectionFormatting } from '@pregar/editor'
import PopMenu from '@/components/PopMenu.vue'
import { shortcut } from '@/lib/api'

const props = defineProps<{ editor: Editor; formatting: SelectionFormatting; zoom: number; compact: boolean }>()
const emit = defineEmits<{ find: []; link: []; zoom: [value: number] }>()

type Commands = Record<string, (...args: unknown[]) => { run(): boolean }>
const chain = () => props.editor.chain().focus() as unknown as Commands & { run(): boolean }
function run(command: string, ...args: unknown[]): void {
  const step = chain()[command]
  if (typeof step === 'function') (step(...args) as { run(): boolean }).run()
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
const ZOOMS = [0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.75, 2]

const fontSizeText = computed(() => String(Math.round(props.formatting.fontSizePt * 10) / 10).replace('.', ','))
// `formatting` muda a cada transação; os estados abaixo acompanham sem observar o editor.
const annotationActive = computed(() => Boolean(props.formatting) && props.editor.isActive('annotation'))
const quoteKind = computed<string | null>(() => {
  if (!props.formatting || !props.editor.isActive('blockquote')) return null
  return String((props.editor.getAttributes('blockquote') as { kind?: string }).kind ?? 'quote')
})
const moreOpen = ref(false)

function setFontSize(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value.replace(',', '.'))
  if (Number.isFinite(value) && value >= 6 && value <= 96) run('setFontSizePt', value)
}

function setQuote(kind: 'quote' | 'poem' | null): void {
  if (kind === null) {
    if (quoteKind.value !== null) run('toggleQuote')
    return
  }
  if (quoteKind.value === null) run('toggleQuote')
  run('setBlockquoteKind', kind)
}

function pick(kind: 'color' | 'highlight' | 'spacing', value: string | number | null): void {
  if (kind === 'color') run('setTextColor', value)
  else if (kind === 'highlight') run('setHighlightColor', value)
  else run('setLineSpacing', value)
}
</script>

<template>
  <div class="toolbar" :class="{ 'toolbar--compact': compact }" role="toolbar" aria-label="Formatação do manuscrito">
    <button type="button" class="tool" :disabled="!formatting.canUndo" :title="`Desfazer (${shortcut('⌘Z')})`" aria-label="Desfazer" @click="run('undo')"><Undo2 :size="15" /></button>
    <button type="button" class="tool" :disabled="!formatting.canRedo" :title="`Refazer (${shortcut('⇧⌘Z')})`" aria-label="Refazer" @click="run('redo')"><Redo2 :size="15" /></button>
    <span class="sep" />
    <select class="tool-select tool-select--style" :value="formatting.paragraphStyle" aria-label="Estilo do parágrafo" :title="`Estilo (${shortcut('⌥⌘0')}…${shortcut('⌥⌘6')})`" @change="run('setParagraphStyle', ($event.target as HTMLSelectElement).value)">
      <option v-for="style in STYLES" :key="style.value" :value="style.value">{{ style.label }}</option>
    </select>
    <span class="sep" />
    <button type="button" class="tool" :class="{ on: formatting.bold }" :aria-pressed="formatting.bold" :title="`Negrito (${shortcut('⌘B')})`" aria-label="Negrito" @click="run('toggleBold')"><Bold :size="15" /></button>
    <button type="button" class="tool" :class="{ on: formatting.italic }" :aria-pressed="formatting.italic" :title="`Itálico (${shortcut('⌘I')})`" aria-label="Itálico" @click="run('toggleItalic')"><Italic :size="15" /></button>
    <button type="button" class="tool" :class="{ on: formatting.underline }" :aria-pressed="formatting.underline" :title="`Sublinhado (${shortcut('⌘U')})`" aria-label="Sublinhado" @click="run('toggleUnderline')"><Underline :size="15" /></button>
    <span class="sep" />
    <PopMenu label="Citação" :width="220">
      <template #default="{ toggle, open }">
        <button type="button" class="tool tool--split" :class="{ on: quoteKind !== null }" :aria-pressed="quoteKind !== null" :aria-expanded="open" aria-haspopup="menu" :title="quoteKind === 'poem' ? 'Poema ou versos' : 'Citação em bloco'" aria-label="Citação" @click="toggle">
          <Quote :size="15" /><ChevronDown :size="11" class="tool__caret" aria-hidden="true" />
        </button>
      </template>
      <template #menu>
        <button type="button" role="menuitemradio" class="menu__item" :class="{ 'menu__item--active': quoteKind === 'quote' }" :aria-checked="quoteKind === 'quote'" @click="setQuote('quote')">
          Citação em bloco<span class="menu__hint">Texto de outro autor, em itálico</span>
        </button>
        <button type="button" role="menuitemradio" class="menu__item" :class="{ 'menu__item--active': quoteKind === 'poem' }" :aria-checked="quoteKind === 'poem'" @click="setQuote('poem')">
          Poema ou versos<span class="menu__hint">Preserva as quebras de linha, com recuo</span>
        </button>
        <template v-if="quoteKind !== null">
          <div class="menu__separator" role="separator" />
          <button type="button" role="menuitem" class="menu__item" @click="setQuote(null)">Voltar a texto normal</button>
        </template>
      </template>
    </PopMenu>
    <button type="button" class="tool" :class="{ on: formatting.list === 'bullet' }" :title="`Lista com marcadores (${shortcut('⇧⌘8')})`" aria-label="Lista com marcadores" @click="run('toggleBulletList')"><List :size="15" /></button>
    <button type="button" class="tool" :class="{ on: formatting.list === 'ordered' }" :title="`Lista numerada (${shortcut('⇧⌘7')})`" aria-label="Lista numerada" @click="run('toggleOrderedList')"><ListOrdered :size="15" /></button>
    <span class="sep" />
    <button
      type="button"
      class="tool tool--labeled"
      :class="{ on: annotationActive }"
      :aria-pressed="annotationActive"
      :title="`Anotação só para você: fica fora da contagem, do púlpito e do ensaio (${shortcut('⇧⌘A')})`"
      aria-label="Anotação só para você"
      @click="run('toggleAnnotation')"
    >
      <MessageSquareText :size="15" /><span v-if="!compact">Anotação</span>
    </button>
    <button type="button" class="tool" :class="{ on: formatting.superscript }" :title="`Nota de rodapé (${shortcut('⌥⌘F')})`" aria-label="Inserir nota de rodapé" @click="run('insertFootnote', {})"><Superscript :size="15" /></button>
    <button type="button" class="tool" :class="{ on: formatting.link }" :title="`Link (${shortcut('⌘K')})`" aria-label="Link" @click="emit('link')"><Link2 :size="15" /></button>
    <span class="sep" />
    <PopMenu label="Mais formatação" align="left" :width="320" @open="moreOpen = true" @close="moreOpen = false">
      <template #default="{ toggle, open }">
        <button type="button" class="tool tool--labeled" :aria-expanded="open" aria-haspopup="menu" title="Mais: fonte, cores, alinhamento, espaçamento, recuo e zoom" aria-label="Mais formatação" @click="toggle">
          <SlidersHorizontal :size="15" /><span v-if="!compact">Mais</span><ChevronDown :size="11" class="tool__caret" aria-hidden="true" />
        </button>
      </template>
      <template #menu>
        <div class="more">
          <div class="more__row">
            <label class="more__label" for="editor-font">Fonte</label>
            <select id="editor-font" class="field field--compact more__grow" :value="formatting.fontFamily" @change="run('setFontFamily', ($event.target as HTMLSelectElement).value)">
              <option v-for="font in FONTS" :key="font" :value="font" :style="{ fontFamily: font }">{{ font }}</option>
              <option v-if="!FONTS.includes(formatting.fontFamily)" :value="formatting.fontFamily">{{ formatting.fontFamily }}</option>
            </select>
            <button type="button" class="tool" aria-label="Diminuir fonte" title="Diminuir fonte" @click="run('decreaseFontSize')">−</button>
            <input class="tool-size" :value="fontSizeText" aria-label="Tamanho da fonte em pontos" inputmode="decimal" @change="setFontSize" @keydown.enter.prevent="setFontSize" />
            <button type="button" class="tool" aria-label="Aumentar fonte" title="Aumentar fonte" @click="run('increaseFontSize')">+</button>
          </div>
          <div class="more__row">
            <span class="more__label">Alinhar</span>
            <button type="button" class="tool" :class="{ on: formatting.alignment === 'left' }" :title="`À esquerda (${shortcut('⇧⌘L')})`" aria-label="Alinhar à esquerda" @click="run('setTextAlign', 'left')"><AlignLeft :size="15" /></button>
            <button type="button" class="tool" :class="{ on: formatting.alignment === 'center' }" :title="`Centralizar (${shortcut('⇧⌘E')})`" aria-label="Centralizar" @click="run('setTextAlign', 'center')"><AlignCenter :size="15" /></button>
            <button type="button" class="tool" :class="{ on: formatting.alignment === 'right' }" :title="`À direita (${shortcut('⇧⌘R')})`" aria-label="Alinhar à direita" @click="run('setTextAlign', 'right')"><AlignRight :size="15" /></button>
            <button type="button" class="tool" :class="{ on: formatting.alignment === 'justify' }" :title="`Justificar (${shortcut('⇧⌘J')})`" aria-label="Justificar" @click="run('setTextAlign', 'justify')"><AlignJustify :size="15" /></button>
            <span class="more__gap" />
            <button type="button" class="tool" :title="`Diminuir recuo (${shortcut('⌘[')})`" aria-label="Diminuir recuo" @click="run('outdent')"><IndentDecrease :size="15" /></button>
            <button type="button" class="tool" :title="`Aumentar recuo (${shortcut('⌘]')})`" aria-label="Aumentar recuo" @click="run('indent')"><IndentIncrease :size="15" /></button>
          </div>
          <div class="more__row">
            <span class="more__label">Entrelinha</span>
            <div class="more__choices" role="radiogroup" aria-label="Espaçamento entre linhas">
              <button v-for="value in SPACINGS" :key="value" type="button" role="radio" class="chip" :class="{ 'chip--active': formatting.lineHeight === value }" :aria-checked="formatting.lineHeight === value" @click="pick('spacing', value)">
                {{ value === 1 ? 'Simples' : value === 2 ? 'Duplo' : String(value).replace('.', ',') }}
              </button>
            </div>
          </div>
          <div class="more__row">
            <span class="more__label"><Palette :size="13" aria-hidden="true" /> Cor</span>
            <div class="more__swatches" role="group" aria-label="Cor do texto">
              <button v-for="color in COLORS" :key="color" type="button" class="swatch" :style="{ background: color }" :aria-label="`Cor ${color}`" @click="pick('color', color)" />
              <button type="button" class="swatch-reset" @click="pick('color', null)">Automática</button>
            </div>
          </div>
          <div class="more__row">
            <span class="more__label"><Highlighter :size="13" aria-hidden="true" /> Realce</span>
            <div class="more__swatches" role="group" aria-label="Cor de realce">
              <button v-for="color in HIGHLIGHTS" :key="color" type="button" class="swatch" :style="{ background: color }" :aria-label="`Realce ${color}`" @click="pick('highlight', color)" />
              <button type="button" class="swatch-reset" @click="pick('highlight', null)">Nenhum</button>
            </div>
          </div>
          <div class="more__row more__row--tools">
            <button type="button" class="tool tool--labeled" :class="{ on: formatting.strike }" :title="`Tachado (${shortcut('⇧⌘X')})`" @click="run('toggleStrike')"><Strikethrough :size="15" /> Tachado</button>
            <button type="button" class="tool tool--labeled" :class="{ on: formatting.list === 'check' }" :title="`Lista de verificação (${shortcut('⇧⌘9')})`" @click="run('toggleTaskList')"><ListChecks :size="15" /> Verificação</button>
            <button type="button" class="tool tool--labeled" :class="{ on: formatting.hasCopiedFormatting }" :title="`Copiar formatação (${shortcut('⌥⌘C')}) · colar (${shortcut('⌥⌘V')})`" @click="formatting.hasCopiedFormatting ? run('pasteFormatting') : run('copyFormatting')"><PaintRoller :size="15" /> {{ formatting.hasCopiedFormatting ? 'Colar formato' : 'Copiar formato' }}</button>
            <button type="button" class="tool tool--labeled" :title="`Limpar formatação (${shortcut('⌘\\\\')})`" @click="run('clearFormatting')"><Eraser :size="15" /> Limpar</button>
          </div>
          <div class="more__row">
            <label class="more__label" for="editor-zoom">Tamanho na tela</label>
            <select id="editor-zoom" class="field field--compact" :value="zoom" title="Só muda o tamanho na tela; a folha do púlpito não muda" @change="emit('zoom', Number(($event.target as HTMLSelectElement).value))">
              <option v-for="value in ZOOMS" :key="value" :value="value">{{ Math.round(value * 100) }}%</option>
              <option v-if="!ZOOMS.includes(zoom)" :value="zoom">{{ Math.round(zoom * 100) }}%</option>
            </select>
            <span class="more__hint">{{ shortcut('⌘+') }} · {{ shortcut('⌘−') }}</span>
          </div>
        </div>
      </template>
    </PopMenu>
    <span class="spacer" />
    <button type="button" class="tool" :title="`Localizar e substituir (${shortcut('⌘F')})`" aria-label="Localizar e substituir" @click="emit('find')"><Search :size="15" /></button>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 1px;
  min-height: 42px;
  padding: 4px 10px;
  background: var(--paper);
  border-bottom: 1px solid var(--line);
  color: var(--ink);
  overflow: visible;
  flex-wrap: wrap;
}
.tool {
  min-width: 30px;
  height: 30px;
  padding: 0 5px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--ink-soft);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font-size: var(--text-sm);
  font-weight: 500;
  white-space: nowrap;
}
.tool--labeled {
  padding: 0 8px;
}
.tool--split {
  padding-right: 3px;
}
.tool__caret {
  color: var(--muted);
}
.tool:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ink) 7%, transparent);
  color: var(--ink);
}
.tool:disabled {
  opacity: 0.35;
}
.tool.on {
  color: var(--accent-ink);
  background: var(--accent-soft);
}
.tool-select {
  height: 30px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--ink);
  font-size: var(--text-sm);
  padding: 0 4px;
}
.tool-select:hover {
  background: color-mix(in srgb, var(--ink) 7%, transparent);
}
.tool-select--style {
  width: 118px;
}
.toolbar--compact .tool-select--style {
  width: 100px;
}
.tool-size {
  width: 44px;
  height: 26px;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  text-align: center;
  font-size: var(--text-sm);
  background: var(--surface);
  color: var(--ink);
}
.sep {
  width: 1px;
  height: 18px;
  margin: 0 5px;
  background: var(--line);
}
.menu__hint {
  display: block;
  width: 100%;
  font-size: var(--text-xs);
  color: var(--muted);
}
.menu__item {
  flex-wrap: wrap;
  padding: 7px 10px;
}
.more {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 6px;
}
.more__row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 30px;
}
.more__row--tools {
  flex-wrap: wrap;
  gap: 2px;
  padding-top: 4px;
  border-top: 1px solid var(--line);
}
.more__label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: 92px;
  flex: none;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--muted);
}
.more__grow {
  flex: 1;
  min-width: 0;
}
.more__gap {
  width: 10px;
}
.more__choices {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.more__swatches {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.more__hint {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--muted);
}
.field--compact {
  height: 26px;
  font-size: var(--text-sm);
}
.swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--line-strong);
}
.swatch-reset {
  border: none;
  background: none;
  font-size: var(--text-xs);
  color: var(--muted);
  padding: 0 4px;
}
</style>
