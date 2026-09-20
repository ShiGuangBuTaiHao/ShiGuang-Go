<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Crosshair, Maximize2, Palette, Sparkles, Volume2, X } from 'lucide-vue-next'
import SetupDropdown, { type SetupDropdownOption } from '../ui/SetupDropdown.vue'
import type { RecommendationStrength } from '../../domain/ai'
import type { BoardStyle } from '../../domain/boardTheme'

const props = defineProps<{
  open: boolean
  coordinatesEnabled: boolean
  immersiveEnabled: boolean
  boardStyle: BoardStyle
  recommendationStrength: RecommendationStrength
}>()

const emit = defineEmits<{
  close: []
  'update:coordinatesEnabled': [value: boolean]
  'update:immersiveEnabled': [value: boolean]
  'update:boardStyle': [value: BoardStyle]
  'update:recommendationStrength': [value: RecommendationStrength]
}>()

const dialog = ref<HTMLElement | null>(null)
const soundEnabled = ref(true)
let restoreFocus: HTMLElement | null = null

const boardStyle = computed<BoardStyle>({
  get: () => props.boardStyle,
  set: (value) => emit('update:boardStyle', value),
})

const recommendationStrength = computed<RecommendationStrength>({
  get: () => props.recommendationStrength,
  set: (value) => emit('update:recommendationStrength', value),
})

const boardStyleOptions: SetupDropdownOption[] = [
  { value: 'classic', label: '经典木纹', description: '温润木色与清晰棋线' },
  { value: 'minimal', label: '简约', description: '纯色木调与克制的黑白棋子' },
  { value: 'glassmorphism', label: '拟态玻璃', description: '无色磨砂玻璃与黑白质感棋子' },
]

const recommendationStrengthOptions: SetupDropdownOption[] = [
  { value: 'auto', label: '自动', description: '根据局面稳定性逐步加深分析' },
  { value: 'low', label: '低', description: '快速推荐，适合即时查看' },
  { value: 'medium', label: '中', description: '兼顾速度与稳定性' },
  { value: 'high', label: '高', description: '适合大多数对局' },
  { value: 'ultra', label: '超高', description: '更深搜索，等待时间较长' },
  { value: 'maximum', label: '极致', description: '最高质量，可能需要较长时间' },
]

const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

async function focusDialog() {
  await nextTick()
  dialog.value?.querySelector<HTMLElement>(focusableSelector)?.focus()
}

function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !dialog.value) return
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>(focusableSelector)]
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

watch(() => props.open, async (open) => {
  if (open) {
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await focusDialog()
  } else {
    restoreFocus?.focus()
    restoreFocus = null
  }
}, { immediate: true })

onBeforeUnmount(() => restoreFocus?.focus())
</script>

<template>
  <div v-if="open" class="settings-backdrop" @click.self="emit('close')">
    <section ref="dialog" class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="game-settings-title" tabindex="-1" @keydown="trapFocus">
      <header class="settings-heading">
        <h2 id="game-settings-title">对局设置</h2>
        <button class="settings-close" type="button" aria-label="关闭对局设置" title="关闭" @click="emit('close')">
          <X :size="18" stroke-width="2" aria-hidden="true" />
        </button>
      </header>

      <div class="settings-body">
        <div class="settings-list">
          <div class="settings-row">
            <span class="settings-row-icon"><Crosshair :size="18" aria-hidden="true" /></span>
            <span class="settings-row-copy">
              <strong>显示坐标</strong>
              <small>在棋盘边缘显示行列坐标</small>
            </span>
            <button
              class="settings-toggle"
              type="button"
              role="switch"
              :aria-checked="props.coordinatesEnabled"
              :aria-label="props.coordinatesEnabled ? '关闭显示坐标' : '开启显示坐标'"
              :title="props.coordinatesEnabled ? '关闭显示坐标' : '开启显示坐标'"
              @click="emit('update:coordinatesEnabled', !props.coordinatesEnabled)"
            >
              <span class="settings-toggle-knob" :class="{ on: props.coordinatesEnabled }" />
            </button>
          </div>

          <div class="settings-row">
            <span class="settings-row-icon"><Volume2 :size="18" aria-hidden="true" /></span>
            <span class="settings-row-copy">
              <strong>声音</strong>
              <small>播放落子与提示音</small>
            </span>
            <button
              class="settings-toggle"
              type="button"
              role="switch"
              :aria-checked="soundEnabled"
              :aria-label="soundEnabled ? '关闭声音' : '开启声音'"
              :title="soundEnabled ? '关闭声音' : '开启声音'"
              @click="soundEnabled = !soundEnabled"
            >
              <span class="settings-toggle-knob" :class="{ on: soundEnabled }" />
            </button>
          </div>

          <div class="settings-row">
            <span class="settings-row-icon"><Maximize2 :size="18" aria-hidden="true" /></span>
            <span class="settings-row-copy">
              <strong>沉浸模式</strong>
              <small>弱化界面干扰，专注当前棋局</small>
            </span>
            <button
              class="settings-toggle"
              type="button"
              role="switch"
              :aria-checked="props.immersiveEnabled"
              :aria-label="props.immersiveEnabled ? '关闭沉浸模式' : '开启沉浸模式'"
              :title="props.immersiveEnabled ? '关闭沉浸模式' : '开启沉浸模式'"
              @click="emit('update:immersiveEnabled', !props.immersiveEnabled)"
            >
              <span class="settings-toggle-knob" :class="{ on: props.immersiveEnabled }" />
            </button>
          </div>

          <div class="settings-row settings-dropdown-row">
            <span class="settings-row-icon"><Palette :size="18" aria-hidden="true" /></span>
            <span class="settings-row-copy">
              <strong>棋盘个性化</strong>
              <small>选择棋盘与落子区域的视觉风格</small>
            </span>
            <SetupDropdown
              v-model="boardStyle"
              class="settings-dropdown"
              :options="boardStyleOptions"
              ariaLabel="棋盘个性化"
            />
          </div>

          <div class="settings-row settings-dropdown-row">
            <span class="settings-row-icon"><Sparkles :size="18" aria-hidden="true" /></span>
            <span class="settings-row-copy">
              <strong>推荐落点强度</strong>
              <small>控制推荐结果在棋盘上的提示程度</small>
            </span>
            <SetupDropdown
              v-model="recommendationStrength"
              class="settings-dropdown"
              :options="recommendationStrengthOptions"
              ariaLabel="推荐落点强度"
            />
          </div>
        </div>
      </div>

    </section>
  </div>
