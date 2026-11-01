<script setup lang="ts">
/**
 * Folhas da Mesa: mostra a que corresponde a `mesa.activeSheet` e fecha devolvendo `null`.
 * As folhas de IA nunca enviam nada sem o clique no botão de envio.
 */
import { defineAsyncComponent } from 'vue'
import { useMesaStore } from '@/stores/mesa'
import CommandSearchSheet from './CommandSearchSheet.vue'
import DriveSheet from './DriveSheet.vue'
import QuestionsSheet from './QuestionsSheet.vue'
import ReviewSheet from './ReviewSheet.vue'
import ShortcutsSheet from './ShortcutsSheet.vue'

// Folhas maiores, carregadas na primeira abertura.
const HistorySheet = defineAsyncComponent(() => import('./HistorySheet.vue'))
const RehearsalSheet = defineAsyncComponent(() => import('./RehearsalSheet.vue'))
const TabletSheet = defineAsyncComponent(() => import('./TabletSheet.vue'))

const mesa = useMesaStore()

function close(): void {
  mesa.activeSheet = null
}
</script>

<template>
  <ReviewSheet v-if="mesa.activeSheet === 'review'" @close="close" />
  <QuestionsSheet v-else-if="mesa.activeSheet === 'questions'" @close="close" />
  <TabletSheet v-else-if="mesa.activeSheet === 'tablet'" @close="close" />
  <HistorySheet v-else-if="mesa.activeSheet === 'history'" @close="close" />
  <RehearsalSheet v-else-if="mesa.activeSheet === 'rehearsal'" @close="close" />
  <DriveSheet v-else-if="mesa.activeSheet === 'drive'" @close="close" />
  <ShortcutsSheet v-else-if="mesa.activeSheet === 'shortcuts'" @close="close" />
  <CommandSearchSheet v-else-if="mesa.activeSheet === 'commands'" @close="close" />
</template>
