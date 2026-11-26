import { useRef, useState } from 'react';
import { Columns2, Plus, Rows2, Search, Square, X } from 'lucide-react';
import type { Preferences, Profile, SavedCommand, Session, WorkTab } from '../types';
import { protocolInfo } from '../utils';
import { TerminalView, type TerminalHandle } from './TerminalView';
import { IconButton } from './UI';
import { Welcome } from './Welcome';
import { CommandDock } from './CommandDock';

interface Props {
  tabs: WorkTab[]; activeTabId: string; sessions: Session[]; profiles: Profile[]; preferences: Preferences;
  onTab: (id: string) => void; onCloseTab: (id: string) => void; onCloseOthers: (id: string) => void; onCloseAll: () => void;
  onNew: () => void; onOpen: (profile: Profile) => void; onNewProtocol: (protocol: Profile['protocol']) => void;
  onSplit: (direction: WorkTab['split']) => void; onActiveSession: (tabId: string, sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  savedCommands: SavedCommand[]; onSavedChange: (commands: SavedCommand[]) => void;
  onSendCommand: (command: string) => Promise<boolean>; onPreferencesChange: (preferences: Preferences) => void;
}

export function Workspace(props: Props) {
  const { tabs, activeTabId, sessions, profiles, preferences } = props;
  const terminalRefs = useRef(new Map<string, TerminalHandle>());
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number }>();
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeSession = sessions.find((session) => session.id === activeTab?.activeSessionId);

  if (!tabs.length) return <main className="workspace welcome-workspace"><Welcome profiles={profiles} onNew={props.onNewProtocol} onOpen={props.onOpen} /></main>;

  return <main className="workspace">
    <header className="workspace-header">
      <div className="tab-strip" role="tablist">{tabs.map((tab) => {
        const session = sessions.find((item) => item.id === tab.sessionIds[0]);
        if (!session) return null;
        return <div key={tab.id} role="tab" aria-selected={tab.id === activeTabId} tabIndex={0} className={`work-tab ${tab.id === activeTabId ? 'active' : ''}`} onClick={() => props.onTab(tab.id)} onKeyDown={(event) => { if (event.key === 'Enter') props.onTab(tab.id); }} onContextMenu={(event) => { event.preventDefault(); setTabMenu({ id: tab.id, x: event.clientX, y: event.clientY }); }}>
          <span className={`tab-status status-${session.state}`} /><span className="tab-protocol">{session.protocol.toUpperCase()}</span><strong>{session.name}</strong>{tab.sessionIds.length > 1 && <span className="split-count">{tab.sessionIds.length}</span>}{session.recording && <span className="recording-dot" title="正在录制" />}<IconButton label={`关闭 ${session.name}`} onClick={(event) => { event.stopPropagation(); props.onCloseTab(tab.id); }}><X size={13} /></IconButton>
        </div>;
      })}<IconButton label="新建连接" className="add-tab" onClick={props.onNew}><Plus size={17} /></IconButton></div>
      <div className="workspace-actions">
        <IconButton label="向右分屏 (⌘\)" disabled={!activeSession} onClick={() => props.onSplit('vertical')}><Columns2 size={16} /></IconButton>
        <IconButton label="向下分屏 (⌘⇧\)" disabled={!activeSession} onClick={() => props.onSplit('horizontal')}><Rows2 size={16} /></IconButton>
        <span className="toolbar-separator" />
        <IconButton label="在终端中查找 (⌘F)" disabled={!activeSession} onClick={() => { if (activeSession) terminalRefs.current.get(activeSession.id)?.search(); }}><Search size={16} /></IconButton>
      </div>
    </header>
    <div className="terminal-stage">
      {tabs.map((tab) => <div key={tab.id} className={`tab-panes split-${tab.split} ${tab.id === activeTabId ? 'visible' : 'hidden'}`}>
        {tab.sessionIds.map((sessionId) => {
          const session = sessions.find((item) => item.id === sessionId);
          if (!session) return null;
          const profile = profiles.find((item) => item.id === session.profileId);
          return <section key={session.id} className={`terminal-pane ${tab.activeSessionId === session.id ? 'active' : ''}`}>
            <div className="pane-caption" onClick={() => props.onActiveSession(tab.id, session.id)}><span className={`status-pill ${session.state}`}><i />{session.state}</span><span>{session.name}</span><small>{profile?.host || protocolInfo[session.protocol].label}</small><div className="pane-caption-actions">{session.recording && <span className="record-label"><i />REC</span>}<IconButton label="关闭窗格" onClick={() => props.onCloseSession(session.id)}><X size={13} /></IconButton></div></div>
            <TerminalView ref={(handle) => { if (handle) terminalRefs.current.set(session.id, handle); else terminalRefs.current.delete(session.id); }} session={session} preferences={preferences} active={tab.id === activeTabId && tab.activeSessionId === session.id} onActivate={() => props.onActiveSession(tab.id, session.id)} onReconnect={() => { if (profile) props.onOpen(profile); }} />
          </section>;
        })}
      </div>)}
    </div>
    {activeSession && <CommandDock collapsed={!preferences.commandPanelOpen} preferences={preferences} onPreferencesChange={props.onPreferencesChange} savedCommands={props.savedCommands} onSavedChange={props.onSavedChange} onSend={props.onSendCommand} />}
    {tabMenu && <><button className="menu-dismiss" onClick={() => setTabMenu(undefined)} aria-label="关闭标签菜单" /><div className="context-menu" style={{ left: Math.min(tabMenu.x, window.innerWidth - 220), top: Math.min(tabMenu.y, window.innerHeight - 200) }}><button onClick={() => { props.onCloseTab(tabMenu.id); setTabMenu(undefined); }}><Square size={14} />关闭标签页</button><button onClick={() => { props.onCloseOthers(tabMenu.id); setTabMenu(undefined); }}><Columns2 size={14} />关闭其他标签页</button><button onClick={() => { props.onCloseAll(); setTabMenu(undefined); }}><X size={14} />关闭全部标签页</button></div></>}
  </main>;
}
