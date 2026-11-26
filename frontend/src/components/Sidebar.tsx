import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Box, ChevronDown, ChevronRight, CirclePlus, Copy, Edit3, FolderPlus, Plus, ScanSearch, Search, Trash2, X } from 'lucide-react';
import type { Group, Profile, Protocol, Session } from '../types';
import { displayAddress, protocolInfo } from '../utils';
import { FinderFolder } from './FinderFolder';
import { SystemIcon } from './SystemIcon';
import { HorizontalScrollbar } from './HorizontalScrollbar';
import { readStored, removeStored, writeStored } from '../storage';
import { SessionActivationTracker } from '../sessionActivation';

interface Props {
  profiles: Profile[];
  groups: Group[];
  sessions: Session[];
  activeProfileId?: string;
  onOpen: (profile: Profile) => void;
  onNew: (protocol?: Protocol, groupId?: string) => void;
  onEdit: (profile: Profile) => void;
  onDuplicate: (profile: Profile) => void;
  onDelete: (profile: Profile) => void;
  onMoveProfile: (profileId: string, groupId: string) => void;
  onGroupNew: (parentId?: string) => void;
  onGroupEdit: (group: Group) => void;
  onGroupDelete: (group: Group) => void;
  onGroupMove: (sourceId: string, targetId: string) => void;
  collapseGroups: boolean;
  systemIcons: boolean;
  onDetectGroupOS: (group: Group) => void;
  detectingGroup: boolean;
}

type Menu = { x: number; y: number; kind: 'profile' | 'group'; id: string };

export function profileRowClass(active: boolean, selected: boolean): string {
  return `profile-row${active ? ' current' : ''}${selected ? ' selected' : ''}`;
}

const COLLAPSED_KEY = 'collapsedGroups';
const COLLAPSE_INITIALIZED = 'collapseInitialized';
const readCollapsed = () => {
  try { return new Set<string>(JSON.parse(readStored(COLLAPSED_KEY) || '[]')); }
  catch { return new Set<string>(); }
};
const saveCollapsed = (value: Set<string>) => {
  writeStored(COLLAPSED_KEY, JSON.stringify([...value]));
};

