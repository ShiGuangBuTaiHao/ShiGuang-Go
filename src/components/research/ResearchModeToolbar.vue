<script setup lang="ts">
import { Circle, Eraser, Square, Triangle, X } from 'lucide-vue-next'
import type { BoardMarkType, ResearchMode } from '../../types/research'
import type { Stone } from '../../types/game'

defineProps<{ mode: ResearchMode; setupStone: Stone | null; markType: BoardMarkType; currentPlayer: Stone; locked?: boolean }>()
const emit = defineEmits<{
  'update:mode': [value: ResearchMode]
  'update:setupStone': [value: Stone | null]
  'update:markType': [value: BoardMarkType]
  'update:currentPlayer': [value: Stone]
  'clear-marks': []
}>()
const modes = [{ value: 'play' as const, label: '落子' }, { value: 'setup' as const, label: '摆子' }, { value: 'mark' as const, label: '标记' }]
const marks = [{ value: 'circle' as const, label: '圆形标记', icon: Circle }, { value: 'triangle' as const, label: '三角标记', icon: Triangle }, { value: 'square' as const, label: '方形标记', icon: Square }, { value: 'cross' as const, label: '叉形标记', icon: X }]
</script>

<template>
  <div class="research-tools" role="toolbar" aria-label="棋盘编辑工具">
    <div class="tool-segment" role="group" aria-label="编辑模式">
      <button v-for="item in modes" :key="item.value" type="button" :disabled="locked" :aria-pressed="mode === item.value" :class="{ selected: mode === item.value }" @click="emit('update:mode', item.value)">{{ item.label }}</button>
    </div>
    <div class="tool-context" role="group" :aria-label="mode === 'mark' ? '棋盘标记' : '棋子颜色'">
      <template v-if="mode === 'mark'">
        <button v-for="item in marks" :key="item.value" class="icon-tool" type="button" :disabled="locked" :title="item.label" :aria-label="item.label" :aria-pressed="markType === item.value" :class="{ selected: markType === item.value }" @click="emit('update:markType', item.value)"><component :is="item.icon" :size="16" aria-hidden="true" /></button>
        <button class="icon-tool" type="button" :disabled="locked" title="清除当前标记" aria-label="清除当前标记" @click="emit('clear-marks')"><Eraser :size="16" aria-hidden="true" /></button>
      </template>
      <template v-else>
        <button v-for="stone in (['black', 'white'] as const)" :key="stone" class="icon-tool" type="button" :disabled="locked" :title="mode === 'setup' ? (stone === 'black' ? '摆黑子' : '摆白子') : (stone === 'black' ? '黑方落子' : '白方落子')" :aria-label="mode === 'setup' ? (stone === 'black' ? '摆黑子' : '摆白子') : (stone === 'black' ? '黑方落子' : '白方落子')" :aria-pressed="(mode === 'setup' ? setupStone : currentPlayer) === stone" :class="{ selected: (mode === 'setup' ? setupStone : currentPlayer) === stone }" @click="mode === 'setup' ? emit('update:setupStone', stone) : emit('update:currentPlayer', stone)"><span class="stone-swatch" :class="stone" /></button>
        <button v-if="mode === 'setup'" class="icon-tool" type="button" :disabled="locked" title="擦除棋子" aria-label="擦除棋子" :aria-pressed="setupStone === null" :class="{ selected: setupStone === null }" @click="emit('update:setupStone', null)"><Eraser :size="16" aria-hidden="true" /></button>
        <span class="turn-label">{{ currentPlayer === 'black' ? '黑方' : '白方' }}落子</span>
      </template>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.research-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; min-width: 0; min-height: 52px; padding: 8px 18px; border-bottom: 1px solid var(--border); background: rgba(243,242,241,.2); backdrop-filter: blur(2px); }
.tool-segment { display: grid; box-sizing: border-box; min-width: 184px; height: 38px; min-height: 38px; flex: 0 0 auto; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2px; padding: 3px; border: 1px solid var(--border); border-radius: 6px; background: rgba(237,235,233,.72); }
.tool-context { display: flex; align-items: center; gap: 3px; min-height: 34px; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 10px; border: 1px solid transparent; border-radius: 4px; color: var(--muted); background: transparent; font-size: 12px; }
.tool-segment button { min-width: 0; min-height: 0; height: auto; padding: 0 8px; color: var(--muted); font-weight: 500; white-space: nowrap; transition: border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out; }
.tool-segment button:hover:not(:disabled):not(.selected) { border-color: rgba(255, 255, 255, .6); color: var(--text); background: rgba(255, 255, 255, .62); }
.tool-segment button.selected { border-color: rgba(var(--accent-rgb), .16); color: var(--accent-strong); background: var(--surface); box-shadow: var(--shadow-xs); font-weight: 600; }
.tool-segment button:active:not(:disabled) { transform: scale(.97); }
button:hover:not(:disabled) { color: var(--text); background: var(--surface-muted); }
button.selected { color: var(--accent-strong); border-color: var(--accent-16); background: var(--surface); box-shadow: var(--shadow-xs); }
button:disabled { opacity: .45; }
.icon-tool { width: 32px; padding: 0; }
.stone-swatch { width: 16px; height: 16px; border-radius: 50%; background-position: center; background-size: contain; }
.stone-swatch.black { background-image: url('/board-themes/classic/stone-black.svg'); }
.stone-swatch.white { background-image: url('/board-themes/classic/stone-white.svg'); }
.turn-label { color: var(--muted); margin-left: 5px; font-size: 11px; }
@media (max-width: 600px) { .research-tools { padding: 8px 12px; gap: 6px; } .turn-label { display: none; } }
@media (prefers-reduced-motion: reduce) { .tool-segment button { transition: none; } }
</style>
