<script setup lang="ts">
import { ref } from 'vue'
import { ChevronDown, ChevronRight, Clock3, Database, Folder, FolderPlus, Layers3, MoreHorizontal, Star, Tag, Trash2 } from 'lucide-vue-next'
import type { RecordCollection } from '../../types/library'

defineProps<{
  category: string; counts: Record<string, number>; collections: RecordCollection[]
  tags: string[]; collectionCounts: Record<string, number>; tagCounts: Record<string, number>
}>()
const emit = defineEmits<{ select: [category: string]; createCollection: []; manageCollection: [collection: RecordCollection] }>()
const collectionsExpanded = ref(true), tagsExpanded = ref(true)
const views = [
  { id: 'all', label: '全部棋谱', icon: Layers3 }, { id: 'recent', label: '历史对局', icon: Clock3 },
  { id: 'favorites', label: '我的收藏', icon: Star },
  { id: 'trash', label: '回收站', icon: Trash2 },
]
</script>

<template>
  <nav class="library-navigation workspace-surface" aria-label="棋谱分类">
    <div class="navigation-scroll">
      <section class="navigation-section" aria-label="快捷分类">
        <button v-for="item in views" :key="item.id" class="library-nav-item" :class="{ selected: category === item.id }" :aria-current="category === item.id ? 'page' : undefined" type="button" @click="emit('select', item.id)">
          <component :is="item.icon" :size="17" aria-hidden="true" /><span>{{ item.label }}</span><small>{{ counts[item.id] ?? 0 }}</small>
        </button>
      </section>
      <section class="navigation-section navigation-list-section">
        <div class="navigation-group-heading">
          <button class="group-toggle" type="button" :aria-expanded="collectionsExpanded" aria-controls="library-collections" @click="collectionsExpanded = !collectionsExpanded"><component :is="collectionsExpanded ? ChevronDown : ChevronRight" :size="14" /><span>棋谱集合</span><small>{{ collections.length }}</small></button>
          <button class="workspace-icon" type="button" title="新建棋谱集" aria-label="新建棋谱集" @click="collectionsExpanded = true; emit('createCollection')"><FolderPlus :size="16" /></button>
        </div>
        <div v-show="collectionsExpanded" id="library-collections" class="navigation-list-scroll">
          <div v-for="item in collections" :key="item.id" class="collection-nav-row" :class="{ selected: category === item.id }">
            <button class="library-nav-item" :aria-current="category === item.id ? 'page' : undefined" :title="item.name" type="button" @click="emit('select', item.id)"><Folder :size="16" /><span>{{ item.name }}</span><small>{{ collectionCounts[item.id] ?? 0 }}</small></button>
            <button class="workspace-icon collection-command" type="button" :aria-label="`管理棋谱集 ${item.name}`" title="管理棋谱集" @click="emit('manageCollection', item)"><MoreHorizontal :size="15" /></button>
          </div>
          <p v-if="!collections.length" class="navigation-placeholder">暂无棋谱集</p>
        </div>
      </section>
      <section class="navigation-section navigation-list-section">
        <div class="navigation-group-heading"><button class="group-toggle" type="button" :aria-expanded="tagsExpanded" aria-controls="library-tags" @click="tagsExpanded = !tagsExpanded"><component :is="tagsExpanded ? ChevronDown : ChevronRight" :size="14" /><span>标签</span><small>{{ tags.length }}</small></button><Tag :size="14" /></div>
        <div v-show="tagsExpanded" id="library-tags" class="navigation-list-scroll tag-list-scroll">
          <button v-for="tag in tags" :key="tag" class="library-nav-item" :class="{ selected: category === `tag:${tag}` }" :aria-current="category === `tag:${tag}` ? 'page' : undefined" :title="tag" type="button" @click="emit('select', `tag:${tag}`)"><Tag :size="14" /><span>{{ tag }}</span><small>{{ tagCounts[tag] ?? 0 }}</small></button>
          <p v-if="!tags.length" class="navigation-placeholder">暂无标签</p>
        </div>
      </section>
    </div>
    <footer class="navigation-footer">
      <div class="storage-label"><Database :size="13" /><span>本地棋谱库</span><small>{{ counts.all ?? 0 }} 局</small></div>
    </footer>
  </nav>
</template>