</template>

<style scoped>
.settings-backdrop {
  position: fixed;
  z-index: 40;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 22px;
  background: rgba(50, 49, 48, .34);
  backdrop-filter: blur(3px);
}

.settings-dialog {
  display: flex;
  width: min(560px, 100%);
  max-height: min(720px, calc(100dvh - 32px));
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(225, 225, 225, .9);
  border-radius: 8px;
  background: rgba(255, 255, 255, .7);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.settings-heading {
  display: flex;
  min-height: 76px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 0 24px;
  border-bottom: 1px solid rgba(225, 225, 225, .9);
}

.settings-heading h2 {
  margin: 0;
  color: #323130;
  font-size: 24px;
  font-weight: 600;
  line-height: 1.3;
}

.settings-close {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #323130;
  background: transparent;
  transition: border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out;
}

.settings-close:hover {
  border-color: rgba(255, 255, 255, .6);
  color: #0078d4;
  background: rgba(255, 255, 255, .72);
  box-shadow: var(--shadow-xs);
}

.settings-close:active {
  transform: scale(.97);
  box-shadow: none;
}

.settings-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 24px;
}

.settings-list {
  display: grid;
}

.settings-row {
  display: flex;
  min-height: 56px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 2px;
}

.settings-row-icon {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 6px;
  color: #0078d4;
  background: rgba(255, 255, 255, .42);
}

.settings-row-copy {
  display: grid;
  min-width: 0;
  flex: 1 1 auto;
  gap: 4px;
}

.settings-row-copy strong {
  color: var(--text);
  font-size: 12px;
}

.settings-row-copy small {
  overflow: hidden;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-toggle {
  display: inline-flex;
  width: 42px;
  height: 24px;
  flex: 0 0 42px;
  align-items: center;
  justify-content: flex-start;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: rgba(237, 235, 233, 0.72);
  transition: border-color 150ms ease-out, background-color 150ms ease-out, transform 150ms ease-out;
  cursor: pointer;
}

.settings-toggle[aria-checked='true'] {
  border-color: var(--accent);
  background: var(--accent);
}

.settings-toggle-knob {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: var(--shadow-xs);
  transition: transform 150ms ease-out;
}

.settings-toggle-knob.on {
  transform: translateX(18px);
}

.settings-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  box-shadow: 0 0 0 4px rgba(243, 242, 241, 0.9);
}

.settings-toggle:active {
  transform: scale(0.97);
}

.settings-dropdown-row {
  min-height: 84px;
}

.settings-dropdown {
  width: 210px;
  flex: 0 0 210px;
}

.settings-dropdown :deep(.setup-dropdown-trigger) {
  min-height: 52px;
}

.settings-close:focus-visible {
  outline: 2px solid #0078d4;
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(255, 255, 255, .4), 0 0 0 6px #0078d4;
}

@media (max-width: 560px) {
  .settings-backdrop { padding: 12px; }
  .settings-dialog { max-height: calc(100dvh - 24px); }
  .settings-heading { min-height: 68px; padding: 0 18px; }
  .settings-heading h2 { font-size: 21px; }
  .settings-body { padding: 12px 18px; }
}

@media (max-width: 460px) {
  .settings-dropdown-row {
    flex-wrap: wrap;
    padding-top: 14px;
    padding-bottom: 14px;
  }

  .settings-dropdown-row .settings-row-copy {
    min-width: calc(100% - 50px);
  }

  .settings-dropdown {
    width: calc(100% - 50px);
    flex-basis: calc(100% - 50px);
    margin-left: 50px;
  }

}
</style>
