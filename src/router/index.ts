import { createRouter, createWebHashHistory } from 'vue-router'
import PlayView from '../views/PlayView.vue'
import ModeSelectView from '../views/ModeSelectView.vue'
import LanLobbyView from '../views/LanLobbyView.vue'
import LanGameView from '../views/LanGameView.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'mode-select', component: ModeSelectView },
    { path: '/lan', name: 'lan-lobby', component: LanLobbyView },
    { path: '/research', name: 'research', component: () => import('../views/ResearchView.vue') },
    { path: '/library', name: 'library', component: () => import('../views/LibraryView.vue') },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
    {
      path: '/play/human',
      name: 'play-human',
      component: PlayView,
    },
    {
      path: '/play/ai',
      name: 'play-ai',
      component: PlayView,
    },
    {
      path: '/play/lan',
      name: 'play-lan',
      component: LanGameView,
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
