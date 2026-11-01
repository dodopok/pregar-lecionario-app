<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { coverObjectURL } from './cover-cache'
import { coverInitials, coverTone } from './library-helpers'

/** Capa da obra: miniatura da primeira página ou, sem ela, capa tipográfica na cor da série. */
const props = defineProps<{ title: string; src: string | null; width: number; height: number }>()

const failed = ref(false)
const objectURL = ref<string | null>(null)
watch(
  () => props.src,
  async (src) => {
    failed.value = false
    if (!src) {
      objectURL.value = null
      return
    }
    const url = await coverObjectURL(src)
    if (props.src === src) objectURL.value = url
  },
  { immediate: true },
)
const tone = computed(() => coverTone(props.title))
const initials = computed(() => coverInitials(props.title))
const showImage = computed(() => Boolean(objectURL.value) && !failed.value)
</script>

<template>
  <div class="cover" :class="`cover--${tone}`" :style="{ width: `${width}px`, height: `${height}px` }" aria-hidden="true">
    <img v-if="showImage" :src="objectURL!" alt="" decoding="async" draggable="false" @error="failed = true" />
    <template v-else>
      <span class="cover__initials serif" :style="{ fontSize: `${Math.round(width * 0.36)}px` }">{{ initials }}</span>
      <span v-if="width >= 60" class="cover__rule" />
    </template>
  </div>
</template>

<style scoped>
.cover {
  /* Cores das capas tipográficas do app Swift (Feasting, Wright/For Everyone e demais). */
  --cover-blue: rgb(48 97 130);
  --cover-brown: rgb(122 87 54);
  --cover-stone: rgb(122 120 107);
  --cover-ink: rgb(255 255 255 / 0.92);
  flex: none;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  overflow: hidden;
  border-radius: 4px;
  box-shadow:
    0 0 0 1px var(--line),
    0 2px 3px rgb(0 0 0 / 0.13);
  background: var(--cover-stone);
  color: var(--cover-ink);
}
.cover--blue {
  background: var(--cover-blue);
}
.cover--brown {
  background: var(--cover-brown);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: var(--surface);
}
.cover__initials {
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1;
}
.cover__rule {
  width: 40%;
  height: 1px;
  background: currentColor;
  opacity: 0.5;
}
</style>
