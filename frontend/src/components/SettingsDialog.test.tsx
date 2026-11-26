import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Preferences } from '../types';
import { SettingsDialog } from './SettingsDialog';

const preferences = {
  sidebarOpen: true,
  filePanelOpen: true,
  resourcePanelOpen: false,
  historyPanelEnabled: true,
  sessionDock: 'right',
  filePanelDock: 'bottom',
  resourceDock: 'left',
  historyDock: 'right',
  commandPanelOpen: true,
  resourceMetrics: true,
  metricsInterval: 5,
  collapseGroups: true,
  followCwd: true,
  systemIcons: true,
  highContrastFiles: true,
} as Preferences;

function renderPanelSettings() {
  return renderToStaticMarkup(<SettingsDialog
    initialCategory="panels"
    preferences={preferences}
    onChange={() => undefined}
    onClose={() => undefined}
    onImport={() => undefined}
    onExport={() => undefined}
    onCustomize={() => undefined}
  />);
}

describe('panel settings', () => {
  it('renders an independent visibility switch and dock picker for every module', () => {
    const html = renderPanelSettings();

    for (const label of ['会话', '文件管理器', '资源管理器', '历史命令']) {
      expect(html).toContain(`role="switch"`);
      expect(html).toContain(`aria-label="${label}"`);
      expect(html).toContain(`aria-label="${label}位置"`);
    }
    expect(html).toContain('aria-checked="false" aria-label="资源管理器"');
    expect(html).toContain('底部');
    expect(html).not.toContain('右侧资源管理器');
  });

  it('explains combined tabs and whole-side resizing', () => {
    const html = renderPanelSettings();

    expect(html).toContain('同侧模块合并为页签');
    expect(html).toContain('每侧可整体拖动');
  });
});
