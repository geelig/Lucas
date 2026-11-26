import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PanelMenu } from './PanelMenu';

describe('PanelMenu', () => {
  it('offers all four modules for the side that opened it', () => {
    const html = renderToStaticMarkup(<PanelMenu
      side="right"
      modules={{ sessions: false, files: false, resources: true, history: true }}
      onToggleModule={() => undefined}
      onSender={() => undefined}
      onShell={() => undefined}
      onTransfers={() => undefined}
      onClose={() => undefined}
      onOpenSettings={() => undefined}
      onNewConnection={() => undefined}
    />);
    expect(html).toContain('右侧窗格');
    for (const label of ['会话', '文件管理器', '资源管理器', '历史命令']) expect(html).toContain(label);
    expect(html).toContain('全部设置');
  });
});
