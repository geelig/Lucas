import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Rows3 } from 'lucide-react';
import { PanelDock } from './PanelDock';

describe('PanelDock', () => {
  it('keeps module tabs and the side settings action in one dock', () => {
    const html = renderToStaticMarkup(<PanelDock
      side="left"
      modules={[{ id: 'sessions', label: '会话', icon: <Rows3 size={14} /> }]}
      active="sessions"
      onChange={() => undefined}
      onOpenSettings={() => undefined}
    ><div>会话内容</div></PanelDock>);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('左侧面板设置');
    expect(html).toContain('会话内容');
  });

  it('uses roving tab focus and only links the active tab to its rendered panel', () => {
    const html = renderToStaticMarkup(<PanelDock
      side="right"
      modules={[{ id: 'sessions', label: '会话', icon: null }, { id: 'history', label: '历史命令', icon: null }]}
      active="history"
      onChange={() => undefined}
      onOpenSettings={() => undefined}
    ><div>历史内容</div></PanelDock>);
    expect(html).toContain('id="right-tab-sessions" data-module="sessions" role="tab" aria-selected="false" class="" tabindex="-1"');
    expect(html).toContain('aria-controls="right-panel-history"');
    expect(html).toContain('id="right-tab-history" data-module="history" role="tab" aria-selected="true" aria-controls="right-panel-history" class="active" tabindex="0"');
  });
});
