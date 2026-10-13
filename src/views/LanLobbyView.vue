<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { CircleAlert, Copy, Network, RefreshCw, Users, X } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import GameSetupMain from '../components/ui/GameSetupMain.vue'
import GameSetupFooter from '../components/ui/GameSetupFooter.vue'
import type { SetupDropdownOption } from '../components/ui/SetupDropdown.vue'
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
  type GameSetup,
  type Handicap,
  type TimePresetId,
} from '../domain/gameSetup'
import { useLanStore } from '../stores/lan'
import { getLocalAddresses, type LanDiscoveredRoom, type LanRoomConfig } from '../services/lan'

const router = useRouter()
const emit = defineEmits<{ (event: 'close'): void }>()
const lan = useLanStore()
const setup = reactive<GameSetup>(loadGameSetup('rank_10k'))
const mode = ref<'create' | 'join'>('create')
const host = ref('')
const port = ref('19888')
const createPassword = ref('')
const joinPassword = ref('')
const localAddresses = ref<string[]>([])
const rooms = ref<LanDiscoveredRoom[]>([])
const selectedRoom = ref<LanDiscoveredRoom | null>(null)
const scanning = ref(false)
const busy = ref(false)
const pageError = ref('')
const copied = ref(false)
const closeButton = ref<HTMLButtonElement | null>(null)

const ruleOptions: SetupDropdownOption[] = Object.entries(RULE_PRESETS).map(([value, preset]) => ({
  value,
  label: preset.label,
  description: `${preset.scoring} · ${value === 'chinese' ? '中国通行规则' : value === 'japanese-korean' ? '日韩通行规则' : '美国围棋协会规则'}`,
}))
const hostColorOptions: SetupDropdownOption[] = [
  { value: 'black', label: '主机执黑', description: '主机先手，加入者执白' },
  { value: 'white', label: '主机执白', description: '加入者执黑，主机后手' },
]
const handicapOptions: SetupDropdownOption[] = HANDICAP_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))
const timeOptions: SetupDropdownOption[] = [
  { value: 'blitz', label: '快棋', description: '1 分钟 · 15 秒 × 3' },
  { value: 'standard', label: '普通', description: '10 分钟 · 30 秒 × 3' },
  { value: 'slow', label: '慢棋', description: '30 分钟 · 40 秒 × 3' },
  { value: 'custom', label: '自定义', description: '自行设置主时间和读秒' },
  { value: 'untimed', label: '不计时', description: '不显示倒计时' },
]
const customMainTimeOptions: SetupDropdownOption[] = CUSTOM_MAIN_TIME_OPTIONS.map((value) => ({
  value: String(value),
  label: value === 0 ? '0 分钟' : `${value / 60} 分钟`,
}))
const customByoYomiOptions: SetupDropdownOption[] = CUSTOM_BYO_YOMI_OPTIONS.map((value) => ({ value: String(value), label: `${value} 秒` }))
const customPeriodOptions: SetupDropdownOption[] = CUSTOM_PERIOD_OPTIONS.map((value) => ({ value: String(value), label: `${value} 次` }))
const komiLabel = computed(() => `${formatKomi(komiFor(setup.ruleSet, setup.handicap))}${komiUnitFor(setup.ruleSet)}`)
const localAddressLabel = computed(() => localAddresses.value.filter((value) => value !== '127.0.0.1').join('、') || '未检测到局域网地址')
const isHostRoom = computed(() => lan.room?.role === 'host')
const roomSummary = computed(() => {
  if (!lan.room) return ''
  const auth = lan.room.passwordMode === 'none' ? '无需密码' : '需要密码'
  return `${lan.room.addresses.join(' / ')}:${lan.room.port} · ${auth}`
})
const selectedRoomStatus = computed(() => {
  if (!selectedRoom.value) return ''
  if (selectedRoom.value.reconnectable) return '等待原玩家重连'
  if (selectedRoom.value.status === 'playing') return '对局进行中'
  if (selectedRoom.value.status === 'ready') return '双方已连接'
  return '等待加入'
})
const selectedRoomUnavailable = computed(() => {
  if (!selectedRoom.value) return false
  return selectedRoom.value.status === 'ready'
    || (selectedRoom.value.status === 'playing' && !selectedRoom.value.reconnectable)
})
const resumeCandidate = computed(() => {
  const saved = lan.resumeRoom
  return saved ? rooms.value.find((room) => room.sessionId === saved.sessionId) ?? null : null
})
const connectionLabel = computed(() => {
  if (lan.error || pageError.value) return '连接异常'
  if (lan.status === 'connecting') return '正在连接'
  if (lan.connected) return '网络已连接'
  if (lan.status === 'reconnecting' || lan.status === 'closed') return '连接已断开'
  return isHostRoom.value ? '等待玩家加入' : '等待连接'
})

function selectTimePreset(preset: TimePresetId) {
  setup.timeControl = preset === 'custom'
    ? { preset: 'custom', mainTimeSeconds: 600, byoYomiSeconds: 30, byoYomiPeriods: 3 }
    : { ...TIME_PRESETS[preset] }
}

