import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HistoryEntry } from '../commandHistory';
import { filterResourceHistory } from './ResourceHistory';
import { PanelDock } from './PanelDock';

const entries: HistoryEntry[] = [
  { id: '1', command: 'systemctl status nginx', time: 3, sessionName: 'Web Server' },
  { id: '2', command: 'df -h', time: 2, sessionName: 'Database' },
  { id: '3', command: 'tail -f app.log', time: 1, sessionName: 'Web Server' },
];

describe('resource command history', () => {
  it('keeps recent order and filters commands or session names', () => {
    expect(filterResourceHistory(entries, '').map((entry) => entry.id)).toEqual(['1', '2', '3']);
    expect(filterResourceHistory(entries, 'NGINX').map((entry) => entry.id)).toEqual(['1']);
    expect(filterResourceHistory(entries, 'web server').map((entry) => entry.id)).toEqual(['1', '3']);
    expect(filterResourceHistory(entries, 'missing')).toEqual([]);
  });

  it('limits the recent command list without mutating history', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ ...entries[0], id: String(index) }));
    expect(filterResourceHistory(many, '')).toHaveLength(30);
    expect(many).toHaveLength(40);
  });

  it('combines resources and history into one tabbed panel', () => {
    const html = renderToStaticMarkup(<PanelDock side="right" modules={[{ id: 'resources', label: '资源管理器', icon: null }, { id: 'history', label: '历史命令', icon: null }]} active="resources" onChange={() => undefined} onOpenSettings={() => undefined}><div /></PanelDock>);
    expect(html).toContain('资源管理器');
    expect(html).toContain('历史命令');
    expect(html).toContain('右侧面板设置');
    expect(html).not.toContain('调整历史命令栏宽度');
  });
});
