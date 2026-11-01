<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import type { Editor } from '@tiptap/core'
import { X } from 'lucide-vue-next'
import {
  MANUSCRIPT_EDITOR_CSS,
  MANUSCRIPT_EDITOR_PROPS,
  createManuscriptExtensions,
  footnotesOf,
  linkEditingState,
  manuscriptPlainText,
  parseManuscriptJSON,
  selectionFormatting,
} from '@pregar/editor'
import type { FootnoteEntry, ManuscriptShortcutAction, SelectionFormatting } from '@pregar/editor'
import PButton from '@/components/PButton.vue'
import { on, shortcut } from '@/lib/api'
import { activeEditor } from '@/lib/editorBridge'
import { useAppStore } from '@/stores/app'
import { useMesaStore } from '@/stores/mesa'
import EditorToolbar from './EditorToolbar.vue'
import FindBar from './FindBar.vue'

const mesa = useMesaStore()
const app = useAppStore()
const formatting = shallowRef<SelectionFormatting | null>(null)
const footnotes = shallowRef<FootnoteEntry[]>([])
const findOpen = ref<null | 'find' | 'replace'>(null)
const findTick = ref(0)
const linkOpen = ref(false)
const linkHref = ref('')
const linkText = ref('')
const surface = ref<HTMLElement | null>(null)
const surfaceWidth = ref(900)
const zoom = computed(() => app.settings.editor.zoom)
let frame = 0
let wordsTimer: ReturnType<typeof setTimeout> | null = null
let loadingContent = false

// O CSS do manuscrito vem do pacote do editor (mesmas medidas das exportações).
if (!document.getElementById('manuscript-editor-css')) {
  const style = document.createElement('style')
  style.id = 'manuscript-editor-css'
  style.textContent = MANUSCRIPT_EDITOR_CSS
  document.head.appendChild(style)
}

function onShortcut(action: ManuscriptShortcutAction, detail?: { footnoteId?: string }): boolean {
  switch (action) {
    case 'find':
      findOpen.value = 'find'
      return true
    case 'replace':
      findOpen.value = 'replace'
      return true
    case 'link':
      openLink()
      return true
    case 'save':
      void mesa.flush()
      return true
    case 'print':
      mesa.openSheet('tablet')
      return true
    case 'commandSearch':
      mesa.openSheet('commands')
      return true
    case 'shortcuts':
      mesa.openSheet('shortcuts')
      return true
    case 'zoomIn':
      setZoom(zoom.value + 0.1)
      return true
    case 'zoomOut':
      setZoom(zoom.value - 0.1)
      return true
    case 'zoomReset':
      setZoom(1)
      return true
    case 'footnoteInserted':
      requestAnimationFrame(() => focusFootnote(detail?.footnoteId))
      return true
    default:
      return false
  }
}

const editor = useEditor({
  extensions: createManuscriptExtensions({
    placeholder: 'Comece a escrever. Use # para título, > para citação e - para lista; ⌘B e ⌘I para negrito e itálico.',
    onShortcut,
  }),
  editorProps: MANUSCRIPT_EDITOR_PROPS as never,
  onCreate: ({ editor: created }) => {
    activeEditor.value = created as Editor
    loadContent()
    refreshState()
  },
  onUpdate: ({ editor: updated }) => {
    if (loadingContent) return
    const current = updated as Editor
    mesa.contentChanged(() => {
      const json = current.getJSON()
      return { doc: JSON.stringify(json), plainText: manuscriptPlainText(json as never) }
    })
    scheduleWordCount(current)
  },
  onTransaction: () => scheduleState(),
})

function scheduleWordCount(current: Editor): void {
  if (wordsTimer) return
  wordsTimer = setTimeout(() => {
    wordsTimer = null
    const words = (current.storage as { characterCount?: { words(): number } }).characterCount?.words()
    if (typeof words === 'number') mesa.wordCount = words
  }, 400)
}

function scheduleState(): void {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    refreshState()
  })
}

function refreshState(): void {
  const current = editor.value
  if (!current) return
  formatting.value = selectionFormatting(current as Editor)
  footnotes.value = footnotesOf(current.state.doc as never)
  findTick.value += 1
}

/** Troca o documento do editor quando muda a preparação ou uma restauração substitui o texto. */
function loadContent(): void {
  const current = editor.value
  if (!current) return
  loadingContent = true
  try {
    let content: object = { type: 'doc', content: [{ type: 'paragraph' }] }
    if (mesa.record?.doc) {
      try {
        const json = JSON.parse(mesa.record.doc)
        parseManuscriptJSON(json)
        content = json
      } catch {
        // Documento ilegível: preserva ao menos o texto corrido salvo.
        content = {
          type: 'doc',
          content: (mesa.record.plainText || '').split('\n').map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })),
        }
      }
    }
    current.commands.setContent(content as never, { emitUpdate: false })
    current.commands.setTextSelection(1)
    if (surface.value) surface.value.scrollTop = 0
  } finally {
    loadingContent = false
  }
  mesa.wordCount = mesa.record?.wordCount ?? 0
  refreshState()
}

