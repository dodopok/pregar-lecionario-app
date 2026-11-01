<script setup lang="ts">
/**
 * Capa do livro de oração: imagem do catálogo (só https) ou capa tipográfica com monograma, ano e
 * jurisdição, como no app Swift.
 */
import { computed, ref, watch } from 'vue'
import { jurisdictionMonogram, prayerBookCoverURL, prayerBookMonogram } from '@pregar/core/liturgy/types'
import type { PrayerBookCatalogEntry } from '@pregar/core/liturgy/types'

const props = withDefaults(defineProps<{ book: PrayerBookCatalogEntry; width?: number; height?: number }>(), { width: 54, height: 72 })

const failed = ref(false)
const url = computed(() => (failed.value ? null : prayerBookCoverURL(props.book)))
const large = computed(() => props.width > 45)
const monogram = computed(() => prayerBookMonogram(props.book))
const jurisdiction = computed(() => jurisdictionMonogram(props.book))

watch(
  () => props.book.code,
  () => (failed.value = false),
)
</script>

<template>
  <div class="cover" :style="{ width: `${width}px`, height: `${height}px` }" aria-hidden="true">
    <img v-if="url" :src="url" alt="" loading="lazy" referrerpolicy="no-referrer" @error="failed = true" />
    <div v-else class="cover__placeholder" :class="{ 'cover__placeholder--large': large }">
      <span v-if="height > 60" class="cover__kicker">LIVRO DE ORAÇÃO</span>
      <span class="cover__monogram">{{ monogram }}</span>
      <span class="cover__rule" />
      <span class="cover__year">{{ book.year ?? 'LOC' }}</span>
      <span v-if="large && jurisdiction" class="cover__jurisdiction">{{ jurisdiction }}</span>
    </div>
  </div>
</template>

<style scoped>
.cover {
  /* Capa encadernada em verde escuro, igual em claro e escuro. Tokens propostos: --cover-cloth e --cover-ink. */
  --cloth: var(--cover-cloth, color-mix(in srgb, var(--green) 52%, black));
  --gilt: var(--cover-ink, color-mix(in srgb, var(--canvas) 92%, var(--warning)));
  flex: none;
  border-radius: 5px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: var(--accent-soft);
}
@media (prefers-color-scheme: dark) {
  .cover {
    /* No escuro, a tinta clara é a própria cor do texto. */
    --gilt: var(--cover-ink, color-mix(in srgb, var(--ink) 92%, var(--warning)));
  }
}
.cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover__placeholder {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 6px 12%;
  background: var(--cloth);
  color: var(--gilt);
  text-align: center;
  line-height: 1;
}
.cover__placeholder::after {
  content: '';
  position: absolute;
  inset: 3px;
  border: 0.7px solid color-mix(in srgb, var(--gilt) 48%, transparent);
  border-radius: 3px;
  pointer-events: none;
}
.cover__kicker {
  position: absolute;
  top: 8px;
  left: 0;
  right: 0;
  font-size: 5.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.cover__monogram {
  font-family: var(--font-serif);
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}
.cover__placeholder--large .cover__monogram {
  font-size: 20px;
}
.cover__rule {
  width: 46%;
  height: 0.7px;
  background: currentColor;
  margin: 2px 0;
}
.cover__year {
  font-size: 6px;
  font-weight: 500;
}
.cover__placeholder--large .cover__year {
  font-size: 7px;
}
.cover__jurisdiction {
  font-size: 6px;
  font-weight: 600;
  margin-top: 1px;
}
</style>
