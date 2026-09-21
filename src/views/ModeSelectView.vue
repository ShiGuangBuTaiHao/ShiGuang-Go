<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useGameStore } from '../stores/game'
import SetupDropdown, { type SetupDropdownOption } from '../components/ui/SetupDropdown.vue'
import {
  AI_STRENGTHS,
  AMATEUR_STRENGTHS,
  DAN_STRENGTHS,
} from '../services/katago'
import {
  CUSTOM_BYO_YOMI_OPTIONS,
  CUSTOM_MAIN_TIME_OPTIONS,
  CUSTOM_PERIOD_OPTIONS,
  HANDICAP_OPTIONS,
  RULE_PRESETS,
  TIME_PRESETS,
  formatKomi,
  komiFor,
  komiUnitFor,
  loadGameSetup,
  normalizeGameSetup,
  resolvePlayerColor,
  saveGameSetup,
  type GameSetup,
  type Handicap,
  type TimePresetId,
} from '../domain/gameSetup'

const router = useRouter()
const game = useGameStore()
const aiSetupVisible = ref(false)
const setup = reactive<GameSetup>(loadGameSetup('rank_10k'))
const slogans = ['明日复明日，明日何其多', '时光会把你雕刻成你应有的样子', '你就当那是一段如有神助的时光吧']
const typedSlogan = ref('')
const recentGame = ref<{ strength: string; updatedAt: string } | null>(loadRecentGame())
let sloganIndex = 0
let characterIndex = 0
let deleting = false
let typingTimer: ReturnType<typeof setTimeout> | undefined

const selectedRule = computed(() => RULE_PRESETS[setup.ruleSet])
const currentKomi = computed(() => komiFor(setup.ruleSet, setup.handicap))
const currentKomiLabel = computed(() => `${formatKomi(currentKomi.value)}${komiUnitFor(setup.ruleSet)}`)
const selectedHandicapLabel = computed(() =>
  HANDICAP_OPTIONS.find((option) => option.value === setup.handicap)?.label ?? '分先',
)
const playerColorLabel = computed(() => ({ random: '猜先', black: '执黑', white: '执白' }[setup.playerColor]))
const timePresetLabel = computed(() => ({
  blitz: '快棋',
  standard: '普通',
  slow: '慢棋',
  custom: '自定义',
  untimed: '不计时',
}[setup.timeControl.preset]))

const playerColorOptions: SetupDropdownOption[] = [
  { value: 'random', label: '猜先', description: '随机决定黑白' },
  { value: 'black', label: '执黑', description: '玩家先手' },
  { value: 'white', label: '执白', description: 'KataGo 先手' },
]

const ruleOptions: SetupDropdownOption[] = Object.entries(RULE_PRESETS).map(([value, preset]) => ({
  value,
  label: preset.label,
  description: `${preset.scoring} · ${value === 'chinese' ? '中国通行规则' : value === 'japanese-korean' ? '日韩通行规则' : '美国围棋协会规则'}`,
}))

const handicapOptions: SetupDropdownOption[] = HANDICAP_OPTIONS.map((option) => ({
  value: String(option.value),
  label: option.label,
  description: option.value === 0 ? '双方分先' : '黑方让给白方，白方先下让子',
}))

const timeOptions: SetupDropdownOption[] = [
  { value: 'blitz', label: '快棋', description: '1 分钟 · 15 秒 × 3' },
  { value: 'standard', label: '普通', description: '10 分钟 · 30 秒 × 3' },
  { value: 'slow', label: '慢棋', description: '30 分钟 · 40 秒 × 3' },
  { value: 'custom', label: '自定义', description: '自行设置主时间和读秒' },
  { value: 'untimed', label: '不计时', description: '不显示倒计时' },
]

const rankOptions: SetupDropdownOption[] = [
  ...AMATEUR_STRENGTHS.map((value) => ({ value, label: AI_STRENGTHS[value].label, group: '业余级' })),
  ...DAN_STRENGTHS.map((value) => ({ value, label: AI_STRENGTHS[value].label, group: '段位' })),
]

