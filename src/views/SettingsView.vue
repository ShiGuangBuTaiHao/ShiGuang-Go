<script setup lang="ts">
import { ref } from 'vue'
import { ArrowLeft, Check, Cpu, Eye, MonitorCog, RotateCcw } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

const router = useRouter()
const showMoveNumbers = ref(true)
const showCandidates = ref(true)
const followSystem = ref(true)

function resetSettings() {
  showMoveNumbers.value = true
  showCandidates.value = true
  followSystem.value = true
}
</script>

<template>
  <main class="settings-page">
    <header class="settings-header">
      <button class="back-button" type="button" aria-label="返回主菜单" title="返回主菜单" @click="router.push({ name: 'mode-select' })"><ArrowLeft :size="17" /></button>
      <div class="page-title"><span>应用</span><h1>设置</h1></div>
      <span class="saved-state"><Check :size="14" />本地设置</span>
    </header>
    <section class="settings-layout">
      <nav class="settings-nav" aria-label="设置分类"><a class="selected" href="#game"><MonitorCog :size="16" />对局显示</a><a href="#analysis"><Cpu :size="16" />分析引擎</a><a href="#appearance"><Eye :size="16" />外观</a></nav>
      <div class="settings-content">
        <section id="game" class="settings-section"><div class="settings-section-heading"><span class="section-kicker">对局显示</span><h2>让棋盘保持清晰</h2></div><label class="setting-row"><span><strong>显示手数</strong><small>在棋子上标记落子顺序</small></span><input v-model="showMoveNumbers" type="checkbox" /></label><label class="setting-row"><span><strong>显示推荐落点</strong><small>分析完成后在棋盘上标记候选点</small></span><input v-model="showCandidates" type="checkbox" /></label></section>
        <section id="analysis" class="settings-section"><div class="settings-section-heading"><span class="section-kicker">分析引擎</span><h2>KataGo 本地服务</h2></div><div class="diagnostic-row"><div><strong>当前运行时</strong><small>使用应用内置的 KataGo 与模型资源</small></div><span class="diagnostic-status"><i />已配置</span></div><div class="diagnostic-row"><div><strong>快速分析</strong><small>用于推荐落点和人机对局</small></div><span class="value-label">按需调用</span></div></section>
        <section id="appearance" class="settings-section"><div class="settings-section-heading"><span class="section-kicker">外观</span><h2>保持专注</h2></div><label class="setting-row"><span><strong>跟随系统主题</strong><small>当前桌面端默认使用浅色工作区</small></span><input v-model="followSystem" type="checkbox" /></label></section>
        <button class="reset-button" type="button" @click="resetSettings"><RotateCcw :size="15" />恢复默认设置</button>
        <footer class="settings-about" aria-label="软件信息"><span>时光围棋 v1.1.0</span><span>KataGo · 本地 TensorRT 引擎</span></footer>
      </div>
    </section>
  </main>
</template>

<style scoped>
.settings-page { display: flex; min-height: 0; flex: 1; flex-direction: column; overflow: auto; background: var(--shell); color: var(--text); }.settings-header { display: flex; min-height: 68px; align-items: center; gap: 14px; padding: 0 24px; border-bottom: 1px solid var(--border); background: var(--surface); }.back-button { display: grid; width: 36px; height: 36px; place-items: center; border: 1px solid var(--border); border-radius: 6px; color: var(--text); background: var(--surface); }.back-button:hover { border-color: var(--accent); color: var(--accent-strong); background: var(--accent-soft); }.page-title { display: grid; gap: 3px; }.page-title span, .section-kicker { color: var(--text-subtle); font-size: 10px; font-weight: 700; letter-spacing: .08em; }.page-title h1 { margin: 0; font-size: 18px; }.saved-state { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; color: var(--accent); font-size: 11px; }.settings-layout { display: grid; width: min(940px, calc(100% - 48px)); min-height: 0; flex: 1; grid-template-columns: 180px minmax(0, 1fr); gap: 48px; margin: 0 auto; padding: 32px 0 48px; }.settings-nav { display: grid; align-content: start; gap: 4px; }.settings-nav a { display: flex; min-height: 36px; align-items: center; gap: 8px; padding: 0 10px; border-radius: 5px; color: var(--muted); font-size: 12px; text-decoration: none; }.settings-nav a.selected, .settings-nav a:hover { color: var(--text); background: var(--surface); box-shadow: var(--shadow-xs); }.settings-content { min-width: 0; }.settings-section { padding: 0 0 24px; margin-bottom: 24px; border-bottom: 1px solid var(--border); }.settings-section-heading { display: grid; gap: 5px; margin-bottom: 14px; }.settings-section-heading h2 { margin: 0; font-size: 18px; }.setting-row, .diagnostic-row { display: flex; min-height: 58px; align-items: center; justify-content: space-between; gap: 20px; padding: 0 12px; border-top: 1px solid var(--border); }.setting-row span, .diagnostic-row div { display: grid; gap: 5px; }.setting-row strong, .diagnostic-row strong { font-size: 13px; }.setting-row small, .diagnostic-row small { color: var(--muted); font-size: 11px; }.setting-row input { width: 40px; height: 22px; accent-color: var(--accent); }.diagnostic-status { display: inline-flex; align-items: center; gap: 6px; color: var(--accent); font-size: 11px; }.diagnostic-status i { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }.value-label { color: var(--muted); font-size: 11px; }.reset-button { display: inline-flex; min-height: 36px; align-items: center; gap: 7px; padding: 0 12px; border: 1px solid var(--border); border-radius: 5px; color: var(--muted); background: var(--surface); font: inherit; font-size: 12px; }.reset-button:hover { border-color: var(--accent); color: var(--accent-strong); background: var(--accent-soft); }
.settings-about { display: flex; flex-wrap: wrap; gap: 8px 24px; margin-top: 32px; color: var(--muted); font-size: 12px; line-height: 1.5; }
@media (max-width: 700px) { .settings-header { padding: 0 16px; }.settings-layout { display: block; width: min(520px, calc(100% - 24px)); padding-top: 18px; }.settings-nav { display: flex; overflow-x: auto; margin-bottom: 28px; }.settings-nav a { flex: 0 0 auto; }.settings-section-heading h2 { font-size: 17px; } }
</style>
