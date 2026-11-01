import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useAppStore } from './stores/app'
import './styles/tokens.css'
import './styles/base.css'

document.documentElement.dataset.platform = window.pregar?.platform ?? 'linux'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)

// Rotas vindas do processo principal (?to=) levam direto a uma seção.
const initial = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('to')
if (initial) void router.replace(initial)

void useAppStore(pinia)
  .load()
  .finally(() => app.mount('#app'))
