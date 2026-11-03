<script setup lang="ts">
/**
 * Importar sermões antigos: cada arquivo convertido vira uma linha com data, título e passagem
 * editáveis; só o que estiver marcado e com data válida é gravado. Nada sai do computador.
 */
import { computed, reactive, ref } from 'vue'
import { CircleAlert, CircleCheck, FileUp, TriangleAlert } from 'lucide-vue-next'
import { parseBrazilianDate, parseDateKey, shortDatePt } from '@pregar/core/util/dates'
import type { ImportCandidate, ImportResult } from '@shared/ipc-import'
import PButton from '@/components/PButton.vue'
import Sheet from '@/components/Sheet.vue'
import SheetHeader from '@/components/SheetHeader.vue'
import Spinner from '@/components/Spinner.vue'
import { errorMessage, invoke } from '@/lib/api'

interface Row {
  candidate: ImportCandidate
  included: boolean
  /** Data digitada (dd/mm/aaaa). */
  dateText: string
  title: string
  reference: string
}

const props = defineProps<{ candidates: ImportCandidate[] }>()
const emit = defineEmits<{ close: [imported: number] }>()

const rows = reactive<Row[]>(
  props.candidates.map((candidate) => ({
    candidate,
    included: candidate.error === null,
    dateText: candidate.detected.dateKey ? formatKey(candidate.detected.dateKey) : '',
    title: candidate.detected.title,
    reference: candidate.detected.reference ?? '',
  })),
)
const busy = ref(false)
const failure = ref<string | null>(null)
const results = ref<ImportResult[] | null>(null)

function formatKey(key: string): string {
  const date = parseDateKey(key)
  return date ? shortDatePt(date) : key
}

function dateKeyOf(row: Row): string | null {
  return parseBrazilianDate(row.dateText)
}

const included = computed(() => rows.filter((row) => row.included))
const missingDate = computed(() => included.value.filter((row) => !dateKeyOf(row)).length)
const missingTitle = computed(() => included.value.filter((row) => !row.title.trim()).length)
const canImport = computed(
  () => included.value.length > 0 && missingDate.value === 0 && missingTitle.value === 0 && !busy.value,
)
const summary = computed(() => {
  const total = rows.length
  const withDate = rows.filter((row) => dateKeyOf(row)).length
  const toCheck = rows.filter((row) => row.included && (!dateKeyOf(row) || !row.title.trim())).length
  const broken = rows.filter((row) => row.candidate.error).length
  const parts = [`${total} ${total === 1 ? 'arquivo' : 'arquivos'}`, `${withDate} com data`]
  if (toCheck > 0) parts.push(`${toCheck} para conferir`)
  if (broken > 0) parts.push(`${broken} ${broken === 1 ? 'não convertido' : 'não convertidos'}`)
  return parts.join(' · ')
})
const importLabel = computed(() => {
  const count = included.value.length
  return count === 1 ? 'Importar 1 preparação' : `Importar ${count} preparações`
})
const resultSummary = computed(() => {
  if (!results.value) return ''
  const imported = results.value.filter((item) => item.status === 'imported').length
  const skipped = results.value.filter((item) => item.status === 'skipped').length
  const failed = results.value.filter((item) => item.status === 'failed').length
  const parts = [`${imported} ${imported === 1 ? 'importada' : 'importadas'}`]
  if (skipped > 0) parts.push(`${skipped} ${skipped === 1 ? 'pulada' : 'puladas'}`)
  if (failed > 0) parts.push(`${failed} com erro`)
  return parts.join(' · ')
})

function rowResult(row: Row): ImportResult | undefined {
  return results.value?.find((item) => item.id === row.candidate.id)
}

function dateState(row: Row): 'ok' | 'missing' | 'detected' {
  if (!dateKeyOf(row)) return 'missing'
  return row.candidate.detected.confidence.date === 'none' ? 'ok' : 'detected'
}