watch(() => mesa.documentRevision, loadContent)

function setZoom(value: number): void {
  const next = Math.min(2, Math.max(0.5, Math.round(value * 100) / 100))
  void app.updateSettings({ editor: { zoom: next } })
}

function openLink(): void {
  const current = editor.value
  if (!current) return
  const state = linkEditingState(current.state as never) as { href?: string | null; text?: string }
  linkHref.value = state.href ?? ''
  linkText.value = state.text ?? ''
  linkOpen.value = true
}

function applyLink(): void {
  const current = editor.value
  if (!current) return
  const href = linkHref.value.trim()
  ;(current.chain().focus() as unknown as { applyLink(input: { href: string | null; text?: string }): { run(): boolean } })
    .applyLink({ href: href ? (/^[a-z]+:/i.test(href) ? href : `https://${href}`) : null, text: linkText.value || undefined })
    .run()
  linkOpen.value = false
}

function focusFootnote(id?: string): void {
  const target = id ? document.querySelector<HTMLTextAreaElement>(`[data-footnote-input="${id}"]`) : null
  target?.focus()
}

function updateNote(entry: FootnoteEntry, note: string): void {
  if (!entry.id) return
  ;(editor.value?.commands as unknown as { updateFootnote(id: string, note: string): boolean }).updateFootnote(entry.id, note)
}

function removeNote(entry: FootnoteEntry): void {
  if (!entry.id) return
  ;(editor.value?.commands as unknown as { removeFootnote(id: string): boolean }).removeFootnote(entry.id)
}

function dismissTip(): void {
  void app.updateSettings({ onboarding: { mesaTipDismissed: true } })
}

let resizeObserver: ResizeObserver | null = null
const unsubscribe: (() => void)[] = []
onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    if (entry) surfaceWidth.value = entry.contentRect.width
  })
  if (surface.value) resizeObserver.observe(surface.value)
  unsubscribe.push(
    on('menu:command', ({ command }) => {
      const current = editor.value
      if (!current) return
      const map: Record<string, () => void> = {
        undo: () => current.chain().focus().undo().run(),
        redo: () => current.chain().focus().redo().run(),
        find: () => (findOpen.value = 'find'),
        replace: () => (findOpen.value = 'replace'),
        save: () => void mesa.flush(),
        zoomIn: () => setZoom(zoom.value + 0.1),
        zoomOut: () => setZoom(zoom.value - 0.1),
        zoomReset: () => setZoom(1),
        pastePlain: () => {
          void navigator.clipboard.readText().then((text) => current.chain().focus().insertContent(text).run())
        },
      }
      map[command]?.()
    }),
  )
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  for (const off of unsubscribe) off()
  void mesa.flush()
  if (activeEditor.value === editor.value) activeEditor.value = null
  editor.value?.destroy()
})

const PAGE_WIDTH = 794
const PAGE_MARGIN = 96
// O zoom muda o tamanho do texto; a página estreita para caber na área visível (e as margens
// diminuem), em vez de encolher o texto. O texto sempre quebra dentro da largura disponível.
const pageScale = computed(() => zoom.value)
const pageWidth = computed(() => Math.min(PAGE_WIDTH, Math.max(320, (surfaceWidth.value - 48) / pageScale.value)))
const pageMargin = computed(() => Math.round(Math.max(28, Math.min(PAGE_MARGIN, (pageWidth.value - 420) / 2))))
const showTip = computed(() => mesa.wordCount === 0 && !app.settings.onboarding.mesaTipDismissed)
const rulerTicks = computed(() => Array.from({ length: 22 }, (_, index) => index))
</script>

