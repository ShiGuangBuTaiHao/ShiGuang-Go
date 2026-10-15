<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-vue-next'

const props = defineProps<{
  modelValue: string
  ariaLabel: string
  min?: string
  max?: string
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const root = ref<HTMLElement | null>(null)
const popup = ref<HTMLElement | null>(null)
const open = ref(false)
const position = ref<Record<string, string>>({ visibility: 'hidden' })
const view = ref(monthStart(parseDate(props.modelValue) ?? new Date()))
const weekdays = ['一', '二', '三', '四', '五', '六', '日']

function monthStart(date: Date) { return new Date(date.getFullYear(), date.getMonth(), 1) }
function parseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date : null
}
function dateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const monthLabel = computed(() => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(view.value))
const days = computed(() => {
  const first = monthStart(view.value)
  const offset = (first.getDay() + 6) % 7
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset)
  const count = Math.ceil((offset + new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()) / 7) * 7
  return Array.from({ length: count }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index))
})
const today = dateValue(new Date())
function isDisabled(date: Date) {
  const value = dateValue(date)
  return Boolean((props.min && value < props.min) || (props.max && value > props.max))
}
function updatePosition() {
  const trigger = root.value?.querySelector<HTMLElement>('.date-picker-trigger')
  if (!trigger || !popup.value) return
  const rect = trigger.getBoundingClientRect()
  const edge = 12, gap = 6
  const width = Math.min(304, window.innerWidth - edge * 2)
  const popupStyle = getComputedStyle(popup.value)
  const borders = parseFloat(popupStyle.borderTopWidth) + parseFloat(popupStyle.borderBottomWidth)
  const naturalHeight = popup.value.scrollHeight + borders
  const below = window.innerHeight - rect.bottom - gap - edge
  const above = rect.top - gap - edge
  const openUp = naturalHeight > below && above > below
  const available = Math.max(1, openUp ? above : below)
  const height = Math.min(naturalHeight, available)
  const constrained = naturalHeight > available
  const left = Math.max(edge, Math.min(rect.left, window.innerWidth - width - edge))
  const top = openUp ? rect.top - gap - height : rect.bottom + gap
  position.value = { left: `${left}px`, top: `${Math.max(edge, Math.min(top, window.innerHeight - height - edge))}px`, width: `${width}px`, maxHeight: `${height}px`, overflowY: constrained ? 'auto' : 'hidden', visibility: 'visible' }
}
function onScroll(event: Event) {
  const target = event.target as Node | null
  if (target && popup.value?.contains(target)) return
  updatePosition()
}
async function toggle() {
  if (props.disabled) return
  open.value = !open.value
  if (!open.value) return
  view.value = monthStart(parseDate(props.modelValue) ?? new Date())
  position.value = { visibility: 'hidden' }
  await nextTick()
  updatePosition()
  window.addEventListener('resize', updatePosition)
  document.addEventListener('scroll', onScroll, true)
}
function close() {
  open.value = false
  window.removeEventListener('resize', updatePosition)
  document.removeEventListener('scroll', onScroll, true)
}
function choose(date: Date) {
  if (isDisabled(date)) return
  emit('update:modelValue', dateValue(date))
  close()
}
function shiftMonth(amount: number) {
  view.value = new Date(view.value.getFullYear(), view.value.getMonth() + amount, 1)
  nextTick(updatePosition)
}
function onPointerdown(event: PointerEvent) {
  const target = event.target as Node
  if (root.value?.contains(target) || popup.value?.contains(target)) return
  close()
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) close()
}
watch(() => props.disabled, value => { if (value) close() })
onMounted(() => {
  document.addEventListener('pointerdown', onPointerdown)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  close()
  document.removeEventListener('pointerdown', onPointerdown)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="root" class="date-picker" :class="{ open }">
    <button class="date-picker-trigger" type="button" :disabled="disabled" :aria-label="ariaLabel" :aria-expanded="open" aria-haspopup="dialog" @click.stop="toggle">
      <span :class="{ placeholder: !modelValue }">{{ modelValue || '选择日期' }}</span>
      <CalendarDays :size="16" aria-hidden="true" />
    </button>
    <Teleport to="body">
      <section v-if="open" ref="popup" class="date-picker-popup" :style="position" role="dialog" :aria-label="ariaLabel">
        <header class="date-picker-header">
          <button type="button" class="date-picker-nav" aria-label="上个月" @click="shiftMonth(-1)"><ChevronLeft :size="17" /></button>
          <strong>{{ monthLabel }}</strong>
          <button type="button" class="date-picker-nav" aria-label="下个月" @click="shiftMonth(1)"><ChevronRight :size="17" /></button>
        </header>
        <div class="date-picker-weekdays" aria-hidden="true"><span v-for="day in weekdays" :key="day">{{ day }}</span></div>
        <div class="date-picker-days">
          <button v-for="date in days" :key="dateValue(date)" type="button" class="date-picker-day" :class="{ outside: date.getMonth() !== view.getMonth(), selected: dateValue(date) === modelValue, today: dateValue(date) === today }" :disabled="isDisabled(date)" :aria-label="dateValue(date)" :aria-pressed="dateValue(date) === modelValue" @click="choose(date)">{{ date.getDate() }}</button>
        </div>
        <footer class="date-picker-footer">
          <button type="button" class="date-picker-command" :disabled="!modelValue" @click="emit('update:modelValue', ''); close()">清除</button>
          <button type="button" class="date-picker-command" :disabled="isDisabled(new Date())" @click="choose(new Date())">今天</button>
        </footer>
      </section>
    </Teleport>
  </div>
</template>

<style scoped>
.date-picker { width: 100%; min-width: 0; }
.date-picker-trigger { display: flex; width: 100%; min-width: 0; height: 36px; align-items: center; justify-content: space-between; gap: 8px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px; color: var(--text); background: rgba(255, 255, 255, .72); font: inherit; font-size: 12px; text-align: left; cursor: pointer; transition: border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease; }
.date-picker-trigger:hover:not(:disabled), .date-picker.open .date-picker-trigger { border-color: var(--accent); background: var(--surface); }
.date-picker-trigger:focus-visible, .date-picker-nav:focus-visible, .date-picker-day:focus-visible, .date-picker-command:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.date-picker-trigger > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.date-picker-trigger > span.placeholder { color: var(--text-subtle); }
.date-picker-trigger svg { flex: 0 0 auto; color: var(--muted); }
.date-picker-trigger:disabled { cursor: not-allowed; opacity: .55; }
.date-picker-popup { position: fixed; z-index: 1100; box-sizing: border-box; overflow: auto; padding: 12px; border: 1px solid var(--border); border-radius: 6px; color: var(--text); background: rgba(255, 255, 255, .72); box-shadow: var(--shadow-md); backdrop-filter: blur(24px); }
.date-picker-header { display: grid; grid-template-columns: 32px 1fr 32px; align-items: center; gap: 8px; margin-bottom: 6px; }
.date-picker-header strong { text-align: center; font-size: 13px; font-weight: 600; }
.date-picker-nav { display: grid; width: 32px; height: 32px; place-items: center; border: 1px solid transparent; border-radius: 5px; color: var(--muted); background: transparent; }
.date-picker-nav:hover { border-color: var(--accent-16); color: var(--accent-strong); background: var(--accent-soft); }
.date-picker-weekdays, .date-picker-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); text-align: center; }
.date-picker-weekdays { margin-bottom: 2px; color: var(--muted); font-size: 11px; font-weight: 600; }
.date-picker-weekdays span { display: grid; height: 24px; place-items: center; }
.date-picker-days { gap: 2px; }
.date-picker-day { width: 100%; height: 32px; border: 1px solid transparent; border-radius: 5px; color: var(--text); background: transparent; font: inherit; font-size: 12px; cursor: pointer; }
.date-picker-day.outside { color: var(--text-subtle); }
.date-picker-day:hover:not(:disabled) { border-color: var(--accent-16); color: var(--accent-strong); background: var(--accent-soft); }
.date-picker-day.today:not(.selected) { border-color: var(--accent-16); color: var(--accent-strong); }
.date-picker-day.selected { border-color: var(--accent); color: #fff; background: var(--accent); font-weight: 600; }
.date-picker-day:disabled { opacity: .35; cursor: not-allowed; }
.date-picker-footer { display: flex; justify-content: space-between; margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--border); }
.date-picker-command { min-height: 28px; padding: 0 8px; border: 0; border-radius: 4px; color: var(--accent-strong); background: transparent; font: inherit; font-size: 12px; }
.date-picker-command:hover:not(:disabled) { background: var(--accent-soft); }
.date-picker-command:disabled { color: var(--text-subtle); cursor: not-allowed; }
</style>
