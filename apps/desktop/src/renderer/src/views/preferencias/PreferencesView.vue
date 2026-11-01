<script setup lang="ts">
/**
 * Janela de Preferências: barra lateral fixa com as seções e conteúdo rolável. A seção vem do
 * parâmetro da rota (/preferencias/conta, /preferencias/ia…), para outras janelas abrirem direto.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import SectionLabel from '@/components/SectionLabel.vue'
import { PREFERENCES_SECTIONS, findSection } from './sections'

const route = useRoute()
const scroller = ref<HTMLElement | null>(null)
const heading = ref<HTMLElement | null>(null)

const current = computed(() => findSection(route.params.section))

watch(
  () => current.value.id,
  async (_id, previous) => {
    if (!previous) return
    await nextTick()
    if (scroller.value) scroller.value.scrollTop = 0
    heading.value?.focus({ preventScroll: true })
  },
)
</script>

<template>
  <div class="prefs">
    <nav class="prefs__nav" aria-label="Seções das preferências">
      <div class="prefs__nav-top drag-region" />
      <SectionLabel title="Preferências" tag="h2" class="prefs__nav-label" />
      <ul class="prefs__nav-list">
        <li v-for="section in PREFERENCES_SECTIONS" :key="section.id">
          <RouterLink
            :to="`/preferencias/${section.id}`"
            replace
            class="prefs__nav-item"
            :class="{ 'prefs__nav-item--active': section.id === current.id }"
            :aria-current="section.id === current.id ? 'page' : undefined"
          >
            <component :is="section.icon" :size="15" aria-hidden="true" />
            <span>{{ section.title }}</span>
          </RouterLink>
        </li>
      </ul>
    </nav>

    <main class="prefs__main">
      <div class="prefs__drag drag-region" />
      <div ref="scroller" class="prefs__scroll scroll">
        <div class="prefs__content">
          <header class="prefs__heading">
            <h1 ref="heading" class="prefs__title" tabindex="-1">{{ current.title }}</h1>
            <p class="prefs__subtitle">{{ current.subtitle }}</p>
          </header>
          <component :is="current.component" :key="current.id" />
        </div>
      </div>
      <footer class="prefs__footer">{{ current.footer }}</footer>
    </main>
  </div>
</template>

<style scoped>
.prefs {
  height: 100%;
  display: flex;
  background: var(--canvas);
}
.prefs__nav {
  flex: none;
  width: 214px;
  display: flex;
  flex-direction: column;
  padding: 0 10px 14px;
  background: var(--sidebar);
  border-right: 1px solid var(--line);
  overflow-y: auto;
}
.prefs__nav-top {
  flex: none;
  height: 40px;
}
.prefs__nav-label {
  padding: 0 10px 8px;
}
.prefs__nav-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.prefs__nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  padding: 0 10px;
  border-radius: 7px;
  font-size: 13px;
  color: var(--ink);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: default;
  transition: background 0.12s var(--ease);
}
.prefs__nav-item:hover {
  background: color-mix(in srgb, var(--ink) 6%, transparent);
}
.prefs__nav-item--active,
.prefs__nav-item--active:hover {
  color: var(--accent);
  font-weight: 600;
  background: var(--accent-soft);
}
.prefs__nav-item svg {
  flex: none;
}
.prefs__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.prefs__drag {
  flex: none;
  height: 16px;
}
.prefs__scroll {
  flex: 1;
  min-height: 0;
}
.prefs__content {
  max-width: 820px;
  padding: 16px 32px 40px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.prefs__heading {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.prefs__title {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 24px;
  font-weight: 600;
  outline: none;
}
.prefs__subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
.prefs__footer {
  flex: none;
  padding: 10px 32px;
  border-top: 1px solid var(--line);
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

<style>
/* Pilha vertical comum às seções das Preferências. */
.section-stack {
  display: flex;
  flex-direction: column;
  gap: 22px;
}
</style>
