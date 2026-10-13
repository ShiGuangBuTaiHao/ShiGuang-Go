<script setup lang="ts">
import {
  BookOpen,
  Clock3,
  Folder,
  FolderPlus,
  Layers3,
  MoreHorizontal,
  Star,
  Tag,
  Trash2,
} from 'lucide-vue-next'
import type { RecordCollection } from '../../types/library'
defineProps<{
  category: string
  counts: Record<string, number>
  collections: RecordCollection[]
  tags: string[]
  collectionCounts: Record<string, number>
  tagCounts: Record<string, number>
}>()
const emit = defineEmits<{ select: [category: string]; createCollection: []; manageCollection: [collection: RecordCollection] }>()
const views = [
  { id: 'all', label: '全部棋谱', icon: Layers3 },
  { id: 'recent', label: '最近打开', icon: Clock3 },
  { id: 'favorites', label: '我的收藏', icon: Star },
  { id: 'pending', label: '待复盘', icon: BookOpen },
]
</script>

<template>
  <nav class="library-navigation" aria-label="棋谱分类">
    <div class="nav-section">
      <button
        v-for="item in views"
        :key="item.id"
        class="library-nav-item"
        :class="{ selected: category === item.id }"
        :aria-current="category === item.id ? 'page' : undefined"
        type="button"
        @click="emit('select', item.id)"
      >
        <component :is="item.icon" :size="17" /><span>{{ item.label }}</span
        ><small>{{ counts[item.id] ?? 0 }}</small>
      </button>
    </div>
    <div class="nav-section">
      <div class="nav-heading">
        <h2>棋谱集</h2>
        <button
          class="lib-icon"
          type="button"
          title="新建棋谱集"
          aria-label="新建棋谱集"
          @click="emit('createCollection')"
        >
          <FolderPlus :size="16" />
        </button>
      </div>
      <div v-for="item in collections" :key="item.id" class="collection-nav-row"><button
        class="library-nav-item"
        :class="{ selected: category === item.id }"
        type="button"
        @click="emit('select', item.id)"
      >
        <Folder :size="16" /><span>{{ item.name }}</span
        ><small>{{ collectionCounts[item.id] ?? 0 }}</small>
      </button><button class="lib-icon collection-command" type="button" :aria-label="`管理棋谱集 ${item.name}`" title="管理棋谱集" @click="emit('manageCollection', item)"><MoreHorizontal :size="14" /></button></div>
      <span v-if="!collections.length" class="nav-placeholder">尚无棋谱集</span>
    </div>
    <div v-if="tags.length" class="nav-section">
      <div class="nav-heading">
        <h2>标签</h2>
        <Tag :size="14" />
      </div>
      <button
        v-for="tag in tags"
        :key="tag"
        class="library-nav-item"
        :class="{ selected: category === `tag:${tag}` }"
        type="button"
        @click="emit('select', `tag:${tag}`)"
      >
        <span class="tag-dot" /><span>{{ tag }}</span
        ><small>{{ tagCounts[tag] ?? 0 }}</small>
      </button>
    </div>
    <div class="nav-bottom">
      <button
        class="library-nav-item"
        :class="{ selected: category === 'trash' }"
        type="button"
        @click="emit('select', 'trash')"
      >
        <Trash2 :size="16" /><span>回收站</span
        ><small>{{ counts.trash }}</small>
      </button>
      <div class="storage-label"><span />本地棋谱库</div>
    </div>
  </nav>
</template>

<style scoped>
.library-navigation {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 16px 10px 12px;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  background: rgba(243, 242, 241, 0.92);
}
.collection-nav-row { display: flex; align-items: center; gap: 2px; }
.collection-nav-row .library-nav-item { flex: 1; min-width: 0; padding-right: 7px; }
.collection-command { width: 24px; flex-basis: 24px; height: 30px; }
.nav-section {
  padding-bottom: 15px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.library-nav-item {
  display: flex;
  width: 100%;
  min-height: 39px;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  margin-bottom: 3px;
  border: 1px solid transparent;
  border-radius: 5px;
  text-align: left;
  color: var(--muted);
  background: transparent;
  font-size: 13px;
}
.library-nav-item > span:not(.tag-dot) {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.library-nav-item svg {
  flex-shrink: 0;
}
.library-nav-item small {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.library-nav-item:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.8);
}
.library-nav-item.selected {
  border-color: rgba(var(--accent-rgb), 0.12);
  color: var(--accent-strong);
  background: var(--accent-soft);
  font-weight: 600;
}
.nav-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 32px;
  margin: 0 5px 7px 12px;
  color: var(--muted);
}
.nav-heading h2 {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
}
.nav-placeholder {
  display: block;
  padding: 6px 12px;
  color: var(--muted);
  font-size: 12px;
}
.nav-bottom {
  margin-top: auto;
}
.storage-label {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 16px 12px 0;
  color: var(--muted);
  font-size: 11px;
}
.storage-label span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #107c10;
}
.tag-dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  margin: 0 5px;
  border-radius: 50%;
  background: var(--accent);
}
</style>
