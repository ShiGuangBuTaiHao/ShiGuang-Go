<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'

export interface SetupDropdownOption {
  value: string
  label: string
  description?: string
  group?: string
}

const props = defineProps<{
  modelValue: string
  options: SetupDropdownOption[]
  ariaLabel: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
}>()

const root = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const open = ref(false)
const menuStyle = ref<Record<string, string>>({})
let positionFrame = 0
const selected = computed(() => props.options.find((option) => option.value === props.modelValue) ?? props.options[0])
const groups = computed(() => {
  const grouped = new Map<string, SetupDropdownOption[]>()
  for (const option of props.options) {
    const key = option.group ?? ''
    const values = grouped.get(key) ?? []
    values.push(option)
    grouped.set(key, values)
  }
  return [...grouped.entries()]
})

function updatePosition() {
  const trigger = root.value?.querySelector<HTMLElement>('.setup-dropdown-trigger')
  const popup = menu.value
  if (!trigger || !popup) return

  const rect = trigger.getBoundingClientRect()
  const edge = 12
  const gap = 7
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const width = Math.max(0, Math.min(Math.ceil(rect.width), viewportWidth - edge * 2))
  const left = Math.max(edge, Math.min(rect.left, viewportWidth - width - edge))
  const popupStyle = getComputedStyle(popup)
  const borderHeight =
    parseFloat(popupStyle.borderTopWidth) + parseFloat(popupStyle.borderBottomWidth)
  const contentHeight = Math.ceil(popup.scrollHeight + borderHeight)
  const naturalHeight = Math.max(1, Math.min(contentHeight, 360))
  const below = Math.max(0, viewportHeight - rect.bottom - gap - edge)
  const above = Math.max(0, rect.top - gap - edge)
  const fitsBelow = naturalHeight <= below
  const fitsAbove = naturalHeight <= above
  const openUp = !fitsBelow && (fitsAbove || above > below)
  const available = openUp ? above : below
  const height = Math.min(naturalHeight, Math.max(1, available))
  const constrained = contentHeight > height
  const maxTop = Math.max(edge, viewportHeight - edge - height)
  const preferredTop = openUp ? rect.top - gap - height : rect.bottom + gap
  const top = Math.max(edge, Math.min(preferredTop, maxTop))

  menuStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${Math.round(width)}px`,
    minWidth: `${Math.round(width)}px`,
    maxWidth: `${Math.round(width)}px`,
    maxHeight: constrained ? `${Math.round(height)}px` : 'none',
    visibility: 'visible',
  }
}

function schedulePosition() {
  if (positionFrame) cancelAnimationFrame(positionFrame)
  positionFrame = requestAnimationFrame(() => {
    positionFrame = requestAnimationFrame(() => {
      positionFrame = 0
      updatePosition()
    })
  })
}

function addPositionListeners() {
  window.addEventListener('resize', updatePosition)
  document.addEventListener('scroll', handleDocumentScroll, true)
}

function removePositionListeners() {
  window.removeEventListener('resize', updatePosition)
  document.removeEventListener('scroll', handleDocumentScroll, true)
}

function handleDocumentScroll(event: Event) {
  const target = event.target as Node | null
  if (menu.value && target && (target === menu.value || menu.value.contains(target))) return
  updatePosition()
}

async function toggle() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) {
    menuStyle.value = { visibility: 'hidden' }
    addPositionListeners()
    await nextTick()
    schedulePosition()
  } else {
    if (positionFrame) {
      cancelAnimationFrame(positionFrame)
      positionFrame = 0
    }
    removePositionListeners()
  }
}

function choose(option: SetupDropdownOption) {
  if (props.disabled) return
  emit('update:modelValue', option.value)
  open.value = false
  if (positionFrame) {
    cancelAnimationFrame(positionFrame)
    positionFrame = 0
  }
  removePositionListeners()
}

watch(() => props.disabled, (disabled) => {
  if (!disabled) return
  open.value = false
  if (positionFrame) {
    cancelAnimationFrame(positionFrame)
    positionFrame = 0
  }
  removePositionListeners()
})

function handleDocumentPointerdown(event: PointerEvent) {
  const target = event.target as Node
  if (root.value?.contains(target) || menu.value?.contains(target)) return
  open.value = false
  if (positionFrame) {
    cancelAnimationFrame(positionFrame)
    positionFrame = 0
  }
  removePositionListeners()
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    open.value = false
    if (positionFrame) {
      cancelAnimationFrame(positionFrame)
      positionFrame = 0
    }
    removePositionListeners()
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerdown)
  document.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  if (positionFrame) cancelAnimationFrame(positionFrame)
  removePositionListeners()
  document.removeEventListener('pointerdown', handleDocumentPointerdown)
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div ref="root" class="setup-dropdown" :class="{ open }">
    <button
      class="setup-dropdown-trigger"
      type="button"
      :aria-label="props.ariaLabel"
      :aria-expanded="open"
      :disabled="props.disabled"
      @click.stop="toggle"
    >
      <span class="setup-dropdown-copy">
        <strong>{{ selected?.label }}</strong>
        <small v-if="selected?.description">{{ selected.description }}</small>
      </span>
      <ChevronDown class="setup-dropdown-chevron" :size="16" aria-hidden="true" />
    </button>

    <Teleport to="body">
      <div v-if="open" ref="menu" class="setup-dropdown-menu" :style="menuStyle" role="listbox" :aria-label="props.ariaLabel">
        <template v-for="([group, options]) in groups" :key="group">
          <div v-if="group" class="setup-dropdown-group">{{ group }}</div>
          <button
            v-for="option in options"
            :key="option.value"
            class="setup-dropdown-option"
            :class="{ selected: option.value === props.modelValue }"
            type="button"
            role="option"
            :aria-selected="option.value === props.modelValue"
            @click="choose(option)"
          >
            <span class="setup-dropdown-copy">
              <strong>{{ option.label }}</strong>
              <small v-if="option.description">{{ option.description }}</small>
            </span>
            <Check v-if="option.value === props.modelValue" :size="16" aria-hidden="true" />
          </button>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.setup-dropdown { position: relative; min-width: 0; }
.setup-dropdown-trigger { display: flex; width: 100%; min-height: 50px; align-items: center; justify-content: space-between; gap: 14px; padding: 8px 14px; border: 1px solid transparent; border-radius: 6px; color: #323130; background: rgba(255,255,255,.4); box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.1); font: inherit; text-align: left; cursor: pointer; transition: border-color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out; }
.setup-dropdown-trigger:hover:not(:disabled), .setup-dropdown.open .setup-dropdown-trigger:not(:disabled) { border-color: rgba(255,255,255,.6); color: #0078d4; background: rgba(255,255,255,.72); box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.1); }
.setup-dropdown-trigger:disabled { cursor: not-allowed; opacity: .55; }
.setup-dropdown-copy { display: grid; min-width: 0; gap: 2px; }
.setup-dropdown-copy strong { overflow: hidden; color: #323130; font-size: 13px; font-weight: 600; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.setup-dropdown-copy small { overflow: hidden; color: #605e5c; font-size: 11px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.setup-dropdown-chevron { flex: 0 0 auto; color: #605e5c; transition: transform 150ms ease-out, color 150ms ease-out; }
.setup-dropdown.open .setup-dropdown-chevron { transform: rotate(180deg); color: var(--accent); }
.setup-dropdown-menu { position: fixed; z-index: 1000; box-sizing: border-box; overflow-x: hidden; overflow-y: auto; visibility: hidden; padding: 6px 0; border: 1px solid #e1e1e1; border-radius: 8px; background: rgba(255,255,255,.72); box-shadow: 0 6.4px 14.4px rgba(0,0,0,.13), 0 1.2px 3.6px rgba(0,0,0,.1); backdrop-filter: blur(24px); }
.setup-dropdown-menu::-webkit-scrollbar-track { margin: 5px 0; background: transparent; }
.setup-dropdown-group { padding: 8px 10px 5px; color: #605e5c; font-size: 10px; font-weight: 600; }
.setup-dropdown-option { display: flex; box-sizing: border-box; width: calc(100% - 16px); min-height: 46px; align-items: center; justify-content: space-between; gap: 12px; margin-right: 8px; margin-left: 8px; padding: 8px 10px; border: 1px solid transparent; border-radius: 6px; color: #323130; background: transparent; font: inherit; text-align: left; cursor: pointer; transition: border-color 150ms ease-out, background-color 150ms ease-out, color 150ms ease-out, box-shadow 150ms ease-out, transform 150ms ease-out; }
.setup-dropdown-option + .setup-dropdown-option { margin-top: 4px; }
.setup-dropdown-option:hover, .setup-dropdown-option.selected { border-color: rgba(255,255,255,.6); color: #0078d4; background: rgba(255,255,255,.72); box-shadow: 0 1.6px 3.6px rgba(0,0,0,.13), 0 .3px .9px rgba(0,0,0,.1); }
.setup-dropdown-option > svg { flex: 0 0 auto; color: var(--accent); }
.setup-dropdown-option.selected .setup-dropdown-copy strong { color: var(--accent); }
.setup-dropdown-trigger:active, .setup-dropdown-option:active { transform: scale(.97); box-shadow: none; }
.setup-dropdown-trigger:focus-visible, .setup-dropdown-option:focus-visible { outline: 2px solid #0078d4; outline-offset: 2px; box-shadow: 0 0 0 4px rgba(255,255,255,.4), 0 0 0 6px #0078d4; }
@media (prefers-reduced-motion: reduce) { .setup-dropdown-trigger, .setup-dropdown-chevron { transition: none; } }
</style>
