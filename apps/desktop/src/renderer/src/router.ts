import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: () => `/${window.pregar?.windowKind ?? 'mesa'}` },
    { path: '/mesa', name: 'mesa', component: () => import('./views/mesa/MesaView.vue') },
    { path: '/leitor', name: 'leitor', component: () => import('./views/leitor/ReaderView.vue') },
    { path: '/biblioteca', name: 'biblioteca', component: () => import('./views/biblioteca/LibraryView.vue') },
    { path: '/arquivo', name: 'arquivo', component: () => import('./views/arquivo/ArchiveView.vue') },
    { path: '/biblia', name: 'biblia', component: () => import('./views/biblia/BibleView.vue') },
    { path: '/preferencias/:section?', name: 'preferencias', component: () => import('./views/preferencias/PreferencesView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/mesa' },
  ],
})
