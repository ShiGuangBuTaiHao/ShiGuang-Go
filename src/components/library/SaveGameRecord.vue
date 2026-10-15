<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, LoaderCircle, Save } from 'lucide-vue-next'
import { saveGameHistory, saveGameRecord } from '../../services/library'
import type { GameSnapshot } from '../../types/game'
import type { RuleSet } from '../../domain/gameSetup'
const props = defineProps<{ snapshot: GameSnapshot; black: string; white: string; ruleSet: RuleSet; komi: number; auto?: boolean; historyOnly?: boolean }>()
const busy = ref(false), saved = ref(false), historySaved = ref(false), error = ref('')
const key = computed(() => JSON.stringify([props.snapshot.moves, props.snapshot.result, props.komi, props.ruleSet]))
watch(key, () => { saved.value = false; historySaved.value = false; error.value = '' })
watch(() => props.snapshot.status, (status) => { if (props.auto && status === 'finished') void save(true) }, { immediate: true })
async function save(toHistory = false) {
  if (busy.value || (toHistory ? historySaved.value : saved.value)) return
  const positionKey = key.value
  busy.value = true; error.value = ''
  try {
    const winner = props.snapshot.result?.winner
    const title = winner
      ? `${winner === 'black' ? props.black : props.white} 获胜`
      : '双方和棋'
    const info = { title, black: props.black, white: props.white, ruleSet: props.ruleSet, komi: props.komi, boardSize: props.snapshot.board.length, date: new Date().toLocaleDateString('en-CA') }
    if (toHistory) await saveGameHistory(props.snapshot, info)
    else await saveGameRecord(props.snapshot, info)
    if (key.value === positionKey) {
      if (toHistory) historySaved.value = true
      else saved.value = true
    }
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}
</script>
<template><div v-if="!historyOnly" class="save-game-record"><button type="button" :disabled="busy || saved" @click="save()"><LoaderCircle v-if="busy" class="saving" :size="14" /><Check v-else-if="saved" :size="14" /><Save v-else :size="14" />{{ saved ? '已保存到全部棋谱' : busy ? '保存中' : '保存到全部棋谱' }}</button><p v-if="historySaved" class="history-saved">已自动存入历史对局</p><p v-if="error" role="alert">{{ error }}</p></div></template>
<style scoped>
.save-game-record button { display: inline-flex; min-height: 34px; align-items: center; justify-content: center; gap: 6px; padding: 0 11px; border: 1px solid var(--border); border-radius: 5px; color: var(--text); background: var(--surface); font: inherit; font-size: 12px; }.save-game-record button:hover:not(:disabled) { color: var(--accent-strong); border-color: var(--accent); background: var(--accent-soft); }.save-game-record button:disabled { opacity: .65; }.save-game-record p { max-width: 260px; margin: 5px 0 0; color: var(--danger); font-size: 11px; }.saving { animation: save-game-spin 1s linear infinite; }@keyframes save-game-spin { to { transform: rotate(360deg); } }
.save-game-record .history-saved { color: var(--muted); }
</style>
