export type BoardStyle = 'classic' | 'minimal' | 'glassmorphism'

const BOARD_STYLE_STORAGE_KEY = 'go.board-style'

export function loadBoardStyle(): BoardStyle {
  try {
    const value = window.localStorage.getItem(BOARD_STYLE_STORAGE_KEY)
    if (value === 'minimal' || value === 'glassmorphism') return value
    return 'classic'
  } catch {
    return 'classic'
  }
}

export function saveBoardStyle(value: BoardStyle) {
  try {
    window.localStorage.setItem(BOARD_STYLE_STORAGE_KEY, value)
  } catch {
    // Storage is optional; the selected style still applies to this session.
  }
}
