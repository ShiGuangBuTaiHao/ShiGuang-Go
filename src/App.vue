<script setup lang="ts">
import { computed, nextTick, onBeforeMount, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Bell, House, RefreshCw, Settings, UserRound, X } from 'lucide-vue-next'
import { useRoute } from 'vue-router'
import { useRouter } from 'vue-router'
import { isTauri } from '@tauri-apps/api/core'
import { getEngineStatus, warmupEngine, type EngineStatus } from './services/katago'
import { useLibraryStore } from './stores/library'

const route = useRoute()
const router = useRouter()
const library = useLibraryStore()
const isHome = computed(() => route.name === 'mode-select')
const entryTitle = computed(() => {
  switch (route.name) {
    case 'play-ai': return '人机对局'
    case 'play-human': return '本地对局'
    case 'play-lan': return '局域网对局'
    case 'research': return '研究盘'
    case 'library': return '棋谱库'
    case 'settings': return '设置'
    default: return ''
  }
})
const isLibrary = computed(() => route.name === 'library')
const desktopRuntime = isTauri()
const browserDevelopment = import.meta.env.DEV && !desktopRuntime
const isPlaying = computed(() => route.name === 'play-human' || route.name === 'play-ai' || route.name === 'play-lan' || route.name === 'research')
const isWorkspace = computed(() => isPlaying.value || isLibrary.value)
const isLanGame = computed(() => route.name === 'play-lan')
const immersiveEnabled = ref(false)
const leaveConfirmVisible = ref(false)
const leaveConfirmDialog = ref<HTMLElement | null>(null)
let leaveConfirmRestoreFocus: HTMLElement | null = null
type PlayingSummaryTone = 'ready' | 'busy' | 'error' | 'idle'
type PlayingSummary = {
  primary: string
  secondary: string
  status: string
  statusTone: PlayingSummaryTone
  statusTitle?: string
}
const playingSummary = ref<PlayingSummary>({
  primary: '对局进行中',
  secondary: '',
  status: '正在读取引擎状态',
  statusTone: 'busy',
})
const engineStatus = ref<EngineStatus | null>(null)
const startupReady = ref(browserDevelopment)
const startupChecking = ref(true)
const retrying = ref(false)
let statusTimer: ReturnType<typeof setInterval> | undefined
let enginePollInFlight = false

const engineStatusLabel = computed(() => {
  if (!desktopRuntime) return '引擎离线'
  if (startupChecking.value || engineStatus.value?.warming) return '引擎加载中'
  if (engineStatus.value?.error || engineStatus.value?.configured === false) return 'KataGo 不可用'
  return engineStatus.value && isReady(engineStatus.value) ? '引擎就绪' : '引擎未就绪'
})

function isReady(status: EngineStatus) {
  return status.configured && status.running && !status.warming && !status.error
}

async function pollEngineStatus() {
  if (enginePollInFlight) return
  enginePollInFlight = true
  try {
    const status = await getEngineStatus()
    engineStatus.value = status
    if (isReady(status)) {
      startupReady.value = true
      if (statusTimer) clearInterval(statusTimer)
      statusTimer = undefined
    } else if (!status.configured || status.error) {
      startupReady.value = true
      if (statusTimer) clearInterval(statusTimer)
      statusTimer = undefined
    }
  } catch (error) {
    engineStatus.value = {
      configured: false,
      running: false,
      detail: '引擎状态不可用',
      error: error instanceof Error ? error.message : String(error),
    }
    startupReady.value = true
    if (statusTimer) clearInterval(statusTimer)
    statusTimer = undefined
  } finally {
    startupChecking.value = false
    enginePollInFlight = false
  }
}