function selectHandicap(value: string) {
  const numeric = Number(value)
  if (HANDICAP_OPTIONS.some((option) => option.value === numeric)) setup.handicap = numeric as Handicap
}

function selectTime(value: string) {
  if (['blitz', 'standard', 'slow', 'custom', 'untimed'].includes(value)) selectTimePreset(value as TimePresetId)
}

function config(): LanRoomConfig {
  return {
    boardSize: 19,
    ruleSet: setup.ruleSet,
    hostColor: setup.playerColor === 'white' ? 'white' : 'black',
    handicap: setup.handicap,
    komi: komiFor(setup.ruleSet, setup.handicap),
    komiUnit: komiUnitFor(setup.ruleSet),
    timeControl: setup.timeControl,
  }
}

async function createRoom() {
  const resolvedPassword = createPassword.value.trim()
  if (resolvedPassword && !/^\S{4,32}$/.test(resolvedPassword)) {
    pageError.value = '房间密码为空时无需密码，否则必须为 4 到 32 个不含空格的字符'
    return
  }
  busy.value = true
  pageError.value = ''
  try {
    await lan.create(config(), resolvedPassword)
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

async function joinRoom() {
  busy.value = true
  pageError.value = ''
  try {
    await lan.join(
      host.value.trim(),
      Number(port.value),
      joinPassword.value.trim(),
      selectedRoom.value?.sessionId,
    )
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

async function scan() {
  if (scanning.value) return
  scanning.value = true
  pageError.value = ''
  try {
    rooms.value = await lan.refreshRooms()
    if (!selectedRoom.value && resumeCandidate.value) chooseRoom(resumeCandidate.value)
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : String(error)
  } finally {
    scanning.value = false
  }
}

function chooseRoom(room: LanDiscoveredRoom) {
  selectedRoom.value = room
  host.value = room.host
  port.value = String(room.port)
  joinPassword.value = ''
  pageError.value = ''
}

async function resumeSavedRoom() {
  if (!resumeCandidate.value) {
    pageError.value = '未发现上次对局的主机，请确认主机程序仍在运行'
    return
  }
  chooseRoom(resumeCandidate.value)
  await joinRoom()
}

async function reconnectRoom() {
  busy.value = true
  pageError.value = ''
  try {
    await lan.reconnect()
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

async function startGame() {
  busy.value = true
  pageError.value = ''
  try {
    await lan.startGame()
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

async function leave() {
  await lan.leave()
}

function handleModalKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}

async function copyRoomInfo() {
  if (!roomSummary.value) return
  await navigator.clipboard?.writeText(roomSummary.value)
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 1400)
}

watch(() => lan.status, (status) => {
  if (status === 'playing') router.push({ name: 'play-lan' })
})

onMounted(async () => {
  window.addEventListener('keydown', handleModalKeydown)
  closeButton.value?.focus()
  await lan.initialize()
  try { localAddresses.value = await getLocalAddresses() } catch { localAddresses.value = [] }
  await scan()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleModalKeydown)
  // The room intentionally survives this view while navigating to the board.
})
</script>

<template>
  <Teleport to="body">
    <div class="lan-backdrop" @click.self="emit('close')">
      <section class="lan-dialog" role="dialog" aria-modal="true" aria-labelledby="lan-dialog-title">
        <header class="lan-dialog-heading">
          <h1 id="lan-dialog-title">局域网对局</h1>
          <div class="connection-chip" :class="{ active: lan.connected, error: Boolean(lan.error || pageError) }" role="status" aria-live="polite"><span class="status-dot" aria-hidden="true" />{{ connectionLabel }}</div>
          <button ref="closeButton" class="lan-dialog-close" type="button" aria-label="关闭局域网对局" title="关闭" @click="emit('close')"><X :size="18" aria-hidden="true" /></button>
        </header>

      <div class="lan-page">
      <section v-if="!lan.room" class="lan-content">
      <div class="mode-tabs" role="tablist">
        <button type="button" role="tab" :aria-selected="mode === 'create'" :class="{ selected: mode === 'create' }" @click="mode = 'create'"><Network :size="16" aria-hidden="true" />创建房间</button>
        <button type="button" role="tab" :aria-selected="mode === 'join'" :class="{ selected: mode === 'join' }" @click="mode = 'join'"><Users :size="16" aria-hidden="true" />加入房间</button>
      </div>

      <div v-if="mode === 'create'" class="setup-layout">
        <GameSetupMain
          :setup="setup"
          :player-color-options="hostColorOptions"
          player-color-label="主机执棋"
          player-color-aria-label="选择主机执棋颜色"
          :rule-options="ruleOptions"
          :handicap-options="handicapOptions"
          :time-options="timeOptions"
          :custom-main-time-options="customMainTimeOptions"
          :custom-byo-yomi-options="customByoYomiOptions"
          :custom-period-options="customPeriodOptions"
          :komi-label="komiLabel"
          show-password
          :password="createPassword"
          @update:player-color="setup.playerColor = $event"
          @update:rule-set="setup.ruleSet = $event"
          @update:handicap="selectHandicap"
          @update:time-preset="selectTime"
          @update:main-time-seconds="setup.timeControl.mainTimeSeconds = Number($event)"
          @update:byo-yomi-seconds="setup.timeControl.byoYomiSeconds = Number($event)"
          @update:byo-yomi-periods="setup.timeControl.byoYomiPeriods = Number($event)"
          @update:password="createPassword = $event"
        />
        <aside class="network-panel"><span class="eyebrow">本机地址</span><strong>{{ localAddressLabel }}</strong><p>同一网络中的其他玩家可以在“加入房间”中自动发现此房间，也可以使用地址和端口手动加入。</p><div class="network-note">默认端口 19888，端口占用时会自动顺延。</div></aside>
      </div>

      <div v-else class="setup-layout join-layout">
        <section class="setup-panel join-panel">
          <div class="panel-heading"><div><span class="eyebrow">加入房间</span><h2>选择当前局域网房间</h2></div><button class="refresh-button" type="button" :disabled="scanning" title="刷新房间列表" aria-label="刷新房间列表" @click="scan"><RefreshCw :size="17" :class="{ spin: scanning }" /></button></div>
        <div v-if="resumeCandidate" class="resume-banner">
          <div><span>未完成的对局</span><strong>{{ resumeCandidate.host }}:{{ resumeCandidate.port }}</strong><small>{{ resumeCandidate.reconnectable ? '原玩家可以继续当前对局' : '房间已回到等待下一局' }}</small></div>
          <button class="resume-button" type="button" :disabled="busy || (resumeCandidate.passwordRequired && !joinPassword)" @click="resumeSavedRoom">{{ resumeCandidate.reconnectable ? '返回对局' : '进入房间' }}</button>
        </div>
        <div v-if="rooms.length" class="room-list">
          <button v-for="room in rooms" :key="room.sessionId" class="room-card" :class="{ selected: selectedRoom?.sessionId === room.sessionId }" type="button" @click="chooseRoom(room)">
            <span class="room-card-main"><strong>{{ room.host }}:{{ room.port }}</strong><small>{{ RULE_PRESETS[room.config.ruleSet].label }} · 黑贴 {{ formatKomi(room.config.komi) }}{{ room.config.komiUnit }} · {{ room.config.timeControl.preset === 'untimed' ? '不计时' : '计时对局' }}</small></span>
            <span class="room-card-status"><span class="room-status-dot" :class="room.status" />{{ room.reconnectable ? '等待原玩家重连' : room.status === 'playing' ? '对局进行中' : room.status === 'ready' ? '双方已连接' : '等待加入' }}<em v-if="room.passwordRequired">需要密码</em></span>
          </button>
        </div>
        <div v-else class="empty-rooms"><Users :size="20" /><span>暂未发现局域网房间</span><small>请确认主机程序正在运行，并点击右上角刷新。</small></div>
        <p v-if="selectedRoom" class="selected-room-note">已选择 {{ selectedRoom.host }}:{{ selectedRoom.port }} · {{ selectedRoomStatus }}</p>
        <div class="join-fields"><label>主机 IP<input v-model="host" placeholder="例如 192.168.1.10" autocomplete="off" /></label><label>端口<input v-model="port" inputmode="numeric" placeholder="19888" /></label><label>房间密码<input v-model="joinPassword" maxlength="32" placeholder="无需密码时留空" autocomplete="off" /></label></div>
        <p class="hint">正在进行的对局只允许原玩家使用重连凭证恢复，其他玩家需要等待下一局。</p>
        </section>
        <aside class="network-panel join-network-panel"><span class="eyebrow">加入方式</span><strong>{{ selectedRoom ? selectedRoomStatus : '自动发现房间' }}</strong><p>同一局域网中的房间会自动显示在左侧列表。选择房间后输入密码即可加入。</p><div class="network-note">进行中的对局只允许原玩家使用重连凭证恢复，其他玩家需要等待下一局。</div></aside>
      </div>
    </section>

    <section v-else class="room-panel">
      <div class="room-top"><div><span class="eyebrow">房间已创建</span><h2>{{ isHostRoom ? '等待玩家二加入' : '已加入房间' }}</h2></div></div>
      <div class="room-info-grid"><div><span>连接地址</span><strong>{{ lan.room?.addresses.join(' / ') }}:{{ lan.room?.port }}</strong></div><div><span>房间密码</span><strong>{{ lan.room?.passwordMode === 'none' ? '无需密码' : '需要密码' }} <button class="copy-button" type="button" title="复制房间信息" aria-label="复制房间信息" @click="copyRoomInfo"><Copy :size="15" /></button></strong></div><div><span>规则</span><strong>{{ RULE_PRESETS[lan.room?.config.ruleSet ?? 'chinese'].label }} · 黑贴 {{ formatKomi(lan.room?.config.komi ?? 0) }}{{ lan.room?.config.komiUnit }}</strong></div><div><span>状态</span><strong>{{ lan.room?.started ? (lan.connected ? '对局进行中' : `等待原玩家重连${lan.reconnectRemaining === null ? '' : `（${lan.reconnectRemaining} 秒）`}`) : lan.room?.clientConnected ? '双方已连接' : '等待加入' }}</strong></div></div>
      <p v-if="copied" class="success-note">房间信息已复制</p>
      <p v-if="lan.error || pageError" class="error-note" role="alert"><CircleAlert :size="16" aria-hidden="true" />{{ lan.error || pageError }}</p>
    </section>

    <p v-if="(pageError || lan.error) && !lan.room" class="error-note page-error" role="alert"><CircleAlert :size="16" aria-hidden="true" />{{ pageError || lan.error }}</p>
      </div>
      <GameSetupFooter
        v-if="!lan.room"
        :primary-label="mode === 'create' ? '创建房间' : selectedRoom?.reconnectable ? '重新加入对局' : '加入房间'"
        :primary-disabled="mode === 'join' && (!host || !port || selectedRoomUnavailable)"
        :busy="busy"
        :busy-label="mode === 'create' ? '创建中...' : '加入中...'"
        @secondary="emit('close')"
        @primary="mode === 'create' ? createRoom() : joinRoom()"
      />
      <GameSetupFooter
        v-else-if="isHostRoom"
        secondary-label="退出房间"
        :primary-label="lan.room?.started ? '对局进行中' : '开始对局'"
        :primary-disabled="!lan.room?.clientConnected"
        :busy="busy"
        busy-label="启动中..."
        @secondary="leave"
        @primary="startGame"
      />
      <GameSetupFooter
        v-else-if="lan.status === 'reconnecting'"
        secondary-label="退出房间"
        primary-label="重新加入对局"
        :busy="busy"
        busy-label="重连中..."
        @secondary="leave"
        @primary="reconnectRoom"
      />
      <GameSetupFooter
        v-else
        secondary-label="退出房间"
        status="等待主机开始对局"
        @secondary="leave"
      />
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.lan-page { min-height: 0; flex: 1; overflow: auto; padding: 34px clamp(20px, 4vw, 64px) 48px; background: #f6f7f7; color: var(--text); }
.lan-header { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 16px; width: min(1120px, 100%); margin: 0 auto 28px; }
.back-button, .secondary-button, .copy-button { display: grid; place-items: center; border: 1px solid var(--border); border-radius: 7px; color: var(--text); background: #fff; }
.back-button { width: 36px; height: 36px; }
.lan-title { display: flex; min-height: 36px; align-items: center; }
.lan-title h1 { transform: translateY(1px); }
.eyebrow { color: var(--muted); font-size: 11px; letter-spacing: .08em; }
h1, h2, p { margin: 0; } h1 { font-size: 25px; line-height: 1.2; } h2 { margin-top: 4px; font-size: 20px; }
.connection-chip { display: inline-flex; align-items: center; gap: 8px; padding: 8px 11px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); background: #fff; font-size: 12px; }
.connection-chip.active { color: var(--accent); border-color: rgba(var(--accent-rgb), .28); }.status-dot { width: 7px; height: 7px; border-radius: 50%; background: #aeb5b6; }.active .status-dot { background: var(--accent); }
.connection-chip.error { color: var(--danger); border-color: rgba(180, 81, 69, .28); background: var(--danger-soft); }.connection-chip.error .status-dot { background: var(--danger); }
.lan-content, .room-panel { width: min(1120px, 100%); margin: 0 auto; }.mode-tabs { display: inline-flex; gap: 4px; padding: 4px; margin-bottom: 14px; border: 1px solid var(--border); border-radius: 9px; background: #fff; }.mode-tabs button { display: inline-flex; align-items: center; gap: 7px; padding: 9px 13px; border: 0; border-radius: 6px; color: var(--muted); background: transparent; font: inherit; font-size: 13px; }.mode-tabs button.selected { color: var(--text); background: #eef3f0; box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb), .13); }
.setup-layout { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 28px; padding: 22px; border: 1px solid var(--border); border-radius: 10px; background: #fff; }.setup-panel, .network-panel { border: 0; border-radius: 0; background: transparent; }.setup-panel { padding: 0; }.network-panel { align-self: stretch; padding: 0 0 0 28px; border-left: 1px solid var(--border); }.join-panel, .room-panel { border: 1px solid var(--border); border-radius: 10px; background: #fff; }.join-panel, .room-panel { padding: 22px; }.panel-heading, .room-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }.fixed-badge { padding: 6px 8px; border-radius: 6px; color: var(--accent); background: rgba(var(--accent-rgb), .08); font-size: 11px; }.summary-row { display: flex; flex-wrap: wrap; gap: 7px; margin: 18px 0; }.summary-row span { padding: 6px 8px; border-radius: 5px; color: var(--muted); background: #f5f7f7; font-size: 11px; }.field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }.field-grid label, .join-fields label, .custom-time-grid label, .password-field { display: grid; gap: 7px; color: var(--muted); font-size: 12px; }.custom-time-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 14px; }.custom-time-grid select, .join-fields input, .custom-password { width: 100%; min-height: 38px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px; color: var(--text); background: #fff; font: inherit; }.password-field { margin-top: 14px; }.hint, .network-panel p { margin-top: 18px; color: var(--muted); font-size: 12px; line-height: 1.7; }.primary-button, .secondary-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 0 14px; font: inherit; font-size: 13px; }.primary-button { margin-top: 20px; border: 1px solid var(--accent); border-radius: 7px; color: #fff; background: var(--accent); }.primary-button:disabled { opacity: .5; cursor: not-allowed; }.secondary-button { min-height: 34px; }.refresh-button { display: grid; width: 34px; height: 34px; place-items: center; border: 1px solid var(--border); border-radius: 7px; color: var(--text); background: #fff; }.refresh-button:disabled { cursor: wait; opacity: .5; }.network-panel strong { display: block; margin-top: 11px; color: var(--text); font-size: 15px; line-height: 1.5; word-break: break-all; }.network-note { margin-top: 22px; padding-top: 14px; border-top: 1px solid var(--border); color: var(--muted); font-size: 11px; line-height: 1.6; }.join-panel { width: min(820px, 100%); }.resume-banner { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 20px; padding: 13px 14px; border: 1px solid rgba(var(--accent-rgb), .24); border-radius: 7px; background: rgba(var(--accent-rgb), .05); }.resume-banner > div { display: grid; gap: 4px; min-width: 0; }.resume-banner span { color: var(--accent); font-size: 11px; font-weight: 700; }.resume-banner strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }.resume-banner small { color: var(--muted); font-size: 11px; }.resume-button { flex: 0 0 auto; min-height: 34px; padding: 0 12px; border: 1px solid var(--accent); border-radius: 6px; color: #fff; background: var(--accent); font: inherit; font-size: 12px; }.resume-button:disabled { cursor: not-allowed; opacity: .45; }.room-list { display: grid; gap: 8px; margin-top: 24px; }.room-card { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 16px; padding: 13px 14px; border: 1px solid var(--border); border-radius: 7px; color: var(--text); background: #fbfcfc; text-align: left; }.room-card:hover, .room-card.selected { border-color: var(--accent); background: rgba(var(--accent-rgb), .04); }.room-card-main { display: grid; min-width: 0; gap: 5px; }.room-card-main strong { font-size: 13px; }.room-card-main small { overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.room-card-status { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; color: var(--muted); font-size: 11px; }.room-card-status em { padding: 3px 5px; border-radius: 4px; color: #8a6323; background: #fbf3df; font-style: normal; }.room-status-dot { width: 7px; height: 7px; border-radius: 50%; background: #aeb5b6; }.room-status-dot.ready { background: var(--accent); }.room-status-dot.playing { background: #bd8736; }.room-status-dot.reconnecting { background: #bd8736; box-shadow: 0 0 0 3px rgba(189,135,54,.12); }.empty-rooms { display: grid; justify-items: center; gap: 7px; margin-top: 24px; padding: 28px 14px; border: 1px dashed var(--border); border-radius: 8px; color: var(--muted); }.empty-rooms small { font-size: 11px; }.selected-room-note { margin-top: 14px; color: var(--accent); font-size: 12px; }.join-fields { display: grid; grid-template-columns: 1.3fr .7fr 1fr; gap: 12px; margin-top: 24px; }.join-fields input { min-height: 42px; margin-top: 6px; }.room-panel { width: min(860px, 100%); }.room-info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 26px; }.room-info-grid > div { padding: 13px; border: 1px solid var(--border); border-radius: 7px; background: #fbfcfc; }.room-info-grid span { display: block; color: var(--muted); font-size: 11px; }.room-info-grid strong { display: flex; align-items: center; gap: 7px; margin-top: 7px; font-size: 13px; word-break: break-word; }.copy-button { width: 27px; height: 27px; }.room-actions { display: flex; align-items: center; justify-content: center; min-height: 100px; }.waiting-note { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; }.success-note { margin-top: 14px; color: var(--accent); font-size: 12px; }.error-note { margin-top: 14px; color: #b0443d; font-size: 12px; }.page-error { width: min(1120px, 100%); margin-right: auto; margin-left: auto; }.spin { animation: spin .9s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
.join-layout .join-panel { width: auto; padding: 0; border: 0; background: transparent; }
@media (max-width: 760px) { .lan-page { padding: 22px 14px 36px; }.lan-header { grid-template-columns: auto 1fr; }.connection-chip { grid-column: 2; justify-self: start; }.setup-layout { grid-template-columns: 1fr; gap: 22px; padding: 17px; }.network-panel { padding: 18px 0 0; border-top: 1px solid var(--border); border-left: 0; }.field-grid, .custom-time-grid, .join-fields, .room-info-grid { grid-template-columns: 1fr; }.join-panel, .room-panel { padding: 17px; }.resume-banner { align-items: stretch; flex-direction: column; }.resume-button { width: 100%; } }
</style>

<style scoped>
.lan-page { padding: 32px clamp(20px, 4vw, 64px) 48px; background: var(--shell); }
.lan-header { margin-bottom: 24px; }
.back-button, .secondary-button, .copy-button, .refresh-button { border-radius: 6px; background: var(--surface); transition: border-color 160ms ease, color 160ms ease, background 160ms ease; }
.back-button:hover, .secondary-button:hover, .copy-button:hover, .refresh-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent-strong); background: var(--accent-soft); }
.lan-title h1 { font-size: 24px; }
.connection-chip { border-radius: 6px; background: var(--surface); }
.mode-tabs { border-radius: 6px; background: var(--surface); }
.setup-layout, .join-panel, .room-panel { border-radius: 6px; background: var(--surface); box-shadow: none; }
.setup-layout { padding: 24px; }
.fixed-badge { border-radius: 5px; background: var(--accent-soft); }
.summary-row span { border-radius: 4px; background: var(--surface-muted); }
.primary-button { border-radius: 5px; background: var(--accent); }
.primary-button:hover:not(:disabled) { background: var(--accent-strong); }
.room-card, .room-info-grid > div { border-radius: 5px; background: var(--surface-muted); }
.room-card:hover, .room-card.selected { background: var(--accent-soft); }
.empty-rooms { border-radius: 6px; }
.error-note { color: var(--danger); }
@media (max-width: 760px) { .setup-layout { padding: 17px; } }

/* Keep the lobby compact like the shared game setup dialog. */
.lan-page {
  display: grid;
  grid-auto-rows: min-content;
  align-content: safe center;
  padding: 28px clamp(20px, 4vw, 64px) 36px;
  background: transparent;
}
.lan-header { width: min(960px, 100%); margin-bottom: 16px; }
.lan-title h1 { font-size: 22px; font-weight: 600; }
.back-button { border-radius: 4px; }
.connection-chip { border-radius: 4px; }
.mode-tabs { gap: 2px; padding: 3px; margin-bottom: 12px; border-radius: 5px; }
.mode-tabs button { min-height: 36px; border-radius: 3px; }
.mode-tabs button.selected { color: var(--accent-strong); background: var(--accent-soft); box-shadow: inset 0 -2px 0 var(--accent); }
.lan-content, .room-panel { width: min(960px, 100%); }
.setup-layout, .room-panel {
  border-color: rgba(255, 255, 255, .86);
  border-radius: 8px;
  background: rgba(255, 255, 255, .86);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}
.setup-layout { grid-template-columns: minmax(0, 1fr) 248px; gap: 24px; padding: 22px 24px; }
.panel-heading h2, .room-top h2 { font-size: 19px; font-weight: 600; }
.eyebrow { font-size: 11px; letter-spacing: 0; }
.fixed-badge { border-radius: 4px; }
.summary-row { gap: 6px; margin: 16px 0; }
.summary-row span { padding: 5px 8px; }
.field-grid { gap: 12px; }
.field-grid label, .join-fields label, .custom-time-grid label, .password-field { color: var(--text); font-size: 12px; font-weight: 600; }
.custom-time-grid select, .join-fields input, .custom-password { border-radius: 6px; }
.join-fields input:focus-visible, .custom-time-grid select:focus-visible, .custom-password:focus-visible { border: 2px solid var(--accent); outline: none; }
.hint, .network-panel p { font-size: 11px; }
.network-panel { padding-left: 24px; }
.network-panel strong { margin-top: 8px; font-size: 14px; }
.network-note { margin-top: 18px; }
.primary-button, .resume-button { min-height: 38px; border-radius: 4px; font-size: 12px; font-weight: 600; }
.setup-panel > .primary-button, .join-panel > .primary-button { display: flex; min-width: 124px; margin: 18px 0 0 auto; }
.primary-button { box-shadow: var(--shadow-xs); }
.primary-button:hover:not(:disabled) { box-shadow: var(--shadow-sm); }
.refresh-button, .secondary-button, .copy-button { border-radius: 4px; }
.room-card, .room-info-grid > div { border-radius: 4px; }
.room-card { background: var(--surface); }
.room-card:hover, .room-card.selected { border-color: var(--accent); background: var(--accent-soft); }
.room-info-grid > div { background: var(--surface); }
.empty-rooms { border-radius: 4px; }
.resume-banner { border-radius: 4px; }
.room-panel { width: min(960px, 100%); padding: 24px; }
.page-error { width: min(960px, 100%); padding: 10px 12px; border-left: 3px solid var(--danger); background: var(--danger-soft); }
.mode-tabs { align-items: center; }
.mode-tabs button {
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid transparent;
  color: var(--text);
  transition: color 140ms ease, background-color 140ms ease, border-color 140ms ease;
}
.mode-tabs button:hover:not(.selected) { background: var(--surface-muted); }
.mode-tabs button.selected { border-color: rgba(var(--accent-rgb), .16); }
.mode-tabs button:focus-visible { position: relative; z-index: 1; }
.fixed-badge, .summary-row span { display: inline-flex; min-height: 26px; align-items: center; border: 1px solid var(--border); }
.fixed-badge { border-color: rgba(var(--accent-rgb), .16); font-weight: 600; }
.summary-row span { background: rgba(237, 235, 233, .72); }
.field-grid label > span, .password-field > span, .join-fields label, .custom-time-grid label { line-height: 1.4; }
.lan-page :deep(.setup-dropdown-trigger) {
  min-height: 48px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: rgba(255, 255, 255, .78);
  box-shadow: var(--shadow-xs);
}
.lan-page :deep(.setup-dropdown-trigger:hover), .lan-page :deep(.setup-dropdown.open .setup-dropdown-trigger) {
  border-color: var(--accent);
  background: var(--surface);
}
.lan-page :deep(.setup-dropdown-menu) { border-radius: 6px; background: rgba(255, 255, 255, .94); }
.custom-time-grid select, .join-fields input, .custom-password {
  min-height: 42px;
  border-color: var(--border);
  border-radius: 6px;
  background: rgba(255, 255, 255, .72);
  transition: border-color 140ms ease, box-shadow 140ms ease, background-color 140ms ease;
}
.custom-time-grid select:hover, .join-fields input:hover, .custom-password:hover { border-color: #8a8886; }
.join-fields input:focus-visible, .custom-time-grid select:focus-visible, .custom-password:focus-visible {
  border: 2px solid var(--accent);
  outline: none;
  background: var(--surface);
}
.join-fields input::placeholder, .custom-password::placeholder { color: var(--text-subtle); }
.network-panel { color: var(--text); }
.network-note { color: var(--muted); }
.primary-button, .resume-button {
  min-height: 40px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  box-shadow: var(--shadow-xs);
  transition: background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
}
.primary-button:hover:not(:disabled), .resume-button:hover:not(:disabled) { border-color: var(--accent-strong); background: var(--accent-strong); box-shadow: var(--shadow-sm); }
.primary-button:active:not(:disabled), .resume-button:active:not(:disabled) { transform: scale(.98); box-shadow: none; }
.room-card { transition: border-color 140ms ease, background-color 140ms ease; }
.room-card-status { min-height: 28px; }
.room-info-grid > div { background: rgba(255, 255, 255, .72); }
.error-note { color: var(--danger); }
.page-error { display: flex; align-items: flex-start; gap: 9px; border: 1px solid rgba(232, 17, 35, .16); border-left: 3px solid var(--danger); border-radius: 4px; }
.page-error svg { flex: 0 0 auto; margin-top: 1px; }
.setup-layout, .room-panel { background: rgba(255, 255, 255, .72); }
.setup-layout { grid-template-columns: minmax(0, 1fr) 248px; gap: 28px; padding: 24px; }
.panel-heading { margin-bottom: 14px; }
.panel-heading h2 { margin-top: 3px; font-size: 21px; }
.summary-row {
  align-items: center;
  gap: 8px 18px;
  margin: 0 0 20px;
  padding: 11px 14px;
  border: 1px solid rgba(225, 225, 225, .9);
  border-radius: 6px;
  background: rgba(255, 255, 255, .4);
}
.summary-row span { min-height: 0; padding: 0; border: 0; color: var(--muted); background: transparent; font-size: 12px; }
.summary-row b { color: var(--text); font-weight: 600; }
.setup-sections { display: grid; }
.setup-section { padding: 0 0 14px; margin-bottom: 14px; border-bottom: 1px solid rgba(225, 225, 225, .78); }
.setup-section:last-child { margin-bottom: 0; }
.section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 9px; }
.section-heading h3 { margin: 0; color: var(--text); font-size: 15px; font-weight: 600; }
.section-heading > span { color: var(--muted); font-size: 11px; text-align: right; }
.select-field { display: grid; grid-template-columns: 82px minmax(0, 1fr); align-items: center; gap: 12px; color: var(--muted); font-size: 12px; }
.select-field > span { color: var(--text); font-weight: 600; }
.lan-page :deep(.setup-dropdown-trigger) { min-height: 52px; background: rgba(255, 255, 255, .48); }
.lan-page :deep(.setup-dropdown-trigger:hover), .lan-page :deep(.setup-dropdown.open .setup-dropdown-trigger) { background: rgba(255, 255, 255, .72); }
.komi-result { display: flex; align-items: baseline; gap: 10px; margin: 10px 0 0 94px; color: var(--muted); font-size: 12px; }
.komi-result strong { color: var(--accent); font-size: 16px; }
.komi-result small { font-size: 11px; }
.custom-time-grid { margin: 10px 0 0 94px; }
.custom-time-grid label { color: var(--muted); font-size: 11px; }
.password-row { margin-top: 2px; }
.hint { margin-top: 14px; }
@media (max-width: 760px) {
  .lan-page { align-content: start; padding: 20px 14px 28px; }
  .lan-header { margin-bottom: 18px; }
  .setup-layout { padding: 17px; }
  .network-panel { padding-left: 0; }
  .room-card { align-items: flex-start; flex-direction: column; gap: 8px; }
  .mode-tabs { display: grid; width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mode-tabs button { justify-content: center; padding-inline: 8px; }
  .setup-layout { grid-template-columns: minmax(0, 1fr); gap: 20px; padding: 17px; }
  .section-heading { align-items: flex-start; flex-direction: column; gap: 4px; }
  .section-heading > span { text-align: left; }
  .select-field { grid-template-columns: minmax(0, 1fr); gap: 7px; }
  .komi-result, .custom-time-grid { margin-left: 0; }
}

.lan-backdrop {
  position: fixed;
  z-index: 50;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 22px;
  background: rgba(50, 49, 48, .34);
}
.lan-dialog {
  display: flex;
  width: min(960px, calc(100vw - 44px));
  height: auto;
  max-height: min(820px, calc(100dvh - 44px));
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(225, 225, 225, .9);
  border-radius: 8px;
  background: rgba(255, 255, 255, .4);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}
.lan-dialog-heading {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 16px;
  padding: 24px 24px 0;
}
.lan-dialog-heading h1 { margin: 0; color: var(--text); font-size: 24px; font-weight: 600; }
.lan-dialog-heading .connection-chip { margin-left: auto; }
.lan-dialog-close {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--text);
  background: transparent;
  transition: border-color 150ms ease, color 150ms ease, background-color 150ms ease;
}
.lan-dialog-close:hover { border-color: rgba(255, 255, 255, .7); color: var(--accent-strong); background: rgba(255, 255, 255, .72); box-shadow: var(--shadow-xs); }
.lan-dialog-close:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.lan-page {
  display: block;
  width: 100%;
  min-height: 0;
  flex: 1 1 auto;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 18px 24px 24px;
  background: transparent;
}
.lan-content, .room-panel { width: 100%; margin: 0; }
.lan-dialog .setup-layout, .lan-dialog .room-panel {
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.lan-dialog .setup-layout { grid-template-columns: minmax(0, 1fr) 248px; gap: 24px; padding: 0; }
.lan-dialog .room-panel { padding: 0; }
.lan-dialog .panel-heading { margin-top: 2px; }
.lan-dialog .panel-heading h2 { font-size: 20px; }
.lan-dialog .summary-row { gap: 6px 14px; margin-bottom: 16px; padding: 10px 12px; }
.compact-field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 18px; }
.compact-field { display: grid; width: 100%; max-width: 300px; min-width: 0; gap: 6px; color: var(--text); font-size: 12px; font-weight: 600; }
.compact-field-label { display: flex; min-height: 17px; align-items: baseline; justify-content: space-between; gap: 8px; }
.komi-inline { flex: 0 0 auto; color: var(--muted); font-size: 11px; font-weight: 400; }
.komi-inline b { color: var(--accent); font-size: 12px; font-weight: 600; }
.lan-page :deep(.compact-field .setup-dropdown) { width: 100%; max-width: 300px; }
.lan-page :deep(.compact-field .setup-dropdown-trigger) { min-height: 50px; }
.password-row { grid-column: 1 / -1; max-width: 420px; margin-top: 2px; }
.custom-time-grid { grid-column: 1 / -1; width: min(100%, 480px); margin: 0; }
.hint { max-width: 620px; margin-top: 12px; }
.lan-dialog .mode-tabs { margin-bottom: 16px; }
.lan-dialog .page-error { margin-top: 14px; }
.lan-dialog .room-info-grid { gap: 0 24px; margin-top: 18px; }
.lan-dialog .room-info-grid > div {
  padding: 14px 0;
  border: 0;
  border-bottom: 1px solid rgba(225, 225, 225, .78);
  border-radius: 0;
  background: transparent;
}
@media (max-width: 760px) {
  .lan-backdrop { padding: 12px; }
  .lan-dialog { width: 100%; height: auto; max-height: calc(100dvh - 24px); }
  .lan-dialog-heading { gap: 8px; padding: 18px 18px 0; }
  .lan-dialog-heading h1 { font-size: 20px; }
  .lan-dialog-heading .connection-chip { padding: 7px 8px; font-size: 11px; }
  .lan-page { padding: 16px; }
  .lan-dialog .setup-layout { grid-template-columns: minmax(0, 1fr); gap: 20px; }
}
@media (max-width: 560px) {
  .compact-field-grid { grid-template-columns: minmax(0, 1fr); }
  .password-row, .custom-time-grid { grid-column: auto; }
  .custom-time-grid { grid-template-columns: minmax(0, 1fr); }
  .compact-field, .password-row { max-width: 100%; }
  .lan-dialog .summary-row { gap: 6px 10px; }
}

/* Match the shared segmented-tab treatment used by the research workspace. */
.mode-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px;
  width: min(100%, 320px);
  padding: 3px;
  margin-bottom: 16px;
  border: 1px solid rgba(225, 225, 225, .82);
  border-radius: 8px;
  background: rgba(237, 235, 233, .58);
}
.mode-tabs button {
  display: inline-flex;
  min-width: 0;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 5px;
  color: var(--muted);
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition: border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out;
}
.mode-tabs button:hover:not(.selected) {
  border-color: rgba(255, 255, 255, .6);
  color: var(--text);
  background: rgba(255, 255, 255, .54);
}
.mode-tabs button.selected {
  border-color: rgba(var(--accent-rgb), .16);
  color: var(--accent-strong);
  background: rgba(255, 255, 255, .88);
  box-shadow: var(--shadow-xs);
}
.mode-tabs button:active { transform: scale(.97); }
.mode-tabs button:focus-visible { position: relative; z-index: 1; outline: 2px solid var(--accent); outline-offset: 1px; }
.mode-tabs button svg { flex: 0 0 auto; }
@media (max-width: 560px) {
  .mode-tabs { width: 100%; }
  .mode-tabs button { padding-inline: 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .lan-dialog-close { transition: none; }
  .mode-tabs button { transition: none; }
}
</style>
