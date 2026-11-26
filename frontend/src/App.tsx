import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, History, Rows3 } from 'lucide-react';
import { backend, normalizeGroup, normalizeProfile, onCwd, onPrompt, onSessionState, onTransfer } from './backend';
import type { Group, Preferences, Profile, PromptRequest, Protocol, SavedCommand, Session, Snapshot, Transfer, WorkTab } from './types';
import { defaultPort, uid } from './utils';
import { dockModules, readPreferences, type PanelModule, type PanelSide } from './preferences';
import { Sidebar } from './components/Sidebar';
import { Workspace } from './components/Workspace';
import { FilePanel } from './components/FilePanel';
import { ProfileDialog } from './components/ProfileDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { CommandDialog } from './components/CommandDialog';
import { CommandPalette, GroupDialog, ImportDialog, PromptDialog } from './components/MiscDialogs';
import { ConfirmDialog, Modal, Toasts, type ToastItem } from './components/UI';
import { ResourcePanel, type ResourceMetrics } from './components/ResourcePanel';
import { FinderFolder } from './components/FinderFolder';
import { ResizeHandle } from './components/ResizeHandle';
import { findHighRiskCommand } from './terminalInputGuard';
import { PanelMenu } from './components/PanelMenu';
import { PanelDock, type DockModule } from './components/PanelDock';
import { VersionBadge } from './components/VersionBadge';
import { HistoryDialog } from './components/HistoryDialog';
import { TransfersDialog } from './components/TransfersDialog';
import { AppearanceStudio } from './components/AppearanceStudio';
import { apply as applyAppearance, load as loadAppearance } from './appearance';
import { addHistory } from './commandHistory';
import { addLocalDataToExport, importLocalData } from './dataExchange';
import { LucasLogo } from './components/LucasLogo';
import { readStored, writeStored } from './storage';

const emptySnapshot: Snapshot = { profiles: [], groups: [], sessions: [] };
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

function readCommands(): SavedCommand[] {
  try {
    const value = JSON.parse(readStored('commands') || '[]');
    return Array.isArray(value) ? value.filter((item) => item && item.id && item.command) : [];
  } catch {
    return [];
  }
}

function sortedSnapshot(snapshot: Snapshot): Snapshot {
  return {
    profiles: [...snapshot.profiles].sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name, 'zh-CN')),
    groups: [...snapshot.groups].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN')),
    sessions: snapshot.sessions,
  };
}

