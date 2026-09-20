<script setup lang="ts">
import { ArrowLeft, FileUp, FolderOpen, Search } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <main class="library-page">
    <header class="library-header">
      <button class="back-button" type="button" aria-label="返回主菜单" title="返回主菜单" @click="router.push({ name: 'mode-select' })"><ArrowLeft :size="17" /></button>
      <div class="page-title"><span>研究</span><h1>本地棋谱库</h1></div>
      <div class="library-actions"><button class="toolbar-button" type="button" disabled><FileUp :size="16" />导入 SGF</button><button class="toolbar-button" type="button" disabled>新建棋谱</button></div>
    </header>
    <section class="library-content">
      <div class="library-toolbar"><label class="search-field"><Search :size="16" /><input type="search" placeholder="搜索棋手、日期或结果" disabled /></label><span>0 局棋谱</span></div>
      <div class="library-empty"><div class="empty-icon"><FolderOpen :size="24" /></div><h2>棋谱库还是空的</h2><p>保存的对局和导入的 SGF 会出现在这里。</p><button class="empty-action" type="button" disabled>导入第一份棋谱</button></div>
    </section>
  </main>
</template>

<style scoped>
.library-page { display: flex; min-height: 0; flex: 1; flex-direction: column; overflow: auto; background: var(--shell); color: var(--text); }.library-header { display: flex; min-height: 68px; align-items: center; gap: 14px; padding: 0 24px; border-bottom: 1px solid var(--border); background: var(--surface); }.back-button { display: grid; width: 36px; height: 36px; place-items: center; border: 1px solid var(--border); border-radius: 6px; color: var(--text); background: var(--surface); }.back-button:hover { border-color: var(--accent); color: var(--accent-strong); background: var(--accent-soft); }.page-title { display: grid; gap: 3px; }.page-title span { color: var(--text-subtle); font-size: 10px; font-weight: 700; letter-spacing: .08em; }.page-title h1 { margin: 0; font-size: 18px; }.library-actions { display: flex; gap: 8px; margin-left: auto; }.toolbar-button, .empty-action { display: inline-flex; min-height: 34px; align-items: center; gap: 7px; padding: 0 11px; border: 1px solid var(--border); border-radius: 5px; color: var(--text); background: var(--surface); font: inherit; font-size: 12px; }.toolbar-button:disabled, .empty-action:disabled { cursor: not-allowed; opacity: .48; }.library-content { width: min(1120px, calc(100% - 48px)); min-height: 0; flex: 1; margin: 0 auto; padding: 24px 0 48px; }.library-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; color: var(--muted); font-size: 11px; }.search-field { display: flex; width: min(360px, 100%); min-height: 36px; align-items: center; gap: 8px; padding: 0 10px; border: 1px solid var(--border); border-radius: 5px; color: var(--muted); background: var(--surface); }.search-field input { width: 100%; border: 0; outline: 0; color: var(--text); background: transparent; font: inherit; font-size: 12px; }.library-empty { display: grid; justify-items: center; gap: 9px; margin-top: 72px; padding: 56px 20px; border: 1px dashed var(--border); border-radius: 6px; text-align: center; }.empty-icon { display: grid; width: 50px; height: 50px; place-items: center; border-radius: 8px; color: var(--accent); background: var(--accent-soft); }.library-empty h2 { margin: 4px 0 0; font-size: 18px; }.library-empty p { margin: 0; color: var(--muted); font-size: 12px; }.empty-action { margin-top: 9px; border-color: var(--accent); color: #fff; background: var(--accent); }.empty-action:disabled { opacity: .55; }
@media (max-width: 620px) { .library-header { padding: 0 16px; }.library-actions .toolbar-button { padding: 0 8px; }.library-actions .toolbar-button svg { display: none; }.library-content { width: min(440px, calc(100% - 24px)); padding-top: 18px; }.library-toolbar { align-items: stretch; flex-direction: column; }.search-field { width: 100%; }.library-empty { margin-top: 32px; padding: 44px 16px; } }
</style>