function sourceLabel(row: Row): string {
  const date = row.candidate.detected.confidence.date
  const reference = row.candidate.detected.confidence.reference
  const parts: string[] = []
  if (date === 'filename') parts.push('data lida do nome do arquivo')
  else if (date === 'text') parts.push('data lida do texto')
  if (reference === 'filename') parts.push('passagem lida do nome')
  else if (reference === 'text') parts.push('passagem lida do texto')
  return parts.join(' · ')
}

async function confirm(): Promise<void> {
  if (!canImport.value) return
  busy.value = true
  failure.value = null
  try {
    results.value = await invoke('import:confirm', {
      items: included.value.map((row) => ({
        id: row.candidate.id,
        dateKey: dateKeyOf(row)!,
        title: row.title.trim(),
        mainReadingReference: row.reference.trim() || null,
      })),
    })
  } catch (error) {
    failure.value = errorMessage(error)
  } finally {
    busy.value = false
  }
}

function cancel(): void {
  void invoke('import:cancel').catch(() => undefined)
  emit('close', 0)
}

function finish(): void {
  emit('close', results.value?.filter((item) => item.status === 'imported').length ?? 0)
}
</script>

<template>
  <Sheet
    :width="900"
    label="Importar sermões antigos"
    :dismissible="!busy"
    @close="results ? finish() : cancel()"
  >
    <div class="import">
      <SheetHeader
        title="Importar sermões antigos"
        :subtitle="`${summary}. Confira a data, o título e a passagem antes de guardar; nada sai do seu computador.`"
        :icon="FileUp"
      />

      <div class="table" role="table" aria-label="Arquivos para importar">
        <div class="table__head" role="row">
          <span role="columnheader" class="col-check"><span class="visually-hidden">Incluir</span></span>
          <span role="columnheader">Arquivo</span>
          <span role="columnheader">Data</span>
          <span role="columnheader">Título</span>
          <span role="columnheader">Passagem</span>
          <span role="columnheader" class="col-words">Palavras</span>
        </div>
        <div class="scroll table__body">
          <div
            v-for="row in rows"
            :key="row.candidate.id"
            class="table__row"
            :class="{ 'table__row--off': !row.included, 'table__row--broken': row.candidate.error }"
            role="row"
          >
            <span class="col-check" role="cell">
              <input
                v-model="row.included"
                type="checkbox"
                :disabled="Boolean(row.candidate.error) || Boolean(results)"
                :aria-label="`Incluir ${row.candidate.fileName}`"
              />
            </span>
            <span class="file" role="cell">
              <span class="file__name truncate" :title="row.candidate.path">{{
                row.candidate.fileName
              }}</span>
              <span v-if="row.candidate.error" class="file__warning"
                ><CircleAlert :size="11" aria-hidden="true" /> {{ row.candidate.error }}</span
              >
              <span
                v-else-if="rowResult(row)"
                class="file__result"
                :class="`file__result--${rowResult(row)!.status}`"
              >
                <CircleCheck v-if="rowResult(row)!.status === 'imported'" :size="11" aria-hidden="true" />
                <TriangleAlert v-else :size="11" aria-hidden="true" />
                {{ rowResult(row)!.status === 'imported' ? 'Importada' : rowResult(row)!.message }}
              </span>
              <span v-else-if="sourceLabel(row)" class="file__source">{{ sourceLabel(row) }}</span>
              <span v-for="warning in row.candidate.warnings" :key="warning" class="file__warning"
                ><TriangleAlert :size="11" aria-hidden="true" /> {{ warning }}</span
              >
            </span>
            <span role="cell">
              <input
                v-model="row.dateText"
                class="field cell-field cell-field--date"
                :class="{ 'cell-field--missing': row.included && dateState(row) === 'missing' }"
                placeholder="dd/mm/aaaa"
                inputmode="numeric"
                :disabled="Boolean(row.candidate.error) || Boolean(results)"
                :aria-label="`Data de ${row.candidate.fileName}`"
                :aria-invalid="row.included && dateState(row) === 'missing'"
              />
              <span v-if="row.included && dateState(row) === 'missing'" class="cell-hint"
                >confirmar data</span
              >
            </span>
            <span role="cell">
              <input
                v-model="row.title"
                class="field cell-field"
                :class="{ 'cell-field--missing': row.included && !row.title.trim() }"
                :disabled="Boolean(row.candidate.error) || Boolean(results)"
                :aria-label="`Título de ${row.candidate.fileName}`"
              />
            </span>
            <span role="cell">
              <input
                v-model="row.reference"
                class="field cell-field"
                placeholder="Mateus 25:1-13"
                :disabled="Boolean(row.candidate.error) || Boolean(results)"
                :aria-label="`Passagem de ${row.candidate.fileName}`"
              />
            </span>
            <span class="col-words words" role="cell">{{
              row.candidate.wordCount.toLocaleString('pt-BR')
            }}</span>
          </div>
        </div>
      </div>

      <p v-if="failure" class="failure" role="alert">{{ failure }}</p>
      <p v-else-if="!results && missingDate > 0" class="hint" role="status">
        {{
          missingDate === 1
            ? '1 arquivo marcado ainda precisa de data'
            : `${missingDate} arquivos marcados ainda precisam de data`
        }}. Digite no formato dd/mm/aaaa ou desmarque.
      </p>
      <p v-else-if="results" class="hint hint--done" role="status">
        {{ resultSummary }}. As importadas já aparecem no Arquivo e voltam em “Já preguei sobre isto”.
      </p>

      <footer class="import__footer">
        <span class="spacer" />
        <template v-if="!results">
          <PButton :disabled="busy" @click="cancel">Cancelar</PButton>
          <PButton variant="primary" :busy="busy" :disabled="!canImport" @click="confirm">
            <Spinner v-if="busy" :size="12" />{{ importLabel }}
          </PButton>
        </template>
        <PButton v-else variant="primary" @click="finish">Concluir</PButton>
      </footer>
    </div>
  </Sheet>
