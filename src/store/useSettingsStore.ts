import { create } from 'zustand';
import { DEFAULT_SETTINGS, mergeSettings, type UserSettings } from '@/domain/settings/types';
import { getSettings, resetSettings, saveSettings } from '@/data/repos/settingsRepo';

/**
 * 设置状态镜像（薄壳）。
 * 真源在 IndexedDB.meta['settings']，store 只做 UI 侧的镜像与乐观更新，
 * 持久化一律走 `settingsRepo`（保证与导入导出共用同一份数据）。
 */
export interface SettingsState {
  settings: UserSettings;
  /** 是否已完成从 IndexedDB 的首次读取 */
  hydrated: boolean;
  hydrate: () => Promise<void>;
  update: (patch: Partial<UserSettings>) => Promise<void>;
  reset: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  hydrated: false,

  hydrate: async (): Promise<void> => {
    if (get().hydrated) return;
    const stored = await getSettings();
    set({ settings: mergeSettings(stored), hydrated: true });
  },

  update: async (patch: Partial<UserSettings>): Promise<void> => {
    const optimistic = mergeSettings({ ...get().settings, ...patch });
    set({ settings: optimistic });
    const persisted = await saveSettings(patch);
    set({ settings: persisted });
  },

  reset: async (): Promise<void> => {
    const fresh = await resetSettings();
    set({ settings: fresh });
  },
}));