async function retryEngine() {
  if (retrying.value) return
  retrying.value = true
  engineStatus.value = {
    configured: engineStatus.value?.configured ?? false,
    running: engineStatus.value?.running ?? false,
    warming: true,
    detail: '正在重试 KataGo 引擎',
  }
  try {
    await warmupEngine()
  } catch (error) {
    engineStatus.value = {
      configured: false,
      running: false,
      detail: '引擎预热失败',
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    retrying.value = false
    await pollEngineStatus()
  }
}

function updatePlayingSummary(event: Event) {
  const detail = (event as CustomEvent<Partial<PlayingSummary>>).detail
  if (!detail?.primary) return
  playingSummary.value = {
    ...playingSummary.value,
    ...detail,
    secondary: detail.secondary ?? '',
    status: detail.status ?? playingSummary.value.status,
    statusTone: detail.statusTone ?? playingSummary.value.statusTone,
  }
}

function updateImmersiveMode(event: Event) {
  immersiveEnabled.value = Boolean((event as CustomEvent<boolean>).detail)
  document.documentElement.dataset.immersive = immersiveEnabled.value ? 'true' : 'false'
}

onBeforeMount(() => {
  window.addEventListener('game-header-summary', updatePlayingSummary)
  window.addEventListener('game-immersive-change', updateImmersiveMode)
})

watch(isPlaying, (playing) => {
  if (!playing) {
    immersiveEnabled.value = false
    delete document.documentElement.dataset.immersive
    leaveConfirmVisible.value = false
    playingSummary.value = {
      primary: '对局进行中',
      secondary: '',
      status: '正在读取引擎状态',
      statusTone: 'busy',
    }
  }
}, { immediate: true })

onMounted(() => {
  if (browserDevelopment) return
  statusTimer = setInterval(() => { void pollEngineStatus() }, 1000)
  void pollEngineStatus()
})

onBeforeUnmount(() => {
  window.removeEventListener('game-header-summary', updatePlayingSummary)
  window.removeEventListener('game-immersive-change', updateImmersiveMode)
  if (statusTimer) clearInterval(statusTimer)
})

function openGameSettings() {
  if (route.name === 'research' || isLibrary.value) {
    window.dispatchEvent(new Event('open-workspace-settings'))
    return
  }
  window.dispatchEvent(new Event('open-game-settings'))
}

const leaveConfirmTarget = computed(() => isLanGame.value ? '局域网房间' : '主界面')
const leaveConfirmMessage = computed(() => `确定要返回${leaveConfirmTarget.value}吗？`)

async function requestLeaveGame() {
  if (!isPlaying.value || leaveConfirmVisible.value) return
  leaveConfirmRestoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  leaveConfirmVisible.value = true
  await nextTick()
  leaveConfirmDialog.value?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
}

function cancelLeaveGame() {
  leaveConfirmVisible.value = false
  leaveConfirmRestoreFocus?.focus()
  leaveConfirmRestoreFocus = null
}

function confirmLeaveGame() {
  leaveConfirmVisible.value = false
  leaveConfirmRestoreFocus = null
  router.push(isLanGame.value ? { name: 'lan-lobby' } : { name: 'mode-select' })
}

function handleLeaveConfirmKeydown(event: KeyboardEvent) {
  if (!leaveConfirmDialog.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelLeaveGame()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = [...leaveConfirmDialog.value.querySelectorAll<HTMLElement>('button:not([disabled])')]
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <div v-if="!startupReady" class="startup-shell">
    <div class="startup-panel" role="status" aria-live="polite" aria-busy="true">
      <h1>正在启动 KataGo 引擎</h1>
      <p class="startup-hint">首次启动可能需要准备推理缓存</p>
      <div class="startup-progress" role="progressbar" aria-label="正在启动 KataGo 引擎"><span /></div>
    </div>
  </div>

  <div v-else class="app-shell" :class="{ home: isHome, immersive: isPlaying && immersiveEnabled }">
    <header class="app-header" :class="{ playing: isPlaying, 'workspace-header': isWorkspace, 'home-header': isHome }">
      <div class="brand">
        <img class="brand-logo" src="/logo.png?v=2" alt="时光围棋 Logo" />
        <div class="brand-copy"><strong class="brand-title"><span>时光围棋</span><span v-if="entryTitle" class="brand-subtitle"> · {{ entryTitle }}</span></strong></div>
      </div>
      <div v-if="isHome" class="home-header-right">
        <div class="home-header-actions">
          <button class="header-settings home-nav-button" type="button" aria-label="查看通知" title="通知">
            <Bell :size="18" />
          </button>
          <button class="header-settings home-nav-button" type="button" aria-label="打开设置" title="设置" @click="router.push({ name: 'settings' })">
            <Settings :size="18" />
          </button>
          <button class="header-settings home-nav-button" type="button" aria-label="打开账号" title="账号">
            <UserRound :size="18" />
          </button>
        </div>
      </div>
      <div v-if="isWorkspace" class="header-actions">
        <div v-if="isPlaying && route.name !== 'research'" class="playing-summary" :title="playingSummary.statusTitle" aria-label="当前对局摘要">
          <div class="playing-summary-copy">
            <strong>{{ playingSummary.primary }}</strong>
            <span v-if="playingSummary.secondary">{{ playingSummary.secondary }}</span>
          </div>
          <span class="playing-engine-status" :class="playingSummary.statusTone" role="status" aria-live="polite">
            <span class="playing-engine-dot" aria-hidden="true" />
            {{ playingSummary.status }}
          </span>
        </div>
        <div v-else-if="!isPlaying" class="playing-summary" aria-label="棋谱库摘要">
          <div class="playing-summary-copy"><strong>棋谱库</strong><span>{{ library.counts.all }} 局</span></div>
        </div>
        <div class="playing-action-buttons">
          <button class="header-settings board-back" type="button" :aria-label="isLanGame ? '返回局域网房间' : '返回主界面'" :title="isLanGame ? '返回局域网房间' : '返回主界面'" @click="isPlaying ? requestLeaveGame() : router.push({ name: 'mode-select' })">
            <House :size="20" aria-hidden="true" />
          </button>
          <button class="header-settings" type="button" :aria-label="isPlaying || isLibrary ? '打开对局设置' : '打开设置'" :title="isPlaying || isLibrary ? '对局设置' : '设置'" @click="openGameSettings">
            <Settings :size="20" />
          </button>
        </div>
      </div>
    </header>
    <RouterView />
    <div v-if="leaveConfirmVisible && isPlaying" class="leave-confirm-backdrop" @click.self="cancelLeaveGame">
      <section ref="leaveConfirmDialog" class="leave-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="leave-confirm-title" tabindex="-1" @keydown="handleLeaveConfirmKeydown">
        <button class="leave-confirm-close" type="button" aria-label="关闭确认弹窗" title="关闭" @click="cancelLeaveGame">
          <X :size="18" aria-hidden="true" />
        </button>
        <div class="leave-confirm-body">
          <h2 id="leave-confirm-title">{{ leaveConfirmMessage }}</h2>
        </div>
        <footer class="leave-confirm-actions">
          <button class="leave-confirm-submit" type="button" @click="confirmLeaveGame">确认</button>
        </footer>
      </section>
    </div>
    <footer v-if="isHome" class="home-footer" aria-label="大厅状态">
      <span class="home-footer-version">v1.2.0</span>
      <span class="home-footer-runtime">
        <span>本地运行 · KataGo</span>
        <span class="home-engine-status" :class="{ ready: engineStatus && isReady(engineStatus), error: engineStatus?.error || engineStatus?.configured === false }" role="status" :title="engineStatus?.error ?? engineStatus?.detail ?? 'KataGo 本地引擎仅在桌面端可用'">
          <span class="home-engine-dot" aria-hidden="true" />{{ engineStatusLabel }}
        </span>
        <button v-if="engineStatus?.error || engineStatus?.configured === false" class="home-engine-retry" type="button" :disabled="retrying" :aria-label="retrying ? '正在重试 KataGo 引擎' : '重试 KataGo 引擎'" :title="retrying ? '正在重试 KataGo 引擎' : '重试 KataGo 引擎'" @click="retryEngine">
          <RefreshCw :size="14" :class="{ spin: retrying }" aria-hidden="true" />
        </button>
      </span>
    </footer>
  </div>
</template>

<style scoped>
.startup-shell { display: grid; width: 100%; min-height: 100vh; min-height: 100dvh; place-items: center; padding: 24px; background: var(--shell); }
.startup-panel { display: flex; width: min(440px, 100%); align-items: center; flex-direction: column; padding: 36px 40px 32px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: var(--shadow-md); text-align: center; }
.startup-panel h1 { margin: 0; color: var(--text); font-family: "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 24px; font-weight: 600; line-height: 32px; }
.startup-hint { margin: 8px 0 0; color: var(--muted); font-size: 12px; line-height: 20px; }
.startup-progress { width: min(240px, 100%); height: 4px; margin-top: 24px; overflow: hidden; border-radius: 2px; background: var(--surface-muted); }
.startup-progress span { display: block; width: 36%; height: 100%; border-radius: inherit; background: var(--accent); animation: startup-progress 1.25s cubic-bezier(.4, 0, .6, 1) infinite; will-change: transform; }
@keyframes startup-progress { 0% { transform: translateX(-140%); } 50% { transform: translateX(140%); } 100% { transform: translateX(320%); } }
@media (prefers-reduced-motion: reduce) { .startup-progress span { animation: none; } }

.app-shell { display: flex; width: 100%; height: 100vh; min-height: 0; flex-direction: column; overflow: hidden; }
.app-header { z-index: 5; display: grid; height: 64px; flex: 0 0 64px; grid-template-columns: minmax(0, 1fr) auto; align-items: center; padding: 0 22px; border-bottom: 1px solid var(--border); background: #fff; }
.app-header.workspace-header { grid-template-columns: 1fr auto; }
.brand { display: flex; min-width: 0; align-items: center; gap: 10px; }
.brand-logo { display: block; width: 24px; height: 24px; flex: 0 0 auto; object-fit: contain; }
.brand div { display: flex; align-items: baseline; }
.brand strong { color: var(--text); font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif; font-size: 20px; font-weight: 600; line-height: 1.2; }
.brand-copy { min-width: 0; }
.brand-title { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; column-gap: 6px; row-gap: 2px; }
.brand-title > span { white-space: nowrap; }
.brand-title .brand-subtitle { color: inherit; font-size: inherit; font-weight: inherit; line-height: inherit; }
.header-actions { display: flex; min-width: 0; align-items: center; justify-content: flex-end; gap: 6px; }
.header-settings { display: grid; width: 36px; height: 36px; place-items: center; padding: 0; border: 1px solid var(--border); border-radius: 6px; color: var(--text); background: #fff; }
.header-settings:hover { border-color: #b8bdc0; color: var(--accent); background: #f7f8f8; }
.header-mode { display: flex; height: 32px; align-items: center; gap: 10px; color: var(--text); font-size: 12px; }
.header-back { display: grid; width: 30px; height: 30px; padding: 0; place-items: center; border: 1px solid var(--border); border-radius: 5px; color: var(--text); background: #fff; }
.header-back:hover { border-color: #b8bdc0; background: #f7f8f8; }
@media (max-width: 680px) { .app-header { grid-template-columns: 1fr auto; } .header-mode { display: none; } }

/* Phase 1 shell polish: quiet chrome, explicit states, no decorative framing. */
.startup-shell { background: var(--shell); }
.startup-panel { width: min(440px, 100%); padding: 36px 40px 32px; border-color: var(--border); border-radius: 8px; background: var(--surface); box-shadow: var(--shadow-md); }
.startup-panel h1 { font-size: 24px; }
.startup-hint { color: var(--muted); line-height: 1.5; }
.startup-progress { height: 4px; border-radius: 2px; background: var(--surface-muted); }
.startup-progress span { border-radius: 2px; background: var(--accent); }
.app-header { padding: 0 24px; background: var(--surface); }
.brand { gap: 11px; }
.brand-copy { display: flex; align-items: baseline; gap: 9px; }
.brand-copy small { color: var(--text-subtle); font-size: 11px; }
.header-settings { border-radius: 6px; background: var(--surface); transition: border-color 160ms ease, color 160ms ease, background 160ms ease; }
.header-settings:hover { border-color: var(--accent); color: var(--accent-strong); background: var(--accent-soft); }
@media (max-width: 680px) { .app-header { padding: 0 16px; }.brand-copy small { display: none; } }

.app-shell.home { --home-background: #f3f2f1; background-color: var(--home-background); background-image: linear-gradient(rgba(243, 242, 241, .18), rgba(243, 242, 241, .18)), url('/home-background.png'); background-position: center; background-size: cover; background-repeat: no-repeat; }
.home-header { grid-template-columns: 1fr auto; gap: 18px; padding: 0 18px; border-bottom: 1px solid rgba(225, 225, 225, .9); background: rgba(255, 255, 255, .4); box-shadow: 0 1.6px 3.6px rgba(0, 0, 0, .13), 0 .3px .9px rgba(0, 0, 0, .1); backdrop-filter: blur(20px); }
.home-header .brand-copy { gap: 8px; }
.home-header .brand-copy small { color: #605e5c; font-size: 12px; }
.home-engine-status { display: inline-flex; align-items: center; gap: 8px; color: #323130; font-size: 11px; text-shadow: 0 1px 2px rgba(255, 255, 255, .7); white-space: nowrap; }
.home-engine-dot { width: 5px; height: 5px; flex: 0 0 auto; border-radius: 50%; background: #a19f9d; }
.home-engine-status.ready .home-engine-dot { background: var(--accent-strong); }
.home-engine-status.error { color: #e81123; }
.home-engine-status.error .home-engine-dot { background: currentColor; }
.home-engine-retry { display: grid; width: 28px; height: 28px; flex: 0 0 auto; place-items: center; padding: 0; border: 1px solid transparent; border-radius: 5px; color: #a4262c; background: transparent; transition: border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out; }
.home-engine-retry:hover:not(:disabled) { border-color: rgba(232, 17, 35, .22); color: #a4262c; background: rgba(255, 255, 255, .72); }
.home-engine-retry:disabled { cursor: wait; opacity: .58; }
.home-engine-retry:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.home-engine-retry .spin { animation: engine-retry-spin .8s linear infinite; }
@keyframes engine-retry-spin { to { transform: rotate(360deg); } }
.home-header-right { display: flex; width: max-content; min-width: 0; align-items: center; justify-self: end; gap: 18px; }
.home-header-actions { display: flex; width: auto; flex: 0 0 auto; align-items: center; gap: 4px; }
.home-nav-button { border-color: transparent; background: transparent; transition: border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out; }
.home-nav-button:hover { border-color: rgba(255,255,255,.6); color: #0078d4; background: rgba(255,255,255,.72); box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.1); }
.home-nav-button:active { transform: scale(.97); box-shadow: none; }
.home-nav-button:focus-visible { outline: 2px solid #0078d4; outline-offset: 2px; box-shadow: 0 0 0 4px var(--home-background), 0 0 0 6px #0078d4; }
.home-footer { display: flex; height: 48px; flex: 0 0 48px; align-items: center; justify-content: space-between; gap: 20px; padding: 0 18px; border-top: 1px solid rgba(225, 225, 225, .9); color: #323130; background: rgba(255, 255, 255, .4); box-shadow: 0 -1.6px 3.6px rgba(0, 0, 0, .13), 0 -.3px .9px rgba(0, 0, 0, .1); font-size: 11px; letter-spacing: .01em; text-shadow: 0 1px 2px rgba(255, 255, 255, .7); backdrop-filter: blur(20px); }
.home-footer-version { color: #323130; font-weight: 600; }
.home-footer-runtime { display: inline-flex; min-width: 0; align-items: center; gap: 12px; }
@media (max-width: 760px) { .home-header { gap: 10px; padding-inline: 14px; }.home-header-right { gap: 10px; }.home-footer { padding-inline: 14px; } }
@media (max-width: 440px) { .home-header { position: relative; } .home-header-right { width: auto; min-width: 0; gap: 0; } .home-header-actions { position: absolute; top: 10px; right: 16px; width: auto; } .home-nav-button { color: #323130; background: rgba(255,255,255,.4); } .home-footer { height: 44px; flex-basis: 44px; font-size: 10px; } .home-footer-runtime { gap: 8px; } .home-engine-status { font-size: 10px; } }
@media (prefers-reduced-motion: reduce) { .home-engine-retry .spin { animation: none; } }
.app-header.workspace-header {
  grid-template-columns: minmax(0, 1fr) auto;
  border-bottom-color: rgba(225, 225, 225, 0.65);
  padding-inline: 18px;
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: var(--shadow-xs);
}
.app-shell:not(.home) {
  background-color: var(--shell);
  background-image: linear-gradient(rgba(243, 242, 241, 0.22), rgba(243, 242, 241, 0.22)), url('/home-background.png');
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
}
.app-header.workspace-header .header-settings {
  width: 40px;
  height: 40px;
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  transition: border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out;
}
.app-header.workspace-header .header-settings:hover {
  border-color: rgba(255, 255, 255, 0.6);
  color: var(--accent-strong);
  background: rgba(255, 255, 255, 0.7);
  box-shadow: var(--shadow-sm);
}
.app-header.workspace-header .header-settings:active { transform: scale(0.97); box-shadow: none; }
.app-header.workspace-header .header-settings:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; box-shadow: 0 0 0 4px rgba(243, 242, 241, 0.9), 0 0 0 6px var(--accent); }
.playing-action-buttons { display: flex; align-items: center; gap: 8px; }
.playing-summary { display: flex; min-width: 0; max-width: min(440px, 42vw); flex-wrap: nowrap; align-items: center; gap: 16px; padding: 5px 14px 5px 4px; border-right: 1px solid rgba(225, 225, 225, 0.72); white-space: nowrap; }
.playing-summary-copy { display: flex; min-width: 0; flex: 1 1 auto; align-items: center; gap: 8px; }
.playing-summary-copy strong,
.playing-summary-copy span { min-width: 0; overflow: hidden; color: var(--text); font-size: 12px; font-weight: 600; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
.playing-summary-copy strong { flex: 0 0 auto; }
.playing-summary-copy span { flex: 1 1 auto; }
.playing-engine-status { display: inline-flex; min-width: 0; align-items: center; gap: 7px; overflow: hidden; color: var(--text-subtle); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.playing-engine-dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: #a19f9d; }
.playing-engine-status.ready { color: var(--accent-strong); }
.playing-engine-status.ready .playing-engine-dot { background: var(--accent-strong); }
.playing-engine-status.busy { color: #8a6500; }
.playing-engine-status.busy .playing-engine-dot { background: #ffb900; }
.playing-engine-status.error { color: #a4262c; }
.playing-engine-status.error .playing-engine-dot { background: #e81123; }
.leave-confirm-backdrop { position: fixed; z-index: 60; inset: 0; display: grid; place-items: center; padding: 20px; background: rgba(32, 32, 32, .16); backdrop-filter: blur(4px); }
.leave-confirm-dialog { position: relative; display: grid; width: min(420px, 100%); height: 216px; grid-template-rows: 146px 70px; overflow: hidden; border: 1px solid rgba(255, 255, 255, .84); border-radius: 8px; background: rgba(255, 255, 255, .68); box-shadow: 0 24px 60px rgba(0, 0, 0, .18), 0 2px 8px rgba(0, 0, 0, .08); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
.leave-confirm-close { position: absolute; top: 12px; right: 12px; z-index: 1; display: grid; width: 36px; height: 36px; place-items: center; padding: 0; border: 1px solid transparent; border-radius: 6px; color: #323130; background: transparent; transition: border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out; }
.leave-confirm-close:hover { color: #0078d4; border-color: rgba(255,255,255,.6); background: rgba(255,255,255,.72); box-shadow: var(--shadow-xs); }
.leave-confirm-close:active { transform: scale(.97); }
.leave-confirm-body { display: grid; min-height: 0; place-items: center; padding: 42px 56px 18px; text-align: center; }
.leave-confirm-body h2 { margin: 0; color: #323130; font-size: 22px; font-weight: 700; line-height: 1.35; }
.leave-confirm-actions { display: flex; min-height: 0; align-items: center; justify-content: flex-end; gap: 8px; padding: 10px 24px 20px; border: 0; background: transparent; }
.leave-confirm-submit { min-width: 76px; min-height: 40px; padding: 0 18px; border: 1px solid #0078d4; border-radius: 6px; color: #fff; background: #0078d4; box-shadow: var(--shadow-xs); font: inherit; font-size: 13px; font-weight: 600; transition: transform 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out; }
.leave-confirm-submit:hover { background: #106ebe; box-shadow: var(--shadow-sm); }
.leave-confirm-submit:active { transform: scale(.97); background: #005a9e; box-shadow: none; }
.leave-confirm-close:focus-visible, .leave-confirm-submit:focus-visible { outline: 2px solid #0078d4; outline-offset: 2px; box-shadow: 0 0 0 4px rgba(255,255,255,.4), 0 0 0 6px #0078d4; }
@media (max-width: 760px) {
  .playing-summary { max-width: min(280px, 42vw); gap: 8px; padding-right: 8px; }
  .playing-summary-copy { gap: 5px; }
  .playing-engine-status { font-size: 9px; gap: 4px; }
}
@media (max-width: 520px) {
  .playing-summary { display: none; }
  .playing-summary-copy strong { font-size: 11px; }
  .playing-action-buttons { gap: 3px; }
  .app-header.workspace-header { padding-inline: 10px; }
}
@media (max-width: 520px) { .leave-confirm-backdrop { padding: 14px; }.leave-confirm-body { padding-inline: 28px; }.leave-confirm-body h2 { font-size: 20px; }.leave-confirm-actions { padding-right: 18px; padding-bottom: 18px; } }

.app-shell.immersive .app-header.workspace-header {
  display: none;
}
</style>
<style src="./components/workspace/workspace.css"></style>