export function Sidebar(props: Props) {
  const { profiles, groups, sessions, activeProfileId } = props;
  const [query, setQuery] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [activation] = useState(() => new SessionActivationTracker());
  const connectionTree = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  useEffect(() => {
    if (!props.collapseGroups) {
      setCollapsed(new Set());
      removeStored(COLLAPSE_INITIALIZED);
      return;
    }
    if (readStored(COLLAPSE_INITIALIZED) === 'yes' || !groups.length) return;
    const initial = new Set(groups.map((group) => group.id));
    setCollapsed(initial);
    saveCollapsed(initial);
    writeStored(COLLAPSE_INITIALIZED, 'yes');
  }, [props.collapseGroups, groups.length]);
  const [menu, setMenu] = useState<Menu | undefined>(undefined);
  const [dragOver, setDragOver] = useState('');
  const normalized = query.trim().toLowerCase();
  const visible = useMemo(() => profiles.filter((profile) => !normalized || `${profile.name} ${profile.host} ${profile.username} ${profile.description || ''}`.toLowerCase().includes(normalized)), [profiles, normalized]);
  const hasActive = (id: string) => sessions.some((session) => session.profileId === id && !['closed', 'disconnected', 'error'].includes(session.state));

  const toggle = (id: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    saveCollapsed(next);
    return next;
  });
  const showMenu = (event: React.MouseEvent, kind: Menu['kind'], id: string) => {
    event.preventDefault(); event.stopPropagation();
    setMenu({ x: Math.min(event.clientX, window.innerWidth - 205), y: Math.min(event.clientY, window.innerHeight - 230), kind, id });
  };
  const dropProfile = (event: DragEvent, groupId: string) => {
    const id = event.dataTransfer.getData('application/x-lucas-profile');
    if (id) { event.preventDefault(); props.onMoveProfile(id, groupId); }
    setDragOver('');
  };

  const activateProfile = (profile: Profile) => {
    setSelectedProfileId(profile.id);
    if (activation.click(profile.id) === 'open') props.onOpen(profile);
  };
  const openProfileWithKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>, profile: Profile) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedProfileId(profile.id);
    activation.openByKeyboard();
    props.onOpen(profile);
  };

  const profileRow = (profile: Profile, depth = 0) => <div
    key={profile.id}
    className={profileRowClass(activeProfileId === profile.id, selectedProfileId === profile.id)}
    style={{ paddingLeft: `${8 + depth * 16}px` }}
    onContextMenu={(event) => showMenu(event, 'profile', profile.id)}
  >
    <button className="profile-open" aria-pressed={selectedProfileId === profile.id} aria-description="按 Enter 连接" aria-keyshortcuts="Enter" onClick={() => activateProfile(profile)} onKeyDown={(event) => openProfileWithKeyboard(event, profile)} title={`单击定位，双击连接 ${profile.name}；右键编辑`}>
      <span className="protocol-gem profile-system-drag" draggable onDragStart={(event) => { activation.reset(); event.dataTransfer.setData('application/x-lucas-profile', profile.id); event.dataTransfer.effectAllowed = 'move'; }} title={`拖动 ${profile.name} 到分组`} style={{ '--profile-color': profile.color || protocolInfo[profile.protocol].color } as React.CSSProperties}><SystemIcon os={props.systemIcons ? profile.os || sessions.find((item) => item.profileId === profile.id && item.os)?.os : ''} protocol={profile.protocol} size={15} /></span>
      <span className="profile-copy"><strong>{profile.name}</strong><small>{displayAddress(profile)}</small></span>
      {hasActive(profile.id) && <span className="live-dot" title="会话已连接" />}
    </button>
  </div>;

  const groupCount = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    return profiles.filter((profile) => profile.groupId === id).length
      + groups.filter((group) => group.parentId === id).reduce((total, child) => total + groupCount(child.id, seen), 0);
  };

  const renderGroup = (group: Group, depth = 0): React.ReactNode => {
    const children = groups.filter((item) => item.parentId === group.id).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    const members = visible.filter((profile) => profile.groupId === group.id).sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name));
    if (normalized && !members.length && !children.some((child) => JSON.stringify(child).toLowerCase().includes(normalized)) && !group.name.toLowerCase().includes(normalized)) {
      const descendantHasMatch = groups.some((item) => item.parentId === group.id);
      if (!descendantHasMatch && !group.name.toLowerCase().includes(normalized)) return null;
    }
    const isCollapsed = collapsed.has(group.id) && !normalized;
    return <div className="group-block" key={group.id}>
      <div
        className={`group-row ${dragOver === group.id ? 'drag-over' : ''}`}
        style={{ paddingLeft: `${8 + depth * 13}px` }}
        onContextMenu={(event) => showMenu(event, 'group', group.id)}
        onDragOver={(event) => { event.preventDefault(); setDragOver(group.id); }}
        onDragLeave={() => setDragOver('')}
        onDrop={(event) => {
          const sourceGroup = event.dataTransfer.getData('application/x-lucas-group');
          if (sourceGroup && sourceGroup !== group.id) { event.preventDefault(); props.onGroupMove(sourceGroup, group.id); }
          else dropProfile(event, group.id);
          setDragOver('');
        }}
      >
        <button className="group-toggle" onClick={() => toggle(group.id)} aria-label={`${isCollapsed ? '展开' : '折叠'}${group.name}`}>{isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>
        <button className="group-name" title={`${group.name}；右键编辑`} onClick={() => toggle(group.id)} draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-lucas-group', group.id); event.dataTransfer.effectAllowed = 'move'; }}><FinderFolder size={17} /><span className="group-copy"><strong>{group.name}</strong><small>{groupCount(group.id)} 项</small></span></button>
      </div>
      {!isCollapsed && <div className="group-content">{children.map((child) => renderGroup(child, depth + 1))}{members.map((profile) => profileRow(profile, depth + 1))}</div>}
    </div>;
  };

  const ungrouped = visible.filter((profile) => !profile.groupId || !groups.some((group) => group.id === profile.groupId));
  const menuProfile = menu?.kind === 'profile' ? profiles.find((item) => item.id === menu.id) : undefined;
  const menuGroup = menu?.kind === 'group' ? groups.find((item) => item.id === menu.id) : undefined;

  return <aside className="sidebar">
    <div className="search-box"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选" aria-label="筛选连接" />{query && <button onClick={() => setQuery('')} aria-label="清除搜索"><X size={13} /></button>}</div>
    <div id="session-connection-tree" ref={connectionTree} className={`connection-tree ${dragOver === 'root' ? 'drag-over' : ''}`} onDragOver={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); setDragOver('root'); } }} onDrop={(event) => dropProfile(event, '')}>
      {!profiles.length && !query && <div className="library-empty"><Box size={28} /><strong>所有连接，井井有条</strong><p>新建第一个连接，或导入已有配置。</p><button onClick={() => props.onNew()}><CirclePlus size={15} />新建连接</button></div>}
      {groups.filter((group) => !group.parentId || !groups.some((parent) => parent.id === group.parentId)).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)).map((group) => renderGroup(group))}
      {ungrouped.length > 0 && <div className="ungrouped-section">{groups.length > 0 && <div className="section-label">未分组 <span>{ungrouped.length}</span></div>}{ungrouped.map((profile) => profileRow(profile, 0))}</div>}
      {normalized && !visible.length && <div className="search-empty">没有找到与“{query}”匹配的连接。</div>}
    </div>
    <HorizontalScrollbar target={connectionTree} targetId="session-connection-tree" label="横向查看会话内容" />
    {menu && <><button className="menu-dismiss" aria-label="关闭菜单" onClick={() => setMenu(undefined)} onContextMenu={(event) => { event.preventDefault(); setMenu(undefined); }} /><div className="context-menu" style={{ left: menu.x, top: menu.y }}>
      {menuProfile && <><button onClick={() => { props.onOpen(menuProfile); setMenu(undefined); }}><CirclePlus size={15} />打开会话</button><button onClick={() => { props.onEdit(menuProfile); setMenu(undefined); }}><Edit3 size={15} />编辑连接</button><button onClick={() => { props.onDuplicate(menuProfile); setMenu(undefined); }}><Copy size={15} />创建副本</button><div className="menu-separator" /><button className="danger-text" onClick={() => { props.onDelete(menuProfile); setMenu(undefined); }}><Trash2 size={15} />删除连接</button></>}
      {menuGroup && <><button disabled={props.detectingGroup} onClick={() => { props.onDetectGroupOS(menuGroup); setMenu(undefined); }}><ScanSearch size={15} />检测所有操作系统</button><button onClick={() => { props.onNew('ssh', menuGroup.id); setMenu(undefined); }}><Plus size={15} />在此新建连接</button><button onClick={() => { props.onGroupNew(menuGroup.id); setMenu(undefined); }}><FolderPlus size={15} />新建子分组</button><button onClick={() => { props.onGroupEdit(menuGroup); setMenu(undefined); }}><Edit3 size={15} />重命名分组</button><div className="menu-separator" /><button className="danger-text" onClick={() => { props.onGroupDelete(menuGroup); setMenu(undefined); }}><Trash2 size={15} />删除分组</button></>}
    </div></>}
  </aside>;
}
