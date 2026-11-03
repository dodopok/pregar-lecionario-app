<script setup lang="ts">
/**
 * Pesquisar comandos (⌥/): lista filtrável dos comandos da Mesa. Enter ou clique executa o
 * comando; ↑/↓ escolhem; Esc fecha.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { Search } from 'lucide-vue-next'
import Sheet from '@/components/Sheet.vue'
import { invoke, isMac } from '@/lib/api'
import { activeEditor } from '@/lib/editorBridge'
import { useAppStore } from '@/stores/app'
import { useMesaStore } from '@/stores/mesa'
import { useToasts } from '@/stores/toasts'
import { printPulpitSheet } from '../pulpit'
import { MESA_COMMANDS, filterCommands, platformKeys } from './commands'
import type { MesaCommand, MesaCommandId } from './commands'

const emit = defineEmits<{ close: [] }>()
const app = useAppStore()
const mesa = useMesaStore()
const toasts = useToasts()
const mac = isMac()

const query = ref('')
const active = ref(0)
const list = ref<HTMLElement | null>(null)
const results = computed(() => filterCommands(MESA_COMMANDS, query.value))

watch(query, () => (active.value = 0))

const EDITOR_COMMANDS: Partial<Record<MesaCommandId, string>> = {
  bold: 'toggleBold',
  italic: 'toggleItalic',
  underline: 'toggleUnderline',
  strike: 'toggleStrike',
  quote: 'toggleQuote',
  annotation: 'toggleAnnotation',
  bulletList: 'toggleBulletList',
  orderedList: 'toggleOrderedList',
  undo: 'undo',
  redo: 'redo',
  clearFormatting: 'clearFormatting',
}

function runEditorCommand(name: string): void {
  const editor = activeEditor.value
  if (!editor) {
    toasts.show('Abra o manuscrito para usar este comando.', 'info')
    return
  }
  const chain = editor.chain().focus() as unknown as Record<string, unknown> & { run(): boolean }
  const command = chain[name]
  if (typeof command === 'function') (command as () => { run(): boolean }).call(chain).run()
}

function togglePanel(panel: 'calendarOpen' | 'readingsOpen' | 'materialsOpen'): void {
  void app.updateSettings({ panels: { [panel]: !app.settings.panels[panel] } })
}

function showTab(tab: 'materials' | 'ideas' | 'review'): void {
  mesa.contextTab = tab
  if (!app.settings.panels.materialsOpen) void app.updateSettings({ panels: { materialsOpen: true } })
}

function run(command: MesaCommand): void {
  const editorCommand = EDITOR_COMMANDS[command.id]
  if (editorCommand) {
    emit('close')
    // Depois que a folha devolve o foco ao manuscrito.
    setTimeout(() => runEditorCommand(editorCommand), 0)
    return
  }
  switch (command.id) {
    case 'review':
      return mesa.requestReview()
    case 'structure':
      return mesa.requestReview(['structure'])
    case 'questions':
    case 'pulpit':
    case 'history':
    case 'drive':
    case 'shortcuts':
    case 'connect':
    case 'setup':
      return mesa.openSheet(command.id)
    case 'rehearsal':
      return mesa.openFullscreen('rehearsal')
    case 'readingsFullscreen':
      return mesa.openFullscreen('readings')
    case 'poem':
      emit('close')
      setTimeout(() => {
        const editor = activeEditor.value
        if (!editor) return toasts.show('Abra o manuscrito para usar este comando.', 'info')
        const chain = editor.chain().focus() as unknown as Record<
          string,
          (...args: unknown[]) => { run(): boolean }
        > & { run(): boolean }
        if (!editor.isActive('blockquote')) chain.toggleQuote?.().run()
        ;(editor.chain().focus() as unknown as Record<string, (...args: unknown[]) => { run(): boolean }>)
          .setBlockquoteKind?.('poem')
          .run()
      }, 0)
      return
  }
  emit('close')
  switch (command.id) {
    case 'save':
      void mesa.flush()
      break
    case 'print':
      void printPulpitSheet(mesa, app).then(
        (result) => result.message && toasts.show(result.message, 'error'),
      )
      break
    case 'captureIdea':
      mesa.requestIdeaCapture()
      break
    case 'tour':
      mesa.tourOpen = true
      break
    case 'focusMode':
      mesa.focusMode = !mesa.focusMode
      break
    case 'toggleCalendar':
      togglePanel('calendarOpen')
      break
    case 'toggleReadings':
      togglePanel('readingsOpen')
      break
    case 'toggleMaterials':
      togglePanel('materialsOpen')
      break
    case 'tabMaterials':
      showTab('materials')
      break
    case 'tabIdeas':
      showTab('ideas')
      break
    case 'tabReview':
      showTab('review')
      break
    case 'openBible':
      void invoke('app:openWindow', { window: 'biblia' })
      break
    case 'openReader':
      void invoke('app:openWindow', { window: 'leitor' })
      break
    case 'openLibrary':
      void invoke('app:openWindow', { window: 'biblioteca' })
      break
    case 'openArchive':
      void invoke('app:openWindow', { window: 'arquivo' })
      break
    case 'openPreferences':
      void invoke('app:openWindow', { window: 'preferencias' })
      break
    default:
      break
  }
}

function move(delta: number): void {
  if (results.value.length === 0) return
  active.value = (active.value + delta + results.value.length) % results.value.length
  void nextTick(() =>
    list.value
      ?.querySelector<HTMLElement>(`[data-index="${active.value}"]`)
      ?.scrollIntoView({ block: 'nearest' }),
  )
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    move(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    move(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const command = results.value[active.value]
    if (command) run(command)
  }
}
</script>

<template>
  <Sheet :width="560" label="Pesquisar comandos" @close="emit('close')">
    <div class="commands">
      <div class="commands__search">
        <Search :size="15" class="commands__icon" aria-hidden="true" />
        <input
          v-model="query"
          class="commands__input"
          type="text"
          autofocus
          placeholder="Pesquisar comandos"
          aria-label="Pesquisar comandos"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="mesa-command-list"
          :aria-activedescendant="results[active] ? `mesa-command-${results[active]!.id}` : undefined"
          @keydown="onKeydown"
        />
      </div>
      <ul
        id="mesa-command-list"
        ref="list"
        class="scroll commands__list"
        role="listbox"
        aria-label="Comandos"
      >
        <li
          v-for="(command, index) in results"
          :id="`mesa-command-${command.id}`"
          :key="command.id"
          :data-index="index"
          role="option"
          class="command"
          :class="{ 'command--active': index === active }"
          :aria-selected="index === active"
          @mousemove="active = index"
          @click="run(command)"
        >
          <span class="command__title">{{ command.title }}</span>
          <span class="command__group">{{ command.group }}</span>
          <kbd v-if="command.shortcut" class="command__keys">{{ platformKeys(command.shortcut, mac) }}</kbd>
        </li>
        <li v-if="results.length === 0" class="commands__empty" role="presentation">
          Nenhum comando com esse nome.
        </li>
      </ul>
    </div>
  </Sheet>
</template>

<style scoped>
.commands {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  margin: -8px;
}
.commands__search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  height: 38px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-button);
  background: var(--surface);
}
.commands__search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.commands__icon {
  flex: none;
  color: var(--muted);
}
.commands__input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  background: none;
  font-size: 14px;
}
.commands__list {
  max-height: min(420px, calc(100vh - 220px));
  margin: 0;
  padding: 0;
  list-style: none;
}
.command {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 34px;
  padding: 0 10px;
  border-radius: var(--radius-control);
}
.command--active {
  background: var(--accent-soft);
}
.command__title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.command__group {
  font-size: 11px;
  color: var(--muted);
}
.command__keys {
  min-width: 64px;
  text-align: right;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted);
}
.commands__empty {
  padding: 14px 10px;
  font-size: 12px;
  color: var(--muted);
}
</style>