<template>
  <section class="manuscript" aria-label="Manuscrito">
    <EditorToolbar
      v-if="editor && formatting"
      :editor="editor as Editor"
      :formatting="formatting"
      :zoom="zoom"
      :compact="surfaceWidth < 760"
      @find="findOpen = 'find'"
      @link="openLink"
      @zoom="setZoom"
    />
    <div ref="surface" class="manuscript__surface scroll" @mousedown.self="editor?.commands.focus('end')">
      <FindBar v-if="findOpen && editor" :editor="editor as Editor" :replace-mode="findOpen === 'replace'" :tick="findTick" @close="findOpen = null" />
      <div v-if="linkOpen" class="link-popover" role="dialog" aria-label="Editar link">
        <input v-model="linkText" class="field" placeholder="Texto" aria-label="Texto do link" />
        <input v-model="linkHref" class="field" placeholder="https://" aria-label="Endereço do link" autofocus @keydown.enter.prevent="applyLink" @keydown.esc="linkOpen = false" />
        <PButton variant="primary" compact @click="applyLink">Aplicar</PButton>
        <PButton variant="ghost" compact @click="linkOpen = false">Cancelar</PButton>
      </div>
      <div class="page-wrap" :style="{ width: `${pageWidth * pageScale}px` }">
        <div v-if="app.settings.editor.showRuler" class="ruler" aria-hidden="true">
          <span v-for="tick in rulerTicks" :key="tick" class="ruler__tick" :style="{ left: `${(tick / 21) * 100}%` }">{{ tick > 0 && tick < 21 ? tick : '' }}</span>
        </div>
        <div class="page" :style="{ zoom: pageScale, width: `${pageWidth}px`, paddingLeft: `${pageMargin}px`, paddingRight: `${pageMargin}px` }">
          <aside v-if="showTip" class="tip" aria-label="Como funciona a Mesa">
            <button type="button" class="tip__close" aria-label="Dispensar dica" @click="dismissTip"><X :size="13" /></button>
            <strong class="serif">Como funciona a Mesa</strong>
            <ol>
              <li>Escolha o domingo no calendário.</li>
              <li>Marque o texto principal nas leituras.</li>
              <li>Escreva aqui; quando quiser, peça uma revisão ({{ shortcut('⇧⌥⌘R') }}).</li>
            </ol>
          </aside>
          <EditorContent v-if="editor" :editor="editor" />
          <section v-if="footnotes.length > 0" class="notes" aria-label="Notas de rodapé">
            <hr />
            <div v-for="entry in footnotes" :key="entry.id ?? entry.number" class="note">
              <span class="note__number">{{ entry.number }}</span>
              <textarea
                class="note__input"
                :data-footnote-input="entry.id"
                :value="entry.note"
                rows="1"
                placeholder="Texto da nota"
                :aria-label="`Nota ${entry.number}`"
                @change="updateNote(entry, ($event.target as HTMLTextAreaElement).value)"
              />
              <button type="button" class="note__remove" :aria-label="`Remover nota ${entry.number}`" @click="removeNote(entry)"><X :size="12" /></button>
            </div>
          </section>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.manuscript {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--doc-canvas);
  --manuscript-ink: var(--doc-ink);
  --manuscript-link: var(--doc-blue);
}
@media (prefers-color-scheme: dark) {
  .manuscript {
    --manuscript-quote-paper: rgb(255 255 255 / 0.05);
    --manuscript-quote-ink: var(--doc-ink);
  }
}
.manuscript__surface {
  position: relative;
  flex: 1;
  padding: 16px 24px 80px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}
.page-wrap {
  flex: none;
}
.ruler {
  position: relative;
  height: 18px;
  margin-bottom: 6px;
  border-bottom: 1px solid var(--doc-border);
  font-size: 9px;
  color: var(--doc-muted);
}
.ruler__tick {
  position: absolute;
  bottom: 2px;
  transform: translateX(-50%);
}
.ruler__tick::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -3px;
  width: 1px;
  height: 4px;
  background: var(--doc-border);
}
.page {
  min-height: 1123px;
  padding: 72px 96px 120px;
  background: var(--doc-paper);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.12), 0 0 0 1px var(--doc-border);
  cursor: text;
}
.page :deep(.manuscript-editor) {
  min-height: 600px;
}
.tip {
  position: relative;
  margin: -40px 0 24px;
  padding: 12px 14px;
  border-radius: var(--radius-card);
  background: var(--accent-softer);
  border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
  font-family: var(--font-ui);
  font-size: 13px;
  color: var(--ink);
  cursor: default;
}
.tip ol {
  margin: 6px 0 0;
  padding-left: 18px;
}
.tip__close {
  position: absolute;
  top: 6px;
  right: 6px;
  border: none;
  background: none;
  color: var(--muted);
}
.notes {
  margin-top: 32px;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 10pt;
  color: var(--doc-ink);
}
.notes hr {
  width: 33%;
  margin: 0 0 8px;
  border: none;
  border-top: 1px solid var(--doc-border);
}
.note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 4px;
}
.note__number {
  font-size: 0.8em;
  vertical-align: super;
  min-width: 14px;
  color: var(--doc-blue);
}
.note__input {
  flex: 1;
  border: none;
  resize: vertical;
  background: transparent;
  font: inherit;
  color: inherit;
  outline: none;
  field-sizing: content;
}
.note__input:focus {
  background: color-mix(in srgb, var(--doc-blue) 6%, transparent);
}
.note__remove {
  border: none;
  background: none;
  color: var(--doc-muted);
  opacity: 0;
}
.note:hover .note__remove,
.note__remove:focus-visible {
  opacity: 1;
}
.link-popover {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 21;
  display: flex;
  gap: 6px;
  padding: 8px;
  border-radius: 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-pop);
}
</style>
