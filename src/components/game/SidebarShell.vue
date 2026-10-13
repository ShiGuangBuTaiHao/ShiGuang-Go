<script setup lang="ts">
import { nextTick, ref } from 'vue'

export type SidebarTab = {
  id: string
  label: string
}

const props = defineProps<{
  label: string
  title: string
  idPrefix: string
  tabs: SidebarTab[]
  modelValue: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
}>()

const tabButtons = ref<HTMLButtonElement[]>([])

function focusTab(index: number) {
  const normalizedIndex = (index + props.tabs.length) % props.tabs.length
  const tab = props.tabs[normalizedIndex]
  if (!tab) return
  emit('update:modelValue', tab.id)
  nextTick(() => tabButtons.value[normalizedIndex]?.focus())
}

function setTabButton(element: unknown, index: number) {
  tabButtons.value[index] = element as HTMLButtonElement
}

function handleTabKeydown(event: KeyboardEvent, index: number) {
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    focusTab(index + 1)
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    focusTab(index - 1)
  } else if (event.key === 'Home') {
    event.preventDefault()
    focusTab(0)
  } else if (event.key === 'End') {
    event.preventDefault()
    focusTab(props.tabs.length - 1)
  }
}

function tabId(id: string) {
  return `${props.idPrefix}-tab-${id}`
}

const panelId = `${props.idPrefix}-panel`
</script>

<template>
  <aside class="game-sidebar sidebar-shell" :aria-label="label">
    <div class="sidebar-tabs" role="tablist" :aria-label="`${title}分类`">
      <button
        v-for="(tab, index) in tabs"
        :key="tab.id"
        :ref="(element) => setTabButton(element, index)"
        :id="tabId(tab.id)"
        class="sidebar-tab"
        type="button"
        role="tab"
        :aria-selected="modelValue === tab.id"
        :aria-controls="panelId"
        :tabindex="modelValue === tab.id ? 0 : -1"
        @click="emit('update:modelValue', tab.id)"
        @keydown="handleTabKeydown($event, index)"
      >
        {{ tab.label }}
      </button>
    </div>

    <section
      class="sidebar-scroll"
      role="tabpanel"
      :id="panelId"
      :aria-labelledby="tabId(modelValue)"
      tabindex="0"
    >
      <slot />
    </section>
  </aside>
</template>

<style scoped>
.sidebar-shell {
  --sidebar-content-max-height: 420px;
  display: flex;
  min-width: 320px;
  max-width: 400px;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid var(--border);
  background: rgba(255, 255, 255, .76);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.sidebar-tabs {
  display: grid;
  box-sizing: border-box;
  height: 38px;
  min-height: 38px;
  flex: 0 0 auto;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  gap: 2px;
  margin: 17px 14px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: rgba(237, 235, 233, .72);
}

.sidebar-tab {
  min-width: 0;
  min-height: 0;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--muted);
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  transition: border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out;
}

.sidebar-tab:hover:not([aria-selected='true']) {
  border-color: rgba(255, 255, 255, .6);
  color: var(--text);
  background: rgba(255, 255, 255, .62);
}

.sidebar-tab[aria-selected='true'] {
  border-color: rgba(var(--accent-rgb), .16);
  color: var(--accent-strong);
  background: var(--surface);
  box-shadow: var(--shadow-xs);
  font-weight: 600;
}

.sidebar-tab:active { transform: scale(.97); }
.sidebar-scroll { min-height: 0; flex: 1 1 auto; overflow: auto; padding: 4px 16px 16px; }
.sidebar-scroll:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; }

@media (max-width: 980px) {
  .sidebar-shell {
    width: 100%;
    max-width: none;
    height: auto;
    min-height: 320px;
    border-top: 1px solid var(--border);
    border-left: 0;
  }

  .sidebar-scroll { max-height: var(--sidebar-content-max-height); }
}

@media (max-width: 760px) {
  .sidebar-tabs {
    height: 32px;
    min-height: 32px;
    margin-block: 16px;
  }
}

@media (max-width: 520px) {
  .sidebar-tabs { margin-inline: 10px; }
  .sidebar-scroll { padding-inline: 12px; }
}

@media (prefers-reduced-motion: reduce) {
  .sidebar-tab { transition: none; }
}
</style>
