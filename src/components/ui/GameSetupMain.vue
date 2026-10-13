<script setup lang="ts">
import { computed } from 'vue'
import SetupDropdown, { type SetupDropdownOption } from './SetupDropdown.vue'
import type { GameSetup } from '../../domain/gameSetup'

const props = withDefaults(defineProps<{
  setup: GameSetup
  eyebrow?: string
  playerColorOptions: SetupDropdownOption[]
  playerColorLabel?: string
  playerColorAriaLabel?: string
  ruleOptions: SetupDropdownOption[]
  handicapOptions: SetupDropdownOption[]
  timeOptions: SetupDropdownOption[]
  customMainTimeOptions: SetupDropdownOption[]
  customByoYomiOptions: SetupDropdownOption[]
  customPeriodOptions: SetupDropdownOption[]
  komiLabel: string
  showPassword?: boolean
  password?: string
  passwordPlaceholder?: string
}>(), {
  playerColorLabel: '对局方式',
  playerColorAriaLabel: '选择执棋方式',
  eyebrow: '房间设置',
  showPassword: false,
  password: '',
  passwordPlaceholder: '不填写则无需密码',
})

const emit = defineEmits<{
  (event: 'update:playerColor', value: GameSetup['playerColor']): void
  (event: 'update:ruleSet', value: GameSetup['ruleSet']): void
  (event: 'update:handicap', value: string): void
  (event: 'update:timePreset', value: string): void
  (event: 'update:mainTimeSeconds', value: string): void
  (event: 'update:byoYomiSeconds', value: string): void
  (event: 'update:byoYomiPeriods', value: string): void
  (event: 'update:password', value: string): void
}>()

function updatePlayerColor(value: string) {
  emit('update:playerColor', value as GameSetup['playerColor'])
}

function updateRuleSet(value: string) {
  emit('update:ruleSet', value as GameSetup['ruleSet'])
}

function updatePassword(event: Event) {
  emit('update:password', (event.target as HTMLInputElement).value)
}

const visibleSummaryItems = computed(() => {
  const rule = props.ruleOptions.find((option) => option.value === props.setup.ruleSet)?.label ?? '中国规则'
  const player = (props.playerColorOptions.find((option) => option.value === props.setup.playerColor) ?? props.playerColorOptions[0])?.label ?? '执黑'
  const handicap = props.handicapOptions.find((option) => option.value === String(props.setup.handicap))?.label ?? '分先'
  const time = props.timeOptions.find((option) => option.value === props.setup.timeControl.preset)?.label ?? '普通'
  return ['19 路棋盘', rule, player, handicap, `黑贴 ${props.komiLabel}`, time]
})
</script>

<template>
  <div class="setup-main">
    <div class="setup-heading">
      <span>{{ props.eyebrow }}</span>
    </div>
    <div class="setup-summary" aria-live="polite">
      <span v-for="(item, index) in visibleSummaryItems" :key="`${index}-${item}`" :class="{ primary: index === 0 }">{{ item }}</span>
    </div>

    <div class="setup-grid">
      <div class="setup-field">
        <div class="field-label"><span>{{ props.playerColorLabel }}</span></div>
        <SetupDropdown
          :model-value="props.setup.playerColor"
          :options="props.playerColorOptions"
          :ariaLabel="props.playerColorAriaLabel"
          @update:model-value="updatePlayerColor"
        />
      </div>

      <div class="setup-field">
        <div class="field-label"><span>规则</span></div>
        <SetupDropdown
          :model-value="props.setup.ruleSet"
          :options="props.ruleOptions"
          ariaLabel="选择规则"
          @update:model-value="updateRuleSet"
        />
      </div>

      <div class="setup-field">
        <div class="field-label"><span>让子</span><span class="field-meta">黑贴 <b>{{ props.komiLabel }}</b></span></div>
        <SetupDropdown
          :model-value="String(props.setup.handicap)"
          :options="props.handicapOptions"
          ariaLabel="选择让子方式"
          @update:model-value="(value) => emit('update:handicap', value)"
        />
      </div>

      <div class="setup-field">
        <div class="field-label"><span>用时</span></div>
        <SetupDropdown
          :model-value="props.setup.timeControl.preset"
          :options="props.timeOptions"
          ariaLabel="选择用时方案"
          @update:model-value="(value) => emit('update:timePreset', value)"
        />
      </div>

      <div v-if="props.setup.timeControl.preset === 'custom'" class="custom-time-grid setup-field-wide">
        <div class="custom-time-field">
          <span>主时间</span>
          <SetupDropdown :model-value="String(props.setup.timeControl.mainTimeSeconds)" :options="props.customMainTimeOptions" ariaLabel="选择主时间" @update:model-value="(value) => emit('update:mainTimeSeconds', value)" />
        </div>
        <div class="custom-time-field">
          <span>读秒时间</span>
          <SetupDropdown :model-value="String(props.setup.timeControl.byoYomiSeconds)" :options="props.customByoYomiOptions" ariaLabel="选择读秒时间" @update:model-value="(value) => emit('update:byoYomiSeconds', value)" />
        </div>
        <div class="custom-time-field">
          <span>读秒次数</span>
          <SetupDropdown :model-value="String(props.setup.timeControl.byoYomiPeriods)" :options="props.customPeriodOptions" ariaLabel="选择读秒次数" @update:model-value="(value) => emit('update:byoYomiPeriods', value)" />
        </div>
      </div>

      <div v-if="props.showPassword" class="setup-field setup-field-wide input-field">
        <div class="field-label"><span>房间密码（可选）</span></div>
        <input :value="props.password" type="text" maxlength="32" aria-label="房间密码（可选）" :placeholder="props.passwordPlaceholder" autocomplete="new-password" @input="updatePassword" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.setup-main { min-width: 0; }
.setup-heading { display: grid; gap: 3px; margin-bottom: 12px; }
.setup-heading > span { color: var(--muted); font-size: 11px; }
.setup-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 18px; margin-bottom: 16px; padding: 10px 12px; border: 1px solid rgba(225, 225, 225, .9); border-radius: 6px; color: var(--muted); background: rgba(255, 255, 255, .4); font-size: 12px; }
.setup-summary .primary { color: var(--text); font-weight: 600; }
.setup-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 24px; }
.setup-field { display: grid; min-width: 0; gap: 6px; color: var(--text); font-size: 12px; font-weight: 600; }
.setup-field-wide { grid-column: 1 / -1; }
.field-label { display: flex; min-height: 17px; align-items: baseline; justify-content: space-between; gap: 8px; }
.field-meta { color: var(--muted); font-size: 11px; font-weight: 400; }
.field-meta b { color: var(--accent); font-size: 12px; font-weight: 600; }
.setup-main :deep(.setup-dropdown) { width: 100%; }
.setup-main :deep(.setup-dropdown-trigger) { min-height: 50px; background: rgba(255, 255, 255, .48); }
.custom-time-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.custom-time-field { display: grid; gap: 5px; min-width: 0; }
.custom-time-field > span { color: var(--muted); font-size: 11px; }
.input-field input { width: 100%; min-height: 50px; padding: 0 12px; font: inherit; }
@media (max-width: 680px) {
  .setup-grid { grid-template-columns: minmax(0, 1fr); }
  .setup-field-wide { grid-column: auto; }
  .custom-time-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