const customMainTimeOptions: SetupDropdownOption[] = CUSTOM_MAIN_TIME_OPTIONS.map((value) => ({
  value: String(value),
  label: value === 0 ? '0 分钟' : `${value / 60} 分钟`,
}))
const customByoYomiOptions: SetupDropdownOption[] = CUSTOM_BYO_YOMI_OPTIONS.map((value) => ({ value: String(value), label: `${value} 秒` }))
const customPeriodOptions: SetupDropdownOption[] = CUSTOM_PERIOD_OPTIONS.map((value) => ({ value: String(value), label: `${value} 次` }))

onBeforeUnmount(() => {
  if (typingTimer) clearTimeout(typingTimer)
  window.removeEventListener('keydown', handleSetupKeydown)
})

onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    typedSlogan.value = slogans[0]
    return
  }
  typeSlogan()
})

function typeSlogan() {
  const slogan = slogans[sloganIndex]
  if (!deleting) {
    characterIndex += 1
    typedSlogan.value = slogan.slice(0, characterIndex)
    if (characterIndex === slogan.length) {
      deleting = true
      typingTimer = setTimeout(typeSlogan, 1600)
      return
    }
  } else {
    characterIndex -= 1
    typedSlogan.value = slogan.slice(0, characterIndex)
    if (characterIndex === 0) {
      deleting = false
      sloganIndex = (sloganIndex + 1) % slogans.length
    }
  }
  typingTimer = setTimeout(typeSlogan, deleting ? 56 : 82)
}

function loadRecentGame(): { strength: string; updatedAt: string } | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem('go.recent-game') ?? 'null') as { strength?: string; updatedAt?: string } | null
    if (saved?.strength && saved.updatedAt) return { strength: saved.strength, updatedAt: saved.updatedAt }
  } catch {
    // Local history is optional and should never block the home page.
  }
  return null
}

function saveRecentGame(strength: string) {
  const value = { strength, updatedAt: new Date().toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }
  recentGame.value = value
  try { window.localStorage.setItem('go.recent-game', JSON.stringify(value)) } catch { /* storage is optional */ }
}

function openAiGameSetup() {
  aiSetupVisible.value = true
  window.addEventListener('keydown', handleSetupKeydown)
}

function startRecentGame() {
  const lastSetup = loadGameSetup(setup.aiStrength)
  Object.assign(setup, lastSetup)
  startAiGame()
}

function closeAiGameSetup() {
  aiSetupVisible.value = false
  window.removeEventListener('keydown', handleSetupKeydown)
}

function selectTimePreset(preset: TimePresetId) {
  setup.timeControl = preset === 'custom'
    ? {
        preset: 'custom',
        mainTimeSeconds: 600,
        byoYomiSeconds: 30,
        byoYomiPeriods: 3,
      }
    : { ...TIME_PRESETS[preset] }
}

function selectHandicap(value: string) {
  const handicap = Number(value)
  if (HANDICAP_OPTIONS.some((option) => option.value === handicap)) setup.handicap = handicap as Handicap
}

function selectTimePresetValue(value: string) {
  if (['blitz', 'standard', 'slow', 'custom', 'untimed'].includes(value)) selectTimePreset(value as TimePresetId)
}

function selectAiStrength(value: string) {
  if (value in AI_STRENGTHS) setup.aiStrength = value as GameSetup['aiStrength']
}

function selectCustomMainTime(value: string) {
  setup.timeControl.mainTimeSeconds = Number(value)
}

function selectCustomByoYomi(value: string) {
  setup.timeControl.byoYomiSeconds = Number(value)
}

function selectCustomPeriods(value: string) {
  setup.timeControl.byoYomiPeriods = Number(value)
}

function startAiGame() {
  const normalized = normalizeGameSetup(
    { ...setup, resolvedPlayerColor: resolvePlayerColor(setup.playerColor) },
    setup.aiStrength,
  )
  Object.assign(setup, normalized)
  saveGameSetup(normalized)
  saveRecentGame(AI_STRENGTHS[normalized.aiStrength].label)
  game.reset(normalized.handicap)
  closeAiGameSetup()
  router.push({ name: 'play-ai' })
}

function handleSetupKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeAiGameSetup()
}
</script>

