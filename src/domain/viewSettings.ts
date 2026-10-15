export interface BoardDisplaySettings {
  coordinates: boolean
  moveNumbers: boolean
}

export interface ResearchDisplaySettings extends BoardDisplaySettings {
  candidates: boolean
  territory: boolean
}

function load<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key)
    return value ? { ...fallback, ...JSON.parse(value) } : fallback
  } catch {
    return fallback
  }
}

function save<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Preferences remain active for the current session when storage is unavailable.
  }
}

const boardDefaults: BoardDisplaySettings = { coordinates: true, moveNumbers: true }

export function loadResearchDisplaySettings(): ResearchDisplaySettings {
  return load('go.research-display-settings', { ...boardDefaults, candidates: false, territory: false })
}

export function saveResearchDisplaySettings(value: ResearchDisplaySettings) {
  save('go.research-display-settings', value)
}

export function loadLibraryDisplaySettings(): BoardDisplaySettings {
  return load('go.library-display-settings', boardDefaults)
}

export function saveLibraryDisplaySettings(value: BoardDisplaySettings) {
  save('go.library-display-settings', value)
}
