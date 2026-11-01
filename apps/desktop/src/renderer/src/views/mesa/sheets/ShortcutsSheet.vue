<script setup lang="ts">
/** Atalhos de teclado (as tabelas do README), escritos para o sistema em uso. */
import { Keyboard } from 'lucide-vue-next'
import PButton from '@/components/PButton.vue'
import Sheet from '@/components/Sheet.vue'
import SheetHeader from '@/components/SheetHeader.vue'
import { isMac } from '@/lib/api'
import { useMesaStore } from '@/stores/mesa'
import { SHORTCUT_TABLES, platformKeys } from './commands'

const emit = defineEmits<{ close: [] }>()
const mesa = useMesaStore()
const mac = isMac()
</script>

<template>
  <Sheet :width="680" label="Atalhos de teclado" @close="emit('close')">
    <div class="shortcuts">
      <header class="shortcuts__header">
        <SheetHeader
          title="Atalhos de teclado"
          :subtitle="`Pesquise qualquer comando com ${platformKeys('⌥/', mac)}.`"
          :icon="Keyboard"
        />
        <PButton @click="emit('close')">Fechar</PButton>
      </header>
      <div class="scroll shortcuts__body">
        <table v-for="table in SHORTCUT_TABLES" :key="table.title" class="table">
          <caption class="table__caption">
            <span class="table__title">{{ table.title }}</span>
            <span v-if="table.note" class="table__note">{{ table.note }}</span>
          </caption>
          <thead class="visually-hidden">
            <tr>
              <th scope="col">Atalho</th>
              <th scope="col">Ação</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in table.rows" :key="row.keys + row.action">
              <td class="table__keys">
                <kbd>{{ platformKeys(row.keys, mac) }}</kbd>
              </td>
              <td class="table__action">{{ row.action }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer class="shortcuts__footer">
        <PButton variant="link" compact @click="mesa.openSheet('commands')">Pesquisar comandos</PButton>
      </footer>
    </div>
  </Sheet>
</template>

<style scoped>
.shortcuts {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}
.shortcuts__header {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
}
.shortcuts__header > :first-child {
  flex: 1;
}
.shortcuts__body {
  max-height: min(560px, calc(100vh - 240px));
  display: flex;
  flex-direction: column;
  gap: var(--space-xl);
  padding-right: 4px;
}
.table {
  width: 100%;
  border-collapse: collapse;
}
.table__caption {
  text-align: left;
  padding-bottom: 6px;
}
.table__title {
  display: block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}
.table__note {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--muted);
}
.table td {
  padding: 6px 0;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}
.table__keys {
  width: 46%;
  padding-right: 12px !important;
}
.table__keys kbd {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ink);
  white-space: pre-wrap;
}
.table__action {
  font-size: 12px;
}
.shortcuts__footer {
  display: flex;
}
</style>
