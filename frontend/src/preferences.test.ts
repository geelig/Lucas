import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPreferences, dockModules, readPreferences } from './preferences';

describe('panel preferences', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', { innerWidth: 1440 });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, String(value)); },
      removeItem: (key: string) => { values.delete(key); },
    });
  });

  it('starts both docks at their minimum widths', () => {
    expect(defaultPreferences.sidebarWidth).toBe(220);
    expect(defaultPreferences.resourceWidth).toBe(300);
    expect(dockModules(defaultPreferences, 'left', true)).toEqual(['sessions']);
    expect(dockModules(defaultPreferences, 'right', true)).toEqual(['resources', 'history']);
  });

  it('migrates legacy default widths without narrowing custom sizes', () => {
    localStorage.setItem('lucas.preferences', JSON.stringify({ sidebarWidth: 280, resourceWidth: 540 }));
    expect(readPreferences().sidebarWidth).toBe(220);
    expect(readPreferences().resourceWidth).toBe(300);
    localStorage.setItem('lucas.preferences', JSON.stringify({ sidebarWidth: 360, resourceWidth: 420 }));
    expect(readPreferences().sidebarWidth).toBe(360);
    expect(readPreferences().resourceWidth).toBe(420);
    localStorage.setItem('lucas.preferences', JSON.stringify({ panelLayoutVersion: 2, sidebarWidth: 280, resourceWidth: 320 }));
    expect(readPreferences().sidebarWidth).toBe(280);
    expect(readPreferences().resourceWidth).toBe(320);
  });

  it('places each enabled module on its configured side', () => {
    const preferences = {
      ...defaultPreferences,
      sessionDock: 'right' as const,
      filePanelOpen: true,
      filePanelDock: 'right' as const,
      resourceDock: 'left' as const,
      historyDock: 'left' as const,
    };
    expect(dockModules(preferences, 'left', true)).toEqual(['resources', 'history']);
    expect(dockModules(preferences, 'right', true)).toEqual(['sessions', 'files']);
    expect(dockModules(preferences, 'right', false)).toEqual(['sessions']);
  });
});
