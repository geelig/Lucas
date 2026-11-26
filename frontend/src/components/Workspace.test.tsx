import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Preferences, Session, WorkTab } from '../types';

describe('workspace toolbar', () => {
  it('keeps split and search while removing redundant command, file and overflow buttons', async () => {
    vi.stubGlobal('self', globalThis);
    const { Workspace } = await import('./Workspace');
    const tab: WorkTab = { id: 't1', sessionIds: ['s1'], activeSessionId: 's1', split: 'vertical' };
    const session: Session = { id: 's1', profileId: 'p1', name: 'Local', protocol: 'local', state: 'connected' };
    const html = renderToStaticMarkup(<Workspace
      tabs={[tab]} activeTabId={tab.id} sessions={[session]} profiles={[]}
      preferences={{ commandPanelOpen: false } as Preferences}
      onTab={() => undefined} onCloseTab={() => undefined} onCloseOthers={() => undefined} onCloseAll={() => undefined}
      onNew={() => undefined} onOpen={() => undefined} onNewProtocol={() => undefined} onSplit={() => undefined}
      onActiveSession={() => undefined} onCloseSession={() => undefined}
      savedCommands={[]} onSavedChange={() => undefined} onSendCommand={async () => true} onPreferencesChange={() => undefined}
    />);
    expect(html).toContain('向右分屏');
    expect(html).toContain('在终端中查找');
    expect(html).not.toContain('发送命令 (⌘Enter)');
    expect(html).not.toContain('显示或隐藏文件面板');
    expect(html).not.toContain('更多操作');
  });
});
