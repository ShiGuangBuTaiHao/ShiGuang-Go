<script setup lang="ts">
const props = withDefaults(defineProps<{
  secondaryLabel?: string
  primaryLabel?: string
  primaryDisabled?: boolean
  busy?: boolean
  busyLabel?: string
  status?: string
}>(), {
  secondaryLabel: '取消',
  primaryLabel: '',
  primaryDisabled: false,
  busy: false,
  busyLabel: '处理中...',
  status: '',
})

const emit = defineEmits<{
  (event: 'secondary'): void
  (event: 'primary'): void
}>()
</script>

<template>
  <footer class="setup-actions">
    <p v-if="props.status" class="setup-status" role="status">{{ props.status }}</p>
    <button class="setup-secondary" type="button" @click="emit('secondary')">{{ props.secondaryLabel }}</button>
    <button
      v-if="props.primaryLabel"
      class="setup-primary"
      type="button"
      :disabled="props.primaryDisabled || props.busy"
      :aria-busy="props.busy"
      @click="emit('primary')"
    >
      <span class="setup-button-label" :class="{ hidden: props.busy }" :aria-hidden="props.busy">{{ props.primaryLabel }}</span>
      <span class="setup-button-label" :class="{ hidden: !props.busy }" :aria-hidden="!props.busy">{{ props.busyLabel }}</span>
    </button>
  </footer>
</template>

<style scoped>
.setup-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 18px 24px 24px;
  border-top: 1px solid rgba(225, 225, 225, .9);
  background: rgba(255, 255, 255, .18);
}
.setup-secondary, .setup-primary {
  display: grid;
  min-width: 88px;
  min-height: 40px;
  flex: 0 0 auto;
  align-items: center;
  justify-items: center;
  padding: 8px 18px;
  border: 1px solid transparent;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
  transition: transform 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out;
}
.setup-secondary { color: var(--text); background: transparent; }
.setup-primary { border-color: var(--accent); color: #fff; background: var(--accent); box-shadow: var(--shadow-xs); }
.setup-secondary:hover:not(:disabled) { border-color: rgba(255, 255, 255, .6); color: var(--accent); background: rgba(255, 255, 255, .72); box-shadow: var(--shadow-xs); }
.setup-primary:hover:not(:disabled) { border-color: var(--accent-strong); background: var(--accent-strong); box-shadow: var(--shadow-sm); }
.setup-secondary:active:not(:disabled), .setup-primary:active:not(:disabled) { transform: scale(.97); box-shadow: none; }
.setup-primary:active:not(:disabled) { border-color: #005a9e; background: #005a9e; }
.setup-secondary:disabled, .setup-primary:disabled { cursor: not-allowed; opacity: .5; }
.setup-secondary:focus-visible, .setup-primary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; box-shadow: 0 0 0 4px rgba(255, 255, 255, .4), 0 0 0 6px var(--accent); }
.setup-button-label { grid-area: 1 / 1; }
.setup-button-label.hidden { visibility: hidden; }
.setup-status { min-width: 0; flex: 1 1 160px; margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
@media (max-width: 760px) {
  .setup-actions { padding: 18px; }
}
@media (max-height: 620px) {
  .setup-actions { padding-top: 12px; padding-bottom: 14px; }
}
@media (prefers-reduced-motion: reduce) {
  .setup-secondary, .setup-primary { transition: none; }
}
</style>