<style scoped>
.library-navigation { display: flex; width: 100%; min-width: 0; min-height: 0; flex: 1; flex-direction: column; overflow: hidden; border-right: 1px solid var(--border); }
.navigation-scroll { display: flex; min-height: 0; flex: 1; flex-direction: column; overflow-y: auto; padding: 0 10px; }
.navigation-section { padding-bottom: 16px; }
.navigation-section + .navigation-section { border-top: 1px solid rgba(225, 225, 225, .7); padding-top: 12px; }
.navigation-list-section { display: flex; min-height: 0; flex: 1 1 0; flex-direction: column; }
.navigation-section[aria-label="快捷分类"] { display: grid; box-sizing: border-box; width: 100%; gap: 2px; padding: 3px; margin: 8px 0 16px; border: 1px solid var(--border); border-radius: 6px; background: rgba(237, 235, 233, .72); }
.navigation-section[aria-label="快捷分类"] .library-nav-item { min-height: 36px; padding-inline: 8px; border-color: transparent; border-radius: 4px; font-weight: 500; transition: border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out; }
.navigation-section[aria-label="快捷分类"] .library-nav-item:hover:not(.selected) { border-color: rgba(255, 255, 255, .6); color: var(--text); background: rgba(255, 255, 255, .62); }
.navigation-section[aria-label="快捷分类"] .library-nav-item.selected { border-color: rgba(var(--accent-rgb), .16); color: var(--accent-strong); background: var(--surface); box-shadow: var(--shadow-xs); font-weight: 600; }
.navigation-section[aria-label="快捷分类"] .library-nav-item:active { transform: scale(.97); }
.library-nav-item { display: flex; width: 100%; min-width: 0; min-height: 38px; align-items: center; gap: 10px; padding: 7px 10px; border: 1px solid transparent; border-radius: 5px; text-align: left; color: var(--muted); background: transparent; font-size: 12px; transition: background-color 150ms, color 150ms; }
.library-nav-item > span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.library-nav-item svg { flex-shrink: 0; }
.library-nav-item small { flex-shrink: 0; font-size: 11px; font-variant-numeric: tabular-nums; font-weight: 400; }
.library-nav-item:hover { color: var(--text); background: rgba(255, 255, 255, .6); }
.library-nav-item.selected { border-color: rgba(var(--accent-rgb), .2); color: var(--accent-strong); background: var(--surface); box-shadow: var(--shadow-xs); font-weight: 600; }
.library-nav-item.selected { box-shadow: inset 3px 0 var(--accent), var(--shadow-xs); }
.navigation-group-heading { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 34px; margin-bottom: 4px; padding-right: 10px; color: var(--muted); }
.group-toggle { display: flex; flex: 1; min-width: 0; align-items: center; gap: 6px; padding: 8px 2px; border: 0; background: transparent; color: var(--muted); font-size: 11px; font-weight: 600; text-align: left; }
.group-toggle small { margin-left: auto; font-size: 10px; font-weight: 400; }
.navigation-group-heading .workspace-icon { width: 26px; height: 26px; flex-basis: 26px; }
.navigation-list-scroll { min-height: 0; flex: 1; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.navigation-list-scroll::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
.navigation-list-scroll#library-collections { display: flex; box-sizing: border-box; flex-direction: column; gap: 2px; padding: 3px; border: 1px solid var(--border); border-radius: 6px; background: rgba(237, 235, 233, .72); }
.navigation-list-scroll#library-tags { display: flex; box-sizing: border-box; flex-direction: column; gap: 2px; padding: 3px; border: 1px solid var(--border); border-radius: 6px; background: rgba(237, 235, 233, .72); }
.navigation-list-scroll#library-tags .library-nav-item { min-height: 36px; padding-inline: 8px; border-radius: 4px; font-weight: 500; transition: border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out; }
.navigation-list-scroll#library-tags .library-nav-item:hover:not(.selected) { border-color: rgba(255, 255, 255, .6); color: var(--text); background: rgba(255, 255, 255, .62); }
.navigation-list-scroll#library-tags .library-nav-item.selected { border-color: rgba(var(--accent-rgb), .16); color: var(--accent-strong); background: var(--surface); box-shadow: var(--shadow-xs); font-weight: 600; }
.navigation-list-scroll#library-tags .library-nav-item:active { transform: scale(.97); }
.collection-nav-row { display: flex; min-height: 38px; align-items: center; border: 1px solid transparent; border-radius: 4px; color: var(--muted); transition: border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out; }
.collection-nav-row .library-nav-item { min-height: 36px; flex: 1; padding-inline: 8px; border-radius: 4px; color: inherit; font-weight: 500; transition: border-color 150ms ease-out, color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out; }
.collection-nav-row:hover:not(.selected) { border-color: rgba(255, 255, 255, .6); color: var(--text); background: rgba(255, 255, 255, .62); }
.collection-nav-row.selected { border-color: rgba(var(--accent-rgb), .16); color: var(--accent-strong); background: var(--surface); box-shadow: var(--shadow-xs); font-weight: 600; }
.collection-nav-row:active { transform: scale(.97); }
.collection-nav-row .library-nav-item:hover { background: transparent; }
.collection-command { width: 24px; height: 30px; flex-basis: 24px; margin-right: 3px; }
.navigation-placeholder { margin: 6px 10px; color: var(--muted); font-size: 11px; }
.navigation-footer { display: flex; height: 60px; flex: 0 0 60px; align-items: center; padding: 0 10px; border-top: 0; }
.storage-label { display: flex; width: 100%; align-items: center; gap: 7px; padding: 0 10px; color: var(--muted); font-size: 11px; }
.storage-label small { margin-left: auto; font-size: 10px; }
@media (pointer: coarse) { .library-nav-item { min-height: 44px; } }
</style>
