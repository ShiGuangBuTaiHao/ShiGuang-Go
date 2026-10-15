<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ visible: boolean; drawer: boolean; side: 'left' | 'right'; label: string }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
let previousFocus: HTMLElement | null = null

watch(() => [props.visible, props.drawer], async () => {
  await nextTick()
  const element = dialog.value
  if (!element) return
  const wasModal = element.matches(':modal')
  if (props.visible && props.drawer) {
    if (wasModal) return
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element.close()
    element.showModal()
  } else {
    element.close()
    if (props.visible) element.setAttribute('open', '')
    if (wasModal && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
  }
}, { immediate: true, flush: 'post' })

function backdrop(event: MouseEvent) {
  const element = dialog.value
  if (!props.drawer || !element || event.target !== element) return
  const bounds = element.getBoundingClientRect()
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) emit('close')
}
onBeforeUnmount(() => {
  if (dialog.value?.matches(':modal')) {
    dialog.value.close()
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
  }
})
</script>

<template>
  <dialog ref="dialog" class="library-pane" :class="[{ 'is-drawer': drawer }, `pane-${side}`]"
    :aria-label="label" :aria-modal="drawer && visible ? true : undefined"
    @cancel.prevent="emit('close')" @click="backdrop">
    <slot />
  </dialog>
</template>

<style scoped>
.library-pane { position: static; width: 100%; max-width: none; height: 100%; max-height: none; min-width: 0; min-height: 0; padding: 0; margin: 0; overflow: hidden; border: 0; color: var(--text); background: transparent; }
.library-pane[open] { display: flex; flex-direction: column; }
.library-pane:not([open]) { display: none; }
.library-pane.is-drawer { position: fixed; inset: 0; width: min(380px, 100%); height: 100dvh; background: rgba(255, 255, 255, .96); box-shadow: var(--shadow-md); }
.library-pane.is-drawer.pane-left { width: min(280px, calc(100% - 40px)); margin-right: auto; }
.library-pane.is-drawer.pane-right { margin-left: auto; }
.library-pane::backdrop { background: rgba(50, 49, 48, .24); backdrop-filter: blur(3px); }
@media (max-width: 520px) { .library-pane.is-drawer.pane-right { width: 100%; } }
</style>
