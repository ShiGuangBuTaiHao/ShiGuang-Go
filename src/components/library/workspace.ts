import { REVIEW_LABELS, SOURCE_LABELS, type LibraryRecord, type RecordSource, type ReviewState } from '../../types/library'

export const LIBRARY_PAGE_SIZE = 40
export interface LibraryFilters {
  sizeFilter: string
  sourceFilter: string
  reviewFilter: string
  fromDate: string
  toDate: string
}
export type FilterKey = keyof LibraryFilters

export function filterChips(filters: LibraryFilters) {
  const chips: { key: FilterKey; label: string }[] = []
  if (filters.sizeFilter) chips.push({ key: 'sizeFilter', label: `${filters.sizeFilter} 路` })
  if (filters.sourceFilter) chips.push({ key: 'sourceFilter', label: SOURCE_LABELS[filters.sourceFilter as RecordSource] ?? filters.sourceFilter })
  if (filters.reviewFilter) chips.push({ key: 'reviewFilter', label: REVIEW_LABELS[filters.reviewFilter as ReviewState] ?? filters.reviewFilter })
  if (filters.fromDate) chips.push({ key: 'fromDate', label: `起始 ${filters.fromDate}` })
  if (filters.toDate) chips.push({ key: 'toDate', label: `截止 ${filters.toDate}` })
  return chips
}

export function filterLibraryRecords(records: LibraryRecord[], category: string, filters: LibraryFilters, sort: string, ascending: boolean) {
  const field = category === 'recent' && sort === 'updatedAt' ? 'openedAt' : sort
  const value = (record: LibraryRecord) => field === 'players'
    ? `${record.black} ${record.white}`
    : String(record[field as keyof LibraryRecord] ?? '')
  return records.filter(record => {
    if (category.startsWith('collection-') && !record.collectionIds.includes(category)) return false
    if (category.startsWith('tag:') && !record.tags.includes(category.slice(4))) return false
    return (!filters.sizeFilter || record.boardSize === Number(filters.sizeFilter))
      && (!filters.sourceFilter || record.source === filters.sourceFilter)
      && (!filters.reviewFilter || record.reviewState === filters.reviewFilter)
      && (!filters.fromDate || record.date >= filters.fromDate)
      && (!filters.toDate || record.date <= filters.toDate)
  }).sort((a, b) => value(a).localeCompare(value(b), 'zh-CN', { numeric: true }) * (ascending ? 1 : -1))
}

export function preserveRecordOrder(records: LibraryRecord[], order: string[]) {
  const rank = new Map(order.map((id, index) => [id, index]))
  const existing = records.filter(record => rank.has(record.id))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
  const newRecords = records.filter(record => !rank.has(record.id))
  return [...newRecords, ...existing]
}

export function pageCount(total: number) {
  return Math.max(1, Math.ceil(total / LIBRARY_PAGE_SIZE))
}