<template>
  <main class="home-page">
    <section class="home-main" aria-label="游戏大厅">
      <p class="home-motto" aria-live="polite"><span>{{ typedSlogan }}</span><i aria-hidden="true" /></p>
      <div class="home-workspace" aria-label="主要功能">
        <button class="feature-card feature-card-primary feature-card-ai" type="button" aria-label="人机对局" @click="openAiGameSetup">
          <span class="feature-title">人机对局</span>
        </button>
        <div class="feature-stack">
          <button class="feature-card feature-card-secondary feature-card-lan" type="button" @click="router.push({ name: 'lan-lobby' })">
            <span class="feature-title">局域网对局</span>
          </button>
          <button class="feature-card feature-card-secondary feature-card-human" type="button" @click="router.push({ name: 'play-human' })">
            <span class="feature-title">双人对局</span>
          </button>
          <div class="feature-row">
            <button class="feature-card feature-card-secondary feature-card-active feature-card-research" type="button" @click="router.push({ name: 'research' })">
              <span class="feature-title">研究盘</span>
            </button>
            <button class="feature-card feature-card-secondary feature-card-active feature-card-library" type="button" @click="router.push({ name: 'library' })">
              <span class="feature-title">棋谱库</span>
            </button>
          </div>
        </div>
      </div>
      <div v-if="recentGame" class="recent-game" aria-label="最近对局">
        <div class="recent-game-copy"><span>最近对局</span><strong>人机对局 · {{ recentGame.strength }}</strong><small>{{ recentGame.updatedAt }}</small></div>
        <button class="recent-game-action" type="button" @click="startRecentGame">立即开始 <span aria-hidden="true">→</span></button>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="aiSetupVisible" class="setup-backdrop" @click.self="closeAiGameSetup">
        <section class="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <header class="setup-heading">
          <div>
            <h1 id="setup-title">人机对局</h1>
          </div>
          <button class="setup-close" type="button" aria-label="关闭" title="关闭" @click="closeAiGameSetup"><X :size="18" stroke-width="2" aria-hidden="true" /></button>
        </header>

        <div class="setup-scroll">
          <div class="setup-summary" aria-live="polite">
            <span><b>19 路棋盘</b></span>
            <span>{{ selectedRule.label }}</span>
            <span>{{ playerColorLabel }}</span>
            <span>{{ selectedHandicapLabel }}</span>
            <span>黑贴 {{ currentKomiLabel }}</span>
            <span>{{ timePresetLabel }}</span>
          </div>

          <div class="setup-layout">
            <div class="setup-main">
              <section class="setup-section">
                <div class="section-heading"><h2>执棋方式</h2><span>决定玩家与 KataGo 的颜色</span></div>
                <div class="select-field">
                  <span>对局方式</span>
                  <SetupDropdown :model-value="setup.playerColor" :options="playerColorOptions" ariaLabel="选择执棋方式" @update:model-value="setup.playerColor = $event as GameSetup['playerColor']" />
                </div>
              </section>

              <section class="setup-section">
                <div class="section-heading"><h2>规则预设</h2><span>贴目和计分方式会随预设变化</span></div>
                <div class="select-field">
                  <span>规则</span>
                  <SetupDropdown :model-value="setup.ruleSet" :options="ruleOptions" ariaLabel="选择规则" @update:model-value="setup.ruleSet = $event as GameSetup['ruleSet']" />
                </div>
              </section>

              <section class="setup-section">
                <div class="section-heading"><h2>让子方式</h2><span>让子由黑方让给白方，白方连续落子</span></div>
                <div class="select-field">
                  <span>让子</span>
                  <SetupDropdown :model-value="String(setup.handicap)" :options="handicapOptions" ariaLabel="选择让子方式" @update:model-value="selectHandicap" />
                </div>
                <div class="komi-result"><span>本局黑贴</span><strong>{{ currentKomiLabel }}</strong><small>{{ setup.handicap === 0 ? '分先的规则贴目' : '让子后的规则贴目' }}</small></div>
              </section>

              <section class="setup-section">
                <div class="section-heading"><h2>用时</h2><span>只限制玩家，AI 思考不计入玩家用时</span></div>
                <div class="select-field">
                  <span>计时方案</span>
                  <SetupDropdown :model-value="setup.timeControl.preset" :options="timeOptions" ariaLabel="选择用时方案" @update:model-value="selectTimePresetValue" />
                </div>
                <div v-if="setup.timeControl.preset === 'custom'" class="custom-time-grid">
                  <div class="custom-time-field"><span>主时间</span><SetupDropdown :model-value="String(setup.timeControl.mainTimeSeconds)" :options="customMainTimeOptions" ariaLabel="选择主时间" @update:model-value="selectCustomMainTime" /></div>
                  <div class="custom-time-field"><span>读秒时间</span><SetupDropdown :model-value="String(setup.timeControl.byoYomiSeconds)" :options="customByoYomiOptions" ariaLabel="选择读秒时间" @update:model-value="selectCustomByoYomi" /></div>
                  <div class="custom-time-field"><span>读秒次数</span><SetupDropdown :model-value="String(setup.timeControl.byoYomiPeriods)" :options="customPeriodOptions" ariaLabel="选择读秒次数" @update:model-value="selectCustomPeriods" /></div>
                </div>
              </section>
            </div>

            <aside class="rank-panel">
              <div class="section-heading"><h2>AI 段位</h2><span>Human SL 人类棋力</span></div>
              <div class="rank-selected"><span>本局选择</span><strong>{{ AI_STRENGTHS[setup.aiStrength].label }}</strong></div>
              <div class="select-field rank-select-field">
                <span>选择段位</span>
                <SetupDropdown :model-value="setup.aiStrength" :options="rankOptions" ariaLabel="选择 AI 段位" @update:model-value="selectAiStrength" />
              </div>
              <p class="rank-description">{{ AI_STRENGTHS[setup.aiStrength].description }}</p>
            </aside>
          </div>
        </div>

        <footer class="setup-actions">
          <button class="setup-secondary" type="button" @click="closeAiGameSetup">取消</button>
          <button class="setup-primary" type="button" @click="startAiGame">开始对局</button>
        </footer>
      </section>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.home-page {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  isolation: isolate;
  background: transparent;
}
.home-page::before {
  display: none;
}
.home-main {
  display: grid;
  align-content: center;
  width: min(1280px, calc(100% - 64px));
  min-height: 100%;
  margin: 0 auto;
  padding: 40px 0 56px;
  gap: 24px;
}
.home-motto {
  display: flex;
  min-height: 24px;
  align-items: center;
  margin: 0;
  color: #605e5c;
  font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
  font-size: 16px;
  line-height: 1.5;
}
.home-motto i {
  display: inline-block;
  width: 2px;
  height: 18px;
  margin-left: 5px;
  background: #0078d4;
  opacity: .85;
}
.home-motto span { min-width: 1ch; }
.recent-game {
  display: flex;
  min-height: 68px;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 14px 18px;
  border: 1px solid rgba(225, 225, 225, .9);
  border-radius: 8px;
  color: #323130;
  background: rgba(255, 255, 255, .4);
  box-shadow: 0 1.6px 3.6px rgba(0, 0, 0, .13), 0 .3px .9px rgba(0, 0, 0, .1);
  backdrop-filter: blur(20px);
}
.recent-game-copy { display: flex; min-width: 0; align-items: baseline; gap: 14px; }
.recent-game-copy > span { color: #605e5c; font-size: 12px; font-weight: 600; }
.recent-game-copy strong { overflow: hidden; font-size: 14px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.recent-game-copy small { color: #a19f9d; font-size: 12px; white-space: nowrap; }
.recent-game-action {
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #0078d4;
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  transition: background-color 150ms ease-out, color 150ms ease-out, transform 150ms ease-out;
}
.recent-game-action:hover { background: #deecf9; color: #106ebe; }
.recent-game-action:active { transform: scale(.97); }
.recent-game-action:focus-visible { outline: 2px solid #0078d4; outline-offset: 2px; }
.recent-game-action span { font-size: 16px; line-height: 1; }
.home-workspace {
  display: grid;
  grid-template-columns: minmax(0, 57fr) minmax(0, 43fr);
  gap: 14px;
  width: 100%;
  height: clamp(430px, 50vh, 460px);
}
.feature-stack {
  display: grid;
  grid-template-rows: repeat(3, minmax(0, 1fr));
  min-width: 0;
  gap: 14px;
}
.feature-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  min-height: 0;
  gap: 14px;
}
.feature-card {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-end;
  min-width: 0;
  min-height: 0;
  padding: 24px;
  overflow: hidden;
  border: 1px solid rgba(225, 225, 225, .9);
  border-radius: 8px;
  background: rgba(255, 255, 255, .4);
  color: #323130;
  font: inherit;
  text-align: left;
  box-shadow: 0 1.6px 3.6px rgba(0, 0, 0, .13), 0 .3px .9px rgba(0, 0, 0, .1);
  backdrop-filter: blur(20px);
  transition: transform 200ms ease-out, box-shadow 200ms ease-out, border-color 200ms ease-out, background-color 200ms ease-out;
}
.feature-card::before {
  position: absolute;
  z-index: -2;
  inset: 0;
  content: '';
  background: transparent;
  opacity: .58;
  -webkit-mask-image: linear-gradient(to bottom left, #000 0%, #000 5%, transparent 76%);
  mask-image: linear-gradient(to bottom left, #000 0%, #000 5%, transparent 76%);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
  transition: opacity 200ms ease-out, transform 200ms ease-out;
}
.feature-card::after {
  position: absolute;
  z-index: -1;
  inset: 0;
  content: '';
  background-position: var(--card-position, center);
  background-size: var(--card-size, cover);
  background-repeat: no-repeat;
  filter: saturate(.8) brightness(1.03);
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease-out;
}
.feature-card-ai,
.feature-card-lan,
.feature-card-human,
.feature-card-research,
.feature-card-library { --card-image: none; }
.feature-card-ai { --card-image: url('/card-backgrounds/ai-game.png'); --card-position: center 72%; }
.feature-card-lan { --card-image: url('/card-backgrounds/lan-game.png'); --card-position: center 58%; }
.feature-card-human { --card-image: url('/card-backgrounds/ai-game.png'); --card-position: 20% 86%; --card-size: 150% auto; }
.feature-card-research { --card-image: url('/card-backgrounds/research-board.png'); --card-position: center 68%; }
.feature-card-library { --card-image: url('/card-backgrounds/library.png'); --card-position: center 58%; }
.feature-card-ai::before,
.feature-card-lan::before,
.feature-card-human::before,
.feature-card-research::before,
.feature-card-library::before {
  background-image: var(--card-image);
  background-position: var(--card-position, center);
  background-size: var(--card-size, cover);
  background-repeat: no-repeat;
  filter: saturate(.8) brightness(1.03);
}
.feature-card-ai::after,
.feature-card-lan::after,
.feature-card-human::after,
.feature-card-research::after,
.feature-card-library::after {
  background-image: linear-gradient(rgba(255, 255, 255, .22), rgba(255, 255, 255, .22)), var(--card-image);
}
.feature-card-ai:hover::before,
.feature-card-lan:hover::before,
.feature-card-human:hover::before,
.feature-card-research:hover::before,
.feature-card-library:hover::before {
  opacity: .82;
}
.feature-card-ai:hover::after,
.feature-card-lan:hover::after,
.feature-card-human:hover::after,
.feature-card-research:hover::after,
.feature-card-library:hover::after { opacity: 1; }
.feature-card:hover {
  border-color: rgba(255, 255, 255, .8);
  background: rgba(255, 255, 255, .72);
  box-shadow: 0 6.4px 14.4px rgba(0, 0, 0, .18), 0 1.2px 3.6px rgba(0, 0, 0, .14);
}
.feature-card:active { background: rgba(255, 255, 255, .4); box-shadow: none; transform: scale(.97); }
.feature-card:focus-visible { outline: 2px solid #0078d4; outline-offset: 2px; box-shadow: 0 0 0 4px rgba(255, 255, 255, .4), 0 0 0 6px #0078d4; }
.feature-title {
  max-width: 100%;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.feature-card-primary { padding: 32px; }
.feature-card-primary .feature-title { font-size: 28px; }

.setup-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 22px; background: rgba(50,49,48,.34); }
.setup-dialog { display: flex; width: min(960px, calc(100vw - 44px)); height: min(820px, calc(100dvh - 44px)); min-height: 0; flex-direction: column; overflow: hidden; border: 1px solid rgba(225,225,225,.9); border-radius: 8px; background: rgba(255,255,255,.4); box-shadow: 0 6.4px 14.4px rgba(0,0,0,.13), 0 1.2px 3.6px rgba(0,0,0,.1); backdrop-filter: blur(20px); }
.setup-heading { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 20px; margin: 0; padding: 24px 24px 0; }.setup-heading h1 { margin: 0; color: var(--text); font-size: 24px; }
.setup-close { display: grid; width: 36px; height: 36px; padding: 0; place-items: center; border: 1px solid transparent; border-radius: 6px; color: #323130; background: transparent; transition: border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out; }.setup-close:hover { color: #0078d4; border-color: rgba(255,255,255,.6); background: rgba(255,255,255,.72); box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.1); }.setup-close:active { transform: scale(.97); box-shadow: none; }.setup-close:focus-visible { outline: 2px solid #0078d4; outline-offset: 2px; box-shadow: 0 0 0 4px rgba(255,255,255,.4), 0 0 0 6px #0078d4; }
.setup-scroll { min-height: 0; flex: 1 1 auto; overflow-y: auto; padding: 18px 24px 24px; }
.setup-summary { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-bottom: 20px; padding: 11px 14px; border: 1px solid rgba(225,225,225,.9); border-radius: 8px; color: var(--muted); background: rgba(255,255,255,.4); font-size: 12px; }.setup-summary b { color: var(--text); }
.setup-layout { display: grid; grid-template-columns: minmax(0, 1fr) 270px; gap: 28px; flex: 1 1 auto; }.setup-main { min-width: 0; }.setup-section { padding: 0 0 16px; margin-bottom: 16px; border-bottom: 1px solid rgba(225,225,225,.72); }.section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; margin-bottom: 9px; }.section-heading h2 { margin: 0; color: var(--text); font-size: 15px; }.section-heading span { color: var(--muted); font-size: 11px; }
.select-field { display: grid; grid-template-columns: 82px minmax(0, 1fr); align-items: center; gap: 12px; color: var(--muted); font-size: 12px; }.select-field > span { color: var(--text); font-weight: 600; }.rank-select-field { grid-template-columns: 1fr; gap: 7px; }.rank-select-field > span { color: var(--muted); font-size: 11px; }.rank-description { margin: 10px 0 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
.choice-grid { display: grid; gap: 8px; }.three-columns { grid-template-columns: repeat(3, minmax(0, 1fr)); }.choice-button, .time-button, .handicap-button, .rank-button { display: grid; min-height: 62px; align-content: center; gap: 4px; padding: 10px 12px; border: 1px solid transparent; border-radius: 6px; color: #323130; background: rgba(255,255,255,.4); box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.1); font: inherit; text-align: left; cursor: pointer; transition: border-color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out; }.choice-button:hover, .time-button:hover, .handicap-button:hover, .rank-button:hover { border-color: rgba(255,255,255,.6); color: #0078d4; background: rgba(255,255,255,.72); box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.1); }.choice-button.selected, .time-button.selected, .handicap-button.selected, .rank-button.selected { border-color: rgba(255,255,255,.6); color: #0078d4; background: rgba(255,255,255,.72); box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.1); }.choice-button strong, .time-button strong { font-size: 13px; }.choice-button small, .time-button small { color: #605e5c; font-size: 11px; }.choice-button:active, .time-button:active, .handicap-button:active, .rank-button:active { transform: scale(.97); box-shadow: none; }.choice-button:focus-visible, .time-button:focus-visible, .handicap-button:focus-visible, .rank-button:focus-visible { outline: 2px solid #0078d4; outline-offset: 2px; box-shadow: 0 0 0 4px rgba(255,255,255,.4), 0 0 0 6px #0078d4; }
.handicap-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }.handicap-button { min-height: 40px; padding: 0 8px; font-size: 12px; }.komi-result { display: flex; align-items: baseline; gap: 10px; margin-top: 12px; color: #605e5c; font-size: 12px; }.komi-result strong { color: #0078d4; font-size: 16px; }.komi-result small { font-size: 11px; }
.time-preset-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }.custom-time-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }.custom-time-field { display: grid; gap: 5px; min-width: 0; }.custom-time-field > span { color: var(--muted); font-size: 11px; }
.rank-panel { align-self: start; padding-left: 22px; border-left: 1px solid rgba(225,225,225,.72); }.rank-selected { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid rgba(225,225,225,.72); color: var(--muted); font-size: 11px; }.rank-selected strong { color: var(--accent); font-size: 20px; }
.setup-actions { display: flex; flex: 0 0 auto; justify-content: flex-end; gap: 8px; padding: 18px 24px 24px; border-top: 1px solid rgba(225,225,225,.9); background: rgba(255,255,255,.18); }.setup-secondary, .setup-primary { min-height: 40px; padding: 0 18px; border-radius: 6px; font: inherit; font-size: 13px; font-weight: 600; transition: transform 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out; }.setup-secondary { border: 1px solid transparent; color: #323130; background: transparent; }.setup-primary { border: 1px solid #0078d4; color: #fff; background: #0078d4; box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.1); }.setup-secondary:hover { border-color: rgba(255,255,255,.6); color: #0078d4; background: rgba(255,255,255,.72); box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px  .9px rgba(0,0,0,.1); }.setup-primary:hover { background: #106ebe; box-shadow: 0 3.2px 7.2px rgba(0,0,0,.13), 0 .6px 1.8px rgba(0,0,0,.1); }.setup-secondary:active, .setup-primary:active { transform: scale(.97); box-shadow: none; }.setup-primary:active { background: #005a9e; }.setup-secondary:focus-visible, .setup-primary:focus-visible { outline: 2px solid #0078d4; outline-offset: 2px; box-shadow: 0 0 0 4px rgba(255,255,255,.4), 0 0 0 6px #0078d4; }

@media (max-width: 1024px) {
  .home-main { width: calc(100% - 48px); }
  .home-workspace { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .feature-card { padding: 20px; }
  .feature-card-primary { padding: 28px; }
}
@media (max-height: 700px) and (min-width: 761px) {
  .home-main { padding: 28px 0 48px; }
  .home-workspace { height: 390px; }
}
@media (max-width: 920px) {
  .setup-layout { grid-template-columns: 1fr; }
  .rank-panel { padding: 18px 0 0; border-top: 1px solid #edf0ef; border-left: 0; }
}
@media (max-width: 760px) {
  .home-main { width: min(620px, calc(100% - 32px)); padding: 24px 0 40px; align-items: flex-start; }
  .home-workspace { height: auto; grid-template-columns: 1fr; grid-template-rows: 300px 410px; }
  .feature-card { padding: 24px; }
  .feature-card-primary { padding: 28px; }
  .recent-game-copy { gap: 8px; }
  .recent-game-copy small { display: none; }
}
@media (max-width: 680px) {
  .setup-backdrop { padding: 12px; }
  .setup-dialog { width: 100%; height: calc(100dvh - 24px); }
  .setup-heading { padding: 18px 18px 0; }
  .setup-scroll { padding: 18px 18px 20px; }
  .setup-actions { padding: 18px; }
  .setup-heading h1 { font-size: 20px; }
  .select-field { grid-template-columns: 70px minmax(0, 1fr); gap: 8px; }
  .rank-select-field { grid-template-columns: 1fr; }
  .custom-time-grid { grid-template-columns: 1fr; }
}
@media (max-height: 620px) {
  .setup-heading { padding-top: 14px; }
  .setup-scroll { padding-top: 12px; padding-bottom: 14px; }
  .setup-actions { padding-top: 12px; padding-bottom: 14px; }
}
@media (max-width: 440px) {
  .home-workspace { gap: 12px; grid-template-rows: 280px 396px; }
  .feature-stack, .feature-row { gap: 12px; }
  .feature-card { padding: 20px; }
  .feature-card-primary { padding: 24px; }
  .recent-game { padding-inline: 12px; }
  .recent-game-copy > span { display: none; }
  .recent-game-copy strong { font-size: 12px; }
  .recent-game-action { padding-inline: 8px; font-size: 12px; }
  .setup-summary { gap: 7px 12px; }
  .handicap-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce) {
  .feature-card, .feature-card::before, .recent-game-action { transition: none; }
}
</style>
