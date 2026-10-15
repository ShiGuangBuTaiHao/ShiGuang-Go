<script setup lang="ts">
import { computed } from 'vue'
import type { PreviewPosition } from '../../domain/sgf'
import type { BoardStyle } from '../../domain/boardTheme'
const props = defineProps<{
  position: PreviewPosition
  coordinates?: boolean
  moveNumbers?: boolean
  boardStyle?: BoardStyle
}>()
const size = computed(() => props.position.board.length)
const cell = computed(() => 368 / (size.value - 1))
const lines = computed(() =>
  Array.from({ length: size.value }, (_, index) => 36 + index * cell.value),
)
const stars = computed(() => {
  const locations =
    size.value === 19
      ? [3, 9, 15]
      : size.value === 13
        ? [3, 6, 9]
        : size.value === 9
          ? [2, 4, 6]
          : []
  return locations.flatMap((row) => locations.map((col) => ({ row, col })))
})
const stones = computed(() =>
  props.position.board.flatMap((row, y) =>
    row.flatMap((stone, x) => (stone ? [{ stone, x, y }] : [])),
  ),
)
</script>

<template>
  <svg
    class="record-board"
    viewBox="0 0 440 440"
    role="img"
    :aria-label="`${size} 路棋盘，第 ${position.moveNumber} 手`"
  >
    <rect width="440" height="440" rx="4" :fill="props.boardStyle === 'minimal' ? '#e4d3ad' : props.boardStyle === 'glassmorphism' ? '#d9e0dc' : '#d8b984'" />
    <image v-if="props.boardStyle !== 'minimal' && props.boardStyle !== 'glassmorphism'"
      href="/board-themes/classic/board-wood.jpg"
      width="440"
      height="440"
      opacity=".65"
      preserveAspectRatio="xMidYMid slice"
    />
    <g stroke="#635334" stroke-width=".85">
      <template v-for="(line, index) in lines" :key="index">
        <path :d="`M36 ${line}H404 M${line} 36V404`" />
      </template>
    </g>
    <g fill="#635334">
      <circle
        v-for="star in stars"
        :key="`${star.row}-${star.col}`"
        :cx="36 + star.col * cell"
        :cy="36 + star.row * cell"
        r="2.6"
      />
    </g>
    <g v-if="coordinates" fill="#635334" font-size="10" text-anchor="middle">
      <template v-for="(line, index) in lines" :key="index">
        <text :x="line" y="19">{{ 'ABCDEFGHJKLMNOPQRST'[index] }}</text>
        <text x="17" :y="line + 3">{{ size - index }}</text>
      </template>
    </g>
    <g v-for="stone in stones" :key="`${stone.x}-${stone.y}`">
    <circle :cx="36 + stone.x * cell" :cy="36 + stone.y * cell" :r="cell * 0.42" :fill="stone.stone === 'black' ? '#252727' : '#f9f9f7'" :stroke="stone.stone === 'black' ? '#090a0a' : '#a19f9d'" stroke-width=".6" />
    <image
      :href="`/board-themes/classic/stone-${stone.stone}.svg`"
      :x="36 + stone.x * cell - cell * 0.47"
      :y="36 + stone.y * cell - cell * 0.47"
      :width="cell * 0.94"
      :height="cell * 0.94"
    />
    </g>
    <g v-if="moveNumbers" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" :font-size="Math.max(8, cell * 0.42)" font-weight="600">
      <text v-for="mark in position.moveNumbers" :key="`${mark.row}-${mark.col}`" :x="36 + mark.col * cell" :y="36 + mark.row * cell" :fill="mark.stone === 'black' ? '#fff' : '#222'">{{ mark.moveNumber }}</text>
    </g>
    <circle
      v-if="position.lastMove"
      :cx="36 + position.lastMove.col * cell"
      :cy="36 + position.lastMove.row * cell"
      :r="cell * 0.17"
      fill="none"
      :stroke="position.lastMove.stone === 'black' ? '#ffffff' : '#323130'"
      stroke-width="1.8"
    />
  </svg>
</template>

<style scoped>
.record-board {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 1;
  border: 1px solid rgba(99, 83, 52, 0.2);
  border-radius: 4px;
}
</style>
