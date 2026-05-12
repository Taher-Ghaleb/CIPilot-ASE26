import { type AppSettings, DEFAULT_SETTINGS } from '../types/settings'

const SETTINGS_KEY = 'cigrate-settings'

export const settingsStore = {
  get(): AppSettings {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY)
      if (stored) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
      }
    } catch (e) {
      console.error('Failed to load settings:', e)
    }
    return DEFAULT_SETTINGS
  },

  set(settings: Partial<AppSettings>): void {
    const current = this.get()
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...settings }))
  },

  clear(): void {
    localStorage.removeItem(SETTINGS_KEY)
  },
}