type ProfileEditor = { profile?: Profile; protocol?: Protocol; groupId?: string };
type GroupEditor = { group?: Group; parentId?: string };
type DeleteRequest = { kind: 'profile' | 'group'; id: string; name: string };
type OSDetectionState = { groupId: string; groupName: string; current: string; done: number; failed: number; total: number; cancelling: boolean };

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [tabs, setTabs] = useState<WorkTab[]>([]);
  const [activeTabId, setActiveTabId] = useState('');
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const [savedCommands, setSavedCommands] = useState<SavedCommand[]>(readCommands);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [profileEditor, setProfileEditor] = useState<ProfileEditor>();
  const [groupEditor, setGroupEditor] = useState<GroupEditor>();
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest>();
  const [showSettings, setShowSettings] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showCommand, setShowCommand] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [leftPanel, setLeftPanel] = useState<PanelModule>('sessions');
  const [rightPanel, setRightPanel] = useState<PanelModule>('resources');
  const [panelMenuSide, setPanelMenuSide] = useState<PanelSide | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showTransfers, setShowTransfers] = useState(false);
  const [osDetection, setOSDetection] = useState<OSDetectionState>();
  const osDetectionCancel = useRef(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const [resourceMetrics, setResourceMetrics] = useState<ResourceMetrics>();
  const [metricsReload, setMetricsReload] = useState(0);
  const [resizing, setResizing] = useState(false);
  const [promptQueue, setPromptQueue] = useState<PromptRequest[]>([]);
  const [, setLoading] = useState(true);
  const revealModule = useCallback((module: PanelModule, side: PanelSide) => {
    if (side === 'left') setLeftPanel(module); else setRightPanel(module);
  }, []);
  const [, setRefreshing] = useState(false);
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  tabsRef.current = tabs;
  activeTabIdRef.current = activeTabId;

  const notify = useCallback((message: string, tone: ToastItem['tone'] = 'info') => {
    const id = uid();
    setToasts((items) => [...items.slice(-3), { id, message, tone }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4200);
  }, []);

  const loadState = useCallback(async (announce = false) => {
    setRefreshing(true);
    try {
      const next = sortedSnapshot(await backend.listState());
      setSnapshot(next);
      if (announce) notify('连接库已刷新', 'success');
    } catch (reason) {
      notify(`无法读取配置：${errorText(reason)}`, 'error');
      if (announce) throw reason;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [notify]);

  useEffect(() => { void loadState(); }, [loadState]);
  useEffect(() => { applyAppearance(loadAppearance()); }, []);

  useEffect(() => onSessionState((incoming) => {
    if (!incoming.id) return;
    setSnapshot((current) => {
      const existing = current.sessions.find((item) => item.id === incoming.id);
      if (!existing) return { ...current, sessions: [...current.sessions, incoming] };
      const merged: Session = {
        ...existing,
        state: incoming.state || existing.state,
        message: incoming.message || (incoming.state === 'connected' ? '' : existing.message),
        exitCode: incoming.exitCode ?? existing.exitCode,
      };
      return { ...current, sessions: current.sessions.map((item) => item.id === incoming.id ? merged : item) };
    });
  }), []);

  useEffect(() => onTransfer((incoming) => {
    if (!incoming.id) return;
    setTransfers((current) => {
      const previous = current.find((item) => item.id === incoming.id);
      return [...current.filter((item) => item.id !== incoming.id), { ...previous, ...incoming }].slice(-40);
    });
  }), []);

  useEffect(() => onPrompt((incoming) => {
    if (!incoming.id) return;
    setPromptQueue((current) => [...current.filter((item) => item.id !== incoming.id), incoming]);
  }), []);

  useEffect(() => onCwd((id, cwd) => {
    setSnapshot((current) => ({ ...current, sessions: current.sessions.map((session) => session.id === id ? { ...session, cwd } : session) }));
  }), []);

  useEffect(() => {
    writeStored('preferences', JSON.stringify(preferences));
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.style.colorScheme = preferences.theme === 'daylight' ? 'light' : 'dark';
  }, [preferences]);

  useEffect(() => {
    writeStored('commands', JSON.stringify(savedCommands));
  }, [savedCommands]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeSession = snapshot.sessions.find((session) => session.id === activeTab?.activeSessionId);
  const activeProfile = snapshot.profiles.find((profile) => profile.id === activeSession?.profileId);
  const activeStatusText = !activeSession ? '未连接' : ({ connected: '终端就绪', connecting: '正在连接', disconnected: '已断开', error: '连接异常', closed: '已关闭' } as const)[activeSession.state];
  const sendActiveCommand = useCallback(async (command: string): Promise<boolean> => {
    if (!activeSession) { notify('请先打开一个终端会话', 'info'); return false; }
    if (preferences.commandGuard && findHighRiskCommand(command, preferences.commandRules)) { notify('高风险命令已拦截', 'error'); return false; }
    try {
      await backend.write(activeSession.id, `${command}\r`);
      addHistory(command, activeSession.name);
      return true;
    } catch (reason) {
      notify(`命令发送失败：${errorText(reason)}`, 'error');
      return false;
    }
  }, [activeSession, preferences.commandGuard, preferences.commandRules, notify]);

  const detectGroupOperatingSystems = useCallback(async (group: Group) => {
    if (osDetection) return;
    const groupIds = new Set([group.id]);
    let changed = true;
    while (changed) {
      changed = false;
      snapshot.groups.forEach((item) => {
        if (item.parentId && groupIds.has(item.parentId) && !groupIds.has(item.id)) { groupIds.add(item.id); changed = true; }
      });
    }
    const targets = snapshot.profiles.filter((profile) => profile.groupId && groupIds.has(profile.groupId));
    if (!targets.length) { notify('此分组没有可检测的连接', 'info'); return; }
    osDetectionCancel.current = false;
    let done = 0;
    let failed = 0;
    setOSDetection({ groupId: group.id, groupName: group.name, current: '准备检测', done, failed, total: targets.length, cancelling: false });
    for (const profile of targets) {
      if (osDetectionCancel.current) break;
      setOSDetection((current) => current ? { ...current, current: profile.name } : current);
      try { await backend.detectProfileOperatingSystem(profile); done += 1; }
      catch { failed += 1; }
      setOSDetection((current) => current ? { ...current, done, failed } : current);
    }
    await loadState();
    const cancelled = osDetectionCancel.current;
    setOSDetection(undefined);
    osDetectionCancel.current = false;
    notify(`检测${cancelled ? '已取消' : '完成'}：成功 ${done} 台，失败 ${failed} 台，未检测 ${targets.length - done - failed} 台`, failed ? 'info' : 'success');
  }, [osDetection, snapshot.groups, snapshot.profiles, loadState, notify]);
  useEffect(() => {
    setResourceMetrics(undefined);
    if (!preferences.resourceMetrics || !activeSession || activeSession.state !== 'connected') return;
    let stopped = false;
    const sample = () => {
      void backend.getSessionMetrics(activeSession.id).then((value) => { if (!stopped) setResourceMetrics(value); }).catch(() => undefined);
    };
    sample();
    const timer = window.setInterval(sample, preferences.metricsInterval * 1000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [activeSession?.id, activeSession?.state, preferences.resourceMetrics, preferences.metricsInterval, metricsReload]);
  const prompt = promptQueue[0];
  const openingProfiles = useRef(new Set<string>());

  const addSessionTab = useCallback((session: Session) => {
    const tab: WorkTab = { id: uid(), sessionIds: [session.id], activeSessionId: session.id, split: 'vertical' };
    setSnapshot((current) => ({
      ...current,
      sessions: [...current.sessions.filter((item) => item.id !== session.id), session],
    }));
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    if (session.protocol === 'ftp') {
      setPreferences((current) => ({ ...current, filePanelOpen: true }));
      if (preferences.filePanelDock !== 'bottom') revealModule('files', preferences.filePanelDock);
    }
  }, [preferences.filePanelDock, revealModule]);

  const openProfile = useCallback(async (profile: Profile) => {
    if (openingProfiles.current.has(profile.id)) {
      notify('正在连接，请稍候', 'info');
      return;
    }
    const existing = snapshot.sessions.find((session) => session.profileId === profile.id && ['connected', 'connecting'].includes(session.state));
    if (existing) {
      const tab = tabs.find((item) => item.sessionIds.includes(existing.id));
      if (tab) {
        setActiveTabId(tab.id);
        setTabs((current) => current.map((item) => item.id === tab.id ? { ...item, activeSessionId: existing.id } : item));
        return;
      }
    }
    openingProfiles.current.add(profile.id);
    try {
      addSessionTab(await backend.openSession(profile));
    } catch (reason) {
      notify(`连接失败：${errorText(reason)}`, 'error');
    } finally {
      openingProfiles.current.delete(profile.id);
    }
  }, [addSessionTab, notify, snapshot.sessions, tabs]);

  const saveProfile = useCallback(async (profile: Profile) => {
    await backend.saveProfile(profile);
    if (!preferences.rememberPasswords) await backend.clearCredentials(profile.id);
    await loadState();
    notify('连接配置已保存', 'success');
  }, [loadState, notify, preferences.rememberPasswords]);

  const connectEdited = async (profile: Profile, save: boolean) => {
    if (openingProfiles.current.has(profile.id)) {
      notify('正在连接，请稍候', 'info');
      return;
    }
    openingProfiles.current.add(profile.id);
    try {
      if (save) {
        await backend.saveProfile(profile);
        if (!preferences.rememberPasswords) await backend.clearCredentials(profile.id);
      }
      addSessionTab(await backend.openAdHoc(profile, false));
      await loadState();
      notify(`正在连接 ${profile.name}`, 'success');
    } finally {
      openingProfiles.current.delete(profile.id);
    }
  };

  const markClosed = useCallback((sessionIds: string[]) => {
    const ids = new Set(sessionIds);
    setSnapshot((current) => ({
      ...current,
      sessions: current.sessions.map((session) => ids.has(session.id) ? { ...session, state: 'closed' } : session),
    }));
  }, []);

  const closeSession = useCallback((sessionId: string) => {
    void backend.closeSession(sessionId).catch(() => undefined);
    markClosed([sessionId]);
    setTabs((current) => {
      const next = current.map((tab) => {
        if (!tab.sessionIds.includes(sessionId)) return tab;
        const ids = tab.sessionIds.filter((id) => id !== sessionId);
        return { ...tab, sessionIds: ids, activeSessionId: tab.activeSessionId === sessionId ? ids[0] || '' : tab.activeSessionId };
      }).filter((tab) => tab.sessionIds.length > 0);
      if (!next.some((tab) => tab.id === activeTabIdRef.current)) setActiveTabId(next[0]?.id || '');
      return next;
    });
  }, [markClosed]);

  const closeTab = useCallback((id: string) => {
    const tab = tabsRef.current.find((item) => item.id === id);
    if (!tab) return;
    tab.sessionIds.forEach((sessionId) => { void backend.closeSession(sessionId).catch(() => undefined); });
    markClosed(tab.sessionIds);
    setTabs((current) => {
      const index = current.findIndex((item) => item.id === id);
      const next = current.filter((item) => item.id !== id);
      if (id === activeTabIdRef.current) setActiveTabId(next[Math.min(index, next.length - 1)]?.id || '');
      return next;
    });
  }, [markClosed]);

  const closeOthers = useCallback((id: string) => {
    const closing = tabsRef.current.filter((tab) => tab.id !== id).flatMap((tab) => tab.sessionIds);
    closing.forEach((sessionId) => { void backend.closeSession(sessionId).catch(() => undefined); });
    markClosed(closing);
    setTabs((current) => current.filter((tab) => tab.id === id));
    setActiveTabId(id);
  }, [markClosed]);

  const closeAll = useCallback(() => {
    const closing = tabsRef.current.flatMap((tab) => tab.sessionIds);
    closing.forEach((sessionId) => { void backend.closeSession(sessionId).catch(() => undefined); });
    markClosed(closing);
    setTabs([]);
    setActiveTabId('');
  }, [markClosed]);

  const split = useCallback(async (direction: WorkTab['split']) => {
    if (!activeTab || !activeProfile) {
      notify('请先打开一个已保存的连接', 'info');
      return;
    }
    try {
      const session = await backend.openSession(activeProfile);
      setSnapshot((current) => ({ ...current, sessions: [...current.sessions.filter((item) => item.id !== session.id), session] }));
      setTabs((current) => current.map((tab) => tab.id === activeTab.id ? {
        ...tab,
        split: direction,
        sessionIds: [...tab.sessionIds, session.id],
        activeSessionId: session.id,
      } : tab));
    } catch (reason) {
      notify(`无法分屏：${errorText(reason)}`, 'error');
    }
  }, [activeTab, activeProfile, notify]);

  const toggleRecording = useCallback(async () => {
    if (!activeSession) return;
    const enabled = !activeSession.recording;
    try {
      await backend.setRecording(activeSession.id, enabled);
      setSnapshot((current) => ({
        ...current,
        sessions: current.sessions.map((item) => item.id === activeSession.id ? { ...item, recording: enabled } : item),
      }));
      notify(enabled ? '会话录制已开始' : '会话录制已停止', 'success');
    } catch (reason) {
      notify(`录制操作失败：${errorText(reason)}`, 'error');
    }
  }, [activeSession, notify]);

  const fullscreen = useCallback(() => {
    const operation = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    if (operation) void operation.catch((reason) => notify(`无法切换全屏：${errorText(reason)}`, 'error'));
  }, [notify]);

  const toggleFilePanel = () => {
    const opening = !preferences.filePanelOpen;
    setPreferences((value) => ({ ...value, filePanelOpen: opening }));
    if (opening && preferences.filePanelDock !== 'bottom') revealModule('files', preferences.filePanelDock);
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'F11') { event.preventDefault(); fullscreen(); return; }
      if (event.key === 'Tab' && event.ctrlKey) {
        event.preventDefault();
        const index = tabs.findIndex((tab) => tab.id === activeTabId);
        if (tabs.length) {
          const offset = event.shiftKey ? -1 : 1;
          setActiveTabId(tabs[(index + offset + tabs.length) % tabs.length].id);
        }
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      if (document.querySelector('.modal-backdrop, .palette-backdrop')) return;
      const key = event.key.toLowerCase();
      if (key === 'k') { event.preventDefault(); setShowPalette(true); }
      else if (key === 'n') { event.preventDefault(); setProfileEditor({}); }
      else if (key === 'b') {
        event.preventDefault();
        const opening = !preferences.sidebarOpen;
        setPreferences((value) => ({ ...value, sidebarOpen: opening }));
        if (opening) revealModule('sessions', preferences.sessionDock);
      }
      else if (key === 'j' && activeSession) { event.preventDefault(); toggleFilePanel(); }
      else if (key === 'w' && activeTabId) { event.preventDefault(); closeTab(activeTabId); }
      else if (key === 'f' && activeSession) { event.preventDefault(); document.querySelector<HTMLButtonElement>('[aria-label^="在终端中查找"]')?.click(); }
      else if (key === 'r' && activeSession) { event.preventDefault(); void toggleRecording(); }
      else if (key === 'enter') { event.preventDefault(); setShowCommand(true); }
      else if (event.key === '\\') { event.preventDefault(); void split(event.shiftKey ? 'horizontal' : 'vertical'); }
      else if (event.key === ',') { event.preventDefault(); setShowSettings(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeSession, activeTabId, closeTab, fullscreen, split, tabs, toggleRecording, preferences.filePanelDock, preferences.filePanelOpen, preferences.sidebarOpen, preferences.sessionDock, revealModule]);

  const moveProfile = async (id: string, groupId: string) => {
    const profile = snapshot.profiles.find((item) => item.id === id);
    if (!profile || (profile.groupId || '') === groupId) return;
    try {
      await backend.saveProfile({ ...profile, groupId });
      await loadState();
      notify(groupId ? '连接已移动到分组' : '连接已移出分组', 'success');
    } catch (reason) { notify(`移动失败：${errorText(reason)}`, 'error'); }
  };

  const moveGroup = async (sourceId: string, targetId: string) => {
    const source = snapshot.groups.find((item) => item.id === sourceId);
    const target = snapshot.groups.find((item) => item.id === targetId);
    if (!source || !target || (source.parentId || '') !== (target.parentId || '')) {
      notify('拖动分组可在同级之间排序', 'info');
      return;
    }
    const siblings = snapshot.groups
      .filter((item) => (item.parentId || '') === (source.parentId || ''))
      .sort((a, b) => a.order - b.order);
    const ordered = siblings.filter((item) => item.id !== sourceId);
    const targetIndex = ordered.findIndex((item) => item.id === targetId);
    if (targetIndex < 0) return;
    ordered.splice(targetIndex, 0, source);
    try {
      await backend.setGroupOrder(ordered.map((item) => item.id));
      await loadState();
    } catch (reason) { notify(`分组排序失败：${errorText(reason)}`, 'error'); }
  };

  const deleteConfirmed = async () => {
    if (!deleteRequest) return;
    try {
      if (deleteRequest.kind === 'profile') await backend.deleteProfile(deleteRequest.id);
      else await backend.deleteGroup(deleteRequest.id);
      setDeleteRequest(undefined);
      await loadState();
      notify(deleteRequest.kind === 'profile' ? '连接已删除' : '分组已删除', 'success');
    } catch (reason) { notify(`删除失败：${errorText(reason)}`, 'error'); }
  };

  const exportData = async () => {
    try {
      const name = `Lucas-${new Date().toISOString().slice(0, 10)}.lucas`;
      const picked = preferences.exportAskPath ? await backend.pickSavePath(name) : '';
      if (preferences.exportAskPath && !picked) return;
      const document = addLocalDataToExport(await backend.exportData());
      const saved = await backend.exportDocumentTo(picked, document);
      notify(`连接、历史和常用命令已导出到 ${saved}（不含密码）`, 'success');
    } catch (reason) { notify(`导出失败：${errorText(reason)}`, 'error'); }
  };

  const importSSH = async (data: string) => {
    const profiles: Profile[] = [];
    let current: Profile[] = [];
    for (const line of data.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^(\S+)\s+(.+)$/);
      if (!match) continue;
      const [, rawKey, rawValue] = match;
      const key = rawKey.toLowerCase();
      const value = rawValue.replace(/^['"]|['"]$/g, '');
      if (key === 'host') {
        current = value.split(/\s+/).filter((name) => name && !/[?!*]/.test(name)).map((name) => normalizeProfile({
          id: uid(), name, host: name, protocol: 'ssh', port: 22, auth: 'password',
        }));
        profiles.push(...current);
      } else if (key === 'hostname') current.forEach((profile) => { profile.host = value; });
      else if (key === 'user') current.forEach((profile) => { profile.username = value; });
      else if (key === 'port') current.forEach((profile) => { profile.port = Number(value) || 22; });
      else if (key === 'identityfile') current.forEach((profile) => { profile.auth = 'key'; profile.privateKeyPath = value; });
    }
    if (!profiles.length) throw new Error('SSH 配置中没有可导入的 Host');
    for (const profile of profiles) await backend.saveProfile(profile);
    await loadState();
    notify(`已导入 ${profiles.length} 个 SSH 连接`, 'success');
  };

  const importLegacy = async (data: string) => {
    const parsed = JSON.parse(data);
    const values = Array.isArray(parsed) ? parsed : parsed.profiles;
    if (!Array.isArray(values)) throw new Error('没有找到连接配置');
    const rawGroups = !Array.isArray(parsed) && Array.isArray(parsed.groups) ? parsed.groups : [];
    const groupIds = new Map<string, string>();
    const groups = rawGroups.map((value: unknown) => {
      const group = normalizeGroup(value);
      const id = uid();
      if (group.id) groupIds.set(group.id, id);
      return { ...group, id };
    });
    for (const group of groups) {
      await backend.saveGroup({ ...group, parentId: group.parentId ? groupIds.get(group.parentId) || '' : '' });
    }
    for (const value of values) {
      const profile = normalizeProfile(value);
      await backend.saveProfile({
        ...profile,
        id: uid(),
        port: Number(profile.port || defaultPort(profile.protocol)),
        groupId: profile.groupId ? groupIds.get(profile.groupId) || '' : '',
      });
    }
    await loadState();
    notify(`已导入 ${values.length} 个连接${groups.length ? `、${groups.length} 个分组` : ''}`, 'success');
  };

  const importData = async (data: string, format: string) => {
    const trimmed = data.trim();
    if (!trimmed) throw new Error('导入内容为空');
    const detected = format === 'auto'
      ? /^\s*Host\s+\S+/im.test(trimmed) ? 'ssh' : trimmed.startsWith('[') ? 'legacy' : 'lucas'
      : format;
    if (detected === 'ssh') { await importSSH(trimmed); return; }
    if (detected === 'legacy') { await importLegacy(trimmed); return; }
    await backend.importData(trimmed);
    const local = importLocalData(trimmed);
    setSavedCommands(readCommands());
    await loadState();
    notify(`Lucas 配置导入完成；新增 ${local.history} 条历史、${local.savedCommands} 条常用命令`, 'success');
  };

  const cycleTheme = () => {
    const themes: Preferences['theme'][] = ['midnight', 'graphite', 'daylight'];
    setPreferences((value) => ({ ...value, theme: themes[(themes.indexOf(value.theme) + 1) % themes.length] }));
  };

  const tabActions = useMemo(() => ({ onCloseTab: closeTab, onCloseOthers: closeOthers, onCloseAll: closeAll }), [closeAll, closeOthers, closeTab]);
  const shellClass = [
    'app-shell',
    preferences.sidebarOpen ? '' : 'sidebar-collapsed',
    `dock-${preferences.filePanelDock}`,
    preferences.filePanelOpen && activeSession ? 'files-open' : '',
    preferences.highContrastFiles ? 'files-high-contrast' : '',
    resizing ? 'is-resizing' : '',
  ].filter(Boolean).join(' ');

  const sidebarContent = <Sidebar
    profiles={snapshot.profiles}
    groups={snapshot.groups}
    sessions={snapshot.sessions}
    activeProfileId={activeProfile?.id}
    onOpen={(profile) => void openProfile(profile)}
    onNew={(protocol, groupId) => setProfileEditor({ protocol, groupId })}
    onEdit={(profile) => setProfileEditor({ profile })}
    onDuplicate={(profile) => {
      void backend.duplicateProfile(profile.id)
        .then(() => loadState())
        .then(() => notify('已创建连接副本', 'success'))
        .catch((reason) => notify(`复制失败：${errorText(reason)}`, 'error'));
    }}
    onDelete={(profile) => setDeleteRequest({ kind: 'profile', id: profile.id, name: profile.name })}
    onMoveProfile={(id, groupId) => void moveProfile(id, groupId)}
    onGroupNew={(parentId) => setGroupEditor({ parentId })}
    onGroupEdit={(group) => setGroupEditor({ group })}
    onGroupDelete={(group) => setDeleteRequest({ kind: 'group', id: group.id, name: group.name })}
    onGroupMove={(source, target) => void moveGroup(source, target)}
    collapseGroups={preferences.collapseGroups}
    systemIcons={preferences.systemIcons}
    onDetectGroupOS={(group) => void detectGroupOperatingSystems(group)}
    detectingGroup={Boolean(osDetection)}
  />;
  const fileContent = activeSession ? <FilePanel
    session={activeSession}
    transfers={transfers}
    dock={preferences.filePanelDock}
    followCwd={preferences.followCwd}
    onToggleFollowCwd={() => setPreferences((value) => ({ ...value, followCwd: !value.followCwd }))}
    onClose={() => setPreferences((value) => ({ ...value, filePanelOpen: false }))}
    notify={notify}
  /> : null;
  const moduleDetails: DockModule[] = [
    { id: 'sessions', label: '会话', icon: <Rows3 size={14} /> },
    { id: 'files', label: '文件管理器', icon: <FinderFolder size={15} /> },
    { id: 'resources', label: '资源管理器', icon: <Activity size={14} /> },
    { id: 'history', label: '历史命令', icon: <History size={14} /> },
  ];
  const leftModuleIds = dockModules(preferences, 'left', Boolean(activeSession));
  const rightModuleIds = dockModules(preferences, 'right', Boolean(activeSession));
  const leftModules = moduleDetails.filter((module) => leftModuleIds.includes(module.id));
  const rightModules = moduleDetails.filter((module) => rightModuleIds.includes(module.id));
  const leftModuleKey = leftModuleIds.join(',');
  const rightModuleKey = rightModuleIds.join(',');
  const leftWidth = leftPanel === 'files' ? Math.max(320, preferences.sidebarWidth) : preferences.sidebarWidth;
  const rightWidth = rightPanel === 'files' ? Math.max(320, preferences.resourceWidth) : preferences.resourceWidth;
  const leftMinimum = leftPanel === 'files' ? 320 : 220;
  const rightMinimum = rightPanel === 'files' ? 320 : 300;
  useEffect(() => {
    if (!leftModuleIds.includes(leftPanel)) setLeftPanel(leftModuleIds[0] || 'sessions');
  }, [leftPanel, leftModuleKey]);
  useEffect(() => {
    if (!rightModuleIds.includes(rightPanel)) setRightPanel(rightModuleIds[0] || 'resources');
  }, [rightPanel, rightModuleKey]);

  const resourceContent = (view: 'resources' | 'history') => <ResourcePanel
    sessions={snapshot.sessions.filter((session) => session.state !== 'closed')}
    activeId={activeSession?.id}
    view={view}
    onFocus={(id) => {
      const tab = tabs.find((item) => item.sessionIds.includes(id));
      if (!tab) return;
      setActiveTabId(tab.id);
      setTabs((current) => current.map((item) => item.id === tab.id ? { ...item, activeSessionId: id } : item));
    }}
    onCloseSession={closeSession}
    metrics={resourceMetrics}
    onRefreshMetrics={() => setMetricsReload((value) => value + 1)}
    onTerminateProcess={(pid) => {
      if (!activeSession) return;
      void backend.terminateProcess(activeSession.id, pid)
        .then(() => { notify(`已向进程 ${pid} 发送终止信号`, 'success'); setMetricsReload((value) => value + 1); })
        .catch((reason) => notify(`进程操作失败：${errorText(reason)}`, 'error'));
    }}
    onSendCommand={sendActiveCommand}
  />;

  const dockContent = (module: PanelModule) => module === 'sessions' ? sidebarContent
    : module === 'files' ? fileContent
      : resourceContent(module === 'history' ? 'history' : 'resources');

  const toggleModule = (module: PanelModule, side: PanelSide) => {
    const visible = dockModules(preferences, side, Boolean(activeSession)).includes(module);
    if (visible) {
      setPreferences((value) => module === 'sessions' ? { ...value, sidebarOpen: false }
        : module === 'files' ? { ...value, filePanelOpen: false }
          : module === 'resources' ? { ...value, resourcePanelOpen: false }
            : { ...value, historyPanelEnabled: false });
      return;
    }
    if (module === 'files' && !activeSession) { notify('请先打开一个终端会话', 'info'); return; }
    setPreferences((value) => {
      if (module === 'sessions') return { ...value, sidebarOpen: true, sessionDock: side };
      if (module === 'files') return { ...value, filePanelOpen: true, filePanelDock: side };
      if (module === 'resources') return { ...value, resourcePanelOpen: true, resourceDock: side };
      return { ...value, historyPanelEnabled: true, historyDock: side };
    });
    revealModule(module, side);
  };

  return <div className={shellClass}>

    <div className="app-body">
      {leftModules.length > 0 && <>
        <button className="sidebar-scrim" aria-label="关闭左侧面板" onClick={() => toggleModule(leftPanel, 'left')} />
        <div className="sidebar-shell" style={{ width: leftWidth }}>
          <PanelDock side="left" modules={leftModules} active={leftPanel} onChange={setLeftPanel} onOpenSettings={() => setPanelMenuSide('left')}>{dockContent(leftPanel)}</PanelDock>
          <ResizeHandle onDragging={setResizing} axis="x" value={leftWidth} min={leftMinimum} max={520} label="调整左侧面板宽度" onChange={(width) => setPreferences((value) => ({ ...value, sidebarWidth: width }))} />
        </div>
      </>}

      <div className="work-area">
        <div className="workspace-column">
          <Workspace
          tabs={tabs}
          activeTabId={activeTabId}
          sessions={snapshot.sessions}
          profiles={snapshot.profiles}
          preferences={preferences}
          onTab={setActiveTabId}
          {...tabActions}
          onNew={() => setProfileEditor({})}
          onOpen={(profile) => void openProfile(profile)}
          onNewProtocol={(protocol) => setProfileEditor({ protocol })}
          onSplit={(direction) => void split(direction)}
          onActiveSession={(tabId, sessionId) => {
            setActiveTabId(tabId);
            setTabs((current) => current.map((tab) => tab.id === tabId ? { ...tab, activeSessionId: sessionId } : tab));
          }}
          onCloseSession={closeSession}
          savedCommands={savedCommands}
          onSavedChange={setSavedCommands}
          onSendCommand={sendActiveCommand}
          onPreferencesChange={setPreferences}
          />
        {preferences.filePanelOpen && activeSession && preferences.filePanelDock === 'bottom' && <div className="file-shell dock-bottom" style={{ height: preferences.fileBottomHeight }}>
          {fileContent}
          <ResizeHandle onDragging={setResizing} reverse axis="y" value={preferences.fileBottomHeight} min={180} max={560} label="调整文件面板" onChange={(size) => setPreferences((value) => ({ ...value, fileBottomHeight: size }))} />
        </div>}
        </div>
        {rightModules.length > 0 && <div className="resource-shell" style={{ width: rightWidth }}>
          <PanelDock side="right" modules={rightModules} active={rightPanel} onChange={setRightPanel} onOpenSettings={() => setPanelMenuSide('right')}>{dockContent(rightPanel)}</PanelDock>
          <ResizeHandle onDragging={setResizing} reverse axis="x" value={rightWidth} min={rightMinimum} max={520} label="调整资源管理器宽度" onChange={(width) => setPreferences((value) => ({ ...value, resourceWidth: width }))} />
        </div>}
      </div>
    </div>
    <footer className="workspace-status app-status-bar"><div><button className="status-settings-button" aria-label="打开设置" title="设置" onClick={() => setShowSettings(true)}><LucasLogo size={22} /></button><VersionBadge /><span className={`status-pill ${activeSession?.state || 'closed'}`}><i />{activeSession?.state || 'offline'}</span>{activeSession && <><span>{activeSession.protocol.toUpperCase()}</span><span>UTF-8</span></>}</div><div>{activeSession?.recording && <button className="status-recording" onClick={() => void toggleRecording()}><i />正在录制 · 点击停止</button>}<span>{activeStatusText}</span></div></footer>

    {profileEditor && <ProfileDialog
      profile={profileEditor.profile}
      protocol={profileEditor.protocol}
      groupId={profileEditor.groupId}
      groups={snapshot.groups}
      profiles={snapshot.profiles}
      onClose={() => setProfileEditor(undefined)}
      onSave={saveProfile}
      onConnect={connectEdited}
      defaults={preferences}
    />}
    {groupEditor && <GroupDialog
      group={groupEditor.group}
      parentId={groupEditor.parentId}
      onClose={() => setGroupEditor(undefined)}
      onSave={async (name) => {
        try {
          const siblings = snapshot.groups.filter((group) => (group.parentId || '') === (groupEditor.parentId || ''));
          const order = Math.max(-1, ...siblings.map((group) => group.order)) + 1;
          await backend.saveGroup(groupEditor.group
            ? { ...groupEditor.group, name }
            : { id: uid(), name, parentId: groupEditor.parentId, order });
          await loadState();
          notify(groupEditor.group ? '分组已重命名' : '分组已创建', 'success');
        } catch (reason) { notify(`保存分组失败：${errorText(reason)}`, 'error'); }
      }}
    />}
    {deleteRequest && <ConfirmDialog
      title={`删除${deleteRequest.kind === 'profile' ? '连接' : '分组'}“${deleteRequest.name}”？`}
      message={deleteRequest.kind === 'profile' ? '连接配置将被删除，已打开的终端不受影响。' : '分组及其组织关系将被移除，请确认不再需要。'}
      onClose={() => setDeleteRequest(undefined)}
      onConfirm={() => void deleteConfirmed()}
    />}
    {showSettings && <SettingsDialog preferences={preferences} onChange={setPreferences} onClose={() => setShowSettings(false)} onImport={() => { setShowSettings(false); setShowImport(true); }} onExport={() => { setShowSettings(false); void exportData(); }} onCustomize={() => { setShowSettings(false); setShowAppearance(true); }} onOpenPalette={() => { setShowSettings(false); setShowPalette(true); }} onOpenHistory={() => { setShowSettings(false); setShowHistory(true); }} onOpenTransfers={() => { setShowSettings(false); setShowTransfers(true); }} onOpenShell={() => { setShowSettings(false); setProfileEditor({ protocol: 'local' }); }} onNewConnection={() => { setShowSettings(false); setProfileEditor({}); }} onRefreshProfiles={() => { void loadState(true); }} />}
    {showAppearance && <AppearanceStudio preferences={preferences} onChange={setPreferences} onClose={() => setShowAppearance(false)} />}
    {showImport && <ImportDialog onImport={importData} onClose={() => setShowImport(false)} />}
    {showCommand && <CommandDialog
      sessions={snapshot.sessions}
      activeSessionId={activeSession?.id}
      saved={savedCommands}
      onSavedChange={setSavedCommands}
      onClose={() => setShowCommand(false)}
      onSend={async (command, ids) => {
        if (preferences.commandGuard && findHighRiskCommand(command, preferences.commandRules)) {
          notify('高风险命令已拦截，未发送到任何会话', 'error');
          return;
        }
        await Promise.all(ids.map((id) => backend.write(id, `${command}\r`)));
        addHistory(command, activeSession?.name || '批量发送');
        notify(`命令已发送到 ${ids.length} 个会话`, 'success');
      }}
    />}
    {showPalette && <CommandPalette
      profiles={snapshot.profiles}
      onOpen={(profile) => void openProfile(profile)}
      onNew={() => setProfileEditor({})}
      onSettings={() => setShowSettings(true)}
      onCommand={() => setShowCommand(true)}
      onTheme={cycleTheme}
      onImport={() => setShowImport(true)}
      onClose={() => setShowPalette(false)}
    />}
    {prompt && <PromptDialog prompt={prompt} onAnswer={async (id, answer) => {
      try {
        await backend.answerPrompt(id, answer);
        setPromptQueue((current) => current.filter((item) => item.id !== id));
      } catch (reason) { notify(`回应失败：${errorText(reason)}`, 'error'); }
    }} />}
    {panelMenuSide && <PanelMenu
      side={panelMenuSide}
      modules={{
        sessions: dockModules(preferences, panelMenuSide, Boolean(activeSession)).includes('sessions'),
        files: dockModules(preferences, panelMenuSide, Boolean(activeSession)).includes('files'),
        resources: dockModules(preferences, panelMenuSide, Boolean(activeSession)).includes('resources'),
        history: dockModules(preferences, panelMenuSide, Boolean(activeSession)).includes('history'),
      }}
      onToggleModule={(module) => toggleModule(module, panelMenuSide)}
      onOpenSettings={() => setShowSettings(true)} onSender={() => setShowCommand(true)}
      onNewConnection={() => setProfileEditor({})}
      onShell={() => setProfileEditor({ protocol: 'local' })} onTransfers={() => setShowTransfers(true)}
      onClose={() => setPanelMenuSide(null)}
    />}
    {showHistory && <HistoryDialog onClose={() => setShowHistory(false)} onSend={(command) => { void sendActiveCommand(command); }} />}
    {showTransfers && <TransfersDialog transfers={transfers} onCancel={(id) => void backend.cancelTransfer(id)} onClose={() => setShowTransfers(false)} />}
    {osDetection && <Modal title="检测所有操作系统" subtitle={`${osDetection.groupName} · 逐台检测，每台最多 8 秒`} onClose={() => { osDetectionCancel.current = true; setOSDetection((current) => current ? { ...current, cancelling: true } : current); }} footer={<button className="button secondary" disabled={osDetection.cancelling} onClick={() => { osDetectionCancel.current = true; setOSDetection((current) => current ? { ...current, cancelling: true } : current); }}>取消检测</button>}><div aria-live="polite"><p>正在检测：{osDetection.current}</p><p>成功 {osDetection.done} 台 · 失败 {osDetection.failed} 台 · 共 {osDetection.total} 台</p>{osDetection.cancelling && <p>正在取消，当前连接结束后停止…</p>}</div></Modal>}
    <Toasts items={toasts} dismiss={(id) => setToasts((items) => items.filter((item) => item.id !== id))} />
  </div>;
}
