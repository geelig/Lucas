import type { Preferences } from './types';
import { DEFAULT_HIGH_RISK_RULES } from './terminalInputGuard';
import { readStored } from './storage';

export type PanelSide = 'left' | 'right';
export type PanelModule = 'sessions' | 'files' | 'resources' | 'history';

export const defaultPreferences: Preferences = {
  theme: 'midnight',
  fontFamily: 'SFMono-Regular, Menlo, monospace',
  fontSize: 13,
  sessionDock: 'left',
  filePanelDock: 'left',
  filePanelOpen: false,
  sidebarOpen: true,
  showTimestamps: true,
  terminalPalette: 'windterm',
  resourcePanelOpen: true,
  resourceDock: 'right',
  historyDock: 'right',
  collapseGroups: true,
  followCwd: true,
  systemIcons: true,
  rememberPasswords: true,
  zmodemEnabled: true,
  selectCopy: true,
  rightClickPaste: true,
  exportAskPath: true,
  highContrastFiles: true,
  pasteWarning: true,
  commandGuard: true,
  commandRules: DEFAULT_HIGH_RISK_RULES,
  commandPanelOpen: true,
  commandPanelTab: 'saved',
  historyPanelEnabled: true,
  defaultShell: '/bin/zsh',
  defaultDirectory: '~',
  defaultSSHPort: 22,
  defaultUsername: '',
  paletteVersion: 2,
  panelLayoutVersion: 2,
  sidebarWidth: 220,
  fileWidth: 240,
  resourceWidth: 300,
  fileBottomHeight: 260,
  resourceMetrics: true,
  metricsInterval: 5,
  semanticColors: true,
};

export function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(readStored('preferences') || '{}') as Partial<Preferences>;
    const merged: Preferences = {
      ...defaultPreferences,
      ...saved,
      sidebarOpen: saved.sidebarOpen ?? window.innerWidth > 860,
    };
    if (saved.paletteVersion !== 2) { merged.terminalPalette = 'windterm'; merged.paletteVersion = 2; }
    if (saved.panelLayoutVersion !== 2) {
      if (saved.sidebarWidth === 280) merged.sidebarWidth = 220;
      if (saved.resourceWidth === 320 || saved.resourceWidth === 540) merged.resourceWidth = 300;
      merged.panelLayoutVersion = 2;
    }
    merged.sidebarWidth = Math.max(220, merged.sidebarWidth || 220);
    merged.resourceWidth = Math.max(300, merged.resourceWidth || 300);
    return merged;
  } catch {
    return { ...defaultPreferences, sidebarOpen: window.innerWidth > 860 };
  }
}

export function dockModules(preferences: Preferences, side: PanelSide, hasActiveSession: boolean): PanelModule[] {
  const modules: PanelModule[] = [];
  if (preferences.sidebarOpen && preferences.sessionDock === side) modules.push('sessions');
  if (preferences.filePanelOpen && hasActiveSession && preferences.filePanelDock === side) modules.push('files');
  if (preferences.resourcePanelOpen && preferences.resourceDock === side) modules.push('resources');
  if (preferences.historyPanelEnabled && preferences.historyDock === side) modules.push('history');
  return modules;
}