</template>

<style scoped>
.import {
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: var(--text-sm);
}
.table {
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  overflow: hidden;
  background: var(--surface);
}
.table__head,
.table__row {
  display: grid;
  grid-template-columns: 28px minmax(140px, 1.2fr) 118px minmax(140px, 1.4fr) minmax(120px, 1fr) 64px;
  column-gap: 8px;
  align-items: start;
  padding: 8px 10px;
}
.table__head {
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
  background: var(--paper);
}
.table__body {
  max-height: min(440px, calc(100vh - 320px));
}
.table__row {
  border-bottom: 1px solid var(--line);
}
.table__row:last-child {
  border-bottom: none;
}
.table__row--off {
  opacity: 0.6;
}
.table__row--broken {
  background: var(--warning-soft);
}
.col-check {
  display: flex;
  justify-content: center;
  padding-top: 6px;
}
.col-check input {
  margin: 0;
  accent-color: var(--accent);
}
.file {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding-top: 5px;
}
.file__name {
  font-weight: 500;
}
.file__source,
.file__warning,
.file__result {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-xs);
  color: var(--muted);
}
.file__warning {
  color: var(--warning-ink);
}
.file__result--imported {
  color: var(--accent-ink);
  font-weight: 600;
}
.file__result--skipped,
.file__result--failed {
  color: var(--warning-ink);
}
.cell-field {
  width: 100%;
  height: 28px;
  font-size: var(--text-sm);
}
.cell-field--date {
  font-variant-numeric: tabular-nums;
}
.cell-field--missing {
  border-color: var(--warning);
  box-shadow: 0 0 0 2px var(--warning-soft);
}
.cell-hint {
  display: block;
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--warning-ink);
}
.words {
  padding-top: 6px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.failure {
  margin: 0;
  color: var(--danger);
}
.hint {
  margin: 0;
  color: var(--warning-ink);
}
.hint--done {
  color: var(--accent-ink);
  font-weight: 500;
}
.import__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--line);
}
</style>
