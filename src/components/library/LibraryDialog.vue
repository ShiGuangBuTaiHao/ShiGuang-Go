<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { X } from 'lucide-vue-next'
const props = defineProps<{ title: string; wide?: boolean; busy?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
let previousFocus: HTMLElement | null = null
function backdrop(event: MouseEvent) {
  if (props.busy || event.target !== dialog.value || !dialog.value) return
  const rect = dialog.value.getBoundingClientRect()
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) emit('close')
}
onMounted(() => {
  previousFocus = document.activeElement as HTMLElement
  dialog.value?.showModal()
})
onBeforeUnmount(() => {
  dialog.value?.close()
  previousFocus?.focus()
})
</script>

<template>
  <dialog
    ref="dialog"
    class="library-dialog"
    :class="{ wide }"
    aria-labelledby="library-dialog-title"
    @cancel.prevent="!busy && emit('close')"
    @click="backdrop"
  >
    <div class="dialog-heading">
      <h2 id="library-dialog-title">{{ title }}</h2>
      <button
        class="lib-icon"
        type="button"
        title="关闭"
        aria-label="关闭"
        :disabled="busy"
        @click="emit('close')"
      >
        <X :size="18" />
      </button>
    </div>
    <slot />
  </dialog>
</template>

<style scoped>
.library-dialog {
  width: min(480px, calc(100% - 32px));
  max-height: calc(100dvh - 48px);
  padding: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  background: var(--surface);
  box-shadow: var(--shadow-md);
  font: inherit;
}
.library-dialog.wide {
  width: min(660px, calc(100% - 32px));
}
.library-dialog::backdrop {
  background: rgba(50, 49, 48, 0.36);
  backdrop-filter: blur(3px);
}
.dialog-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.dialog-heading h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
</style>
