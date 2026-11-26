import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Activity, ArrowDown, ArrowUp, Clock3, Disc3, Folder, Link2, Radio, RefreshCw, X } from 'lucide-react';
import type { Protocol, Session, SessionState } from '../types';
import { SystemIcon } from './SystemIcon';
import { HorizontalScrollbar } from './HorizontalScrollbar';
import { ResourceHistory } from './ResourceHistory';

export interface ProcessInfo {
  pid: number;
  user: string;
  cpu: number;
  memory: number;
  command: string;
}

export interface ResourceMetrics {
  user: string;
  ip: string;
  cpuPercent: number;
  memoryPercent: number;
  memoryUsed: number;
  memoryTotal: number;
  rxPerSecond: number;
  txPerSecond: number;
  processes: ProcessInfo[];
}

export interface ResourcePanelProps {
  sessions: Session[];
  activeId?: string;
  onFocus: (id: string) => void;
  onCloseSession: (id: string) => void;
  metrics?: ResourceMetrics;
  onRefreshMetrics?: () => void;
  onTerminateProcess?: (pid: number) => void;
  onSendCommand?: (command: string) => Promise<boolean>;
  view?: 'resources' | 'history';
}

// These fields are supplied by newer backends without changing the current Session contract.
type SessionDetails = Session & {
  address?: string;
  host?: string;
  port?: number;
  username?: string;
  serialPort?: string;
  openedAt?: string | number;
  os?: string;
  platform?: string;
};

const protocolLabels: Record<Protocol, string> = {
  local: 'LOCAL',
  ssh: 'SSH',
  telnet: 'TELNET',
  serial: 'SERIAL',
  ftp: 'FTP',
};

const stateLabels: Record<SessionState, string> = {
  connecting: '连接中',
  connected: '在线',
  disconnected: '已断开',
  error: '连接异常',
  closed: '已关闭',
};

function addressOf(session: SessionDetails) {
  if (session.address?.trim()) return session.address;
  if (session.protocol === 'local') return session.host || '本机';
  if (session.protocol === 'serial') return session.serialPort || '串口设备';
  if (!session.host) return '地址未同步';
  return `${session.username ? `${session.username}@` : ''}${session.host}${session.port ? `:${session.port}` : ''}`;
}

function openedTimestamp(value: SessionDetails['openedAt']) {
  if (value === undefined || value === '') return undefined;
  const numericValue = typeof value === 'number' ? value : /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : undefined;
  if (numericValue !== undefined) {
    const milliseconds = numericValue > 0 && numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue;
    return Number.isFinite(milliseconds) ? milliseconds : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function processDisplayName(command: string) {
  const executable = command.trim().split(/\s+/)[0] || command;
  return executable.split('/').pop() || executable;
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const time = [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
  return days ? `${days}天 ${time}` : time;
}

function openedTimeLabel(timestamp: number) {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

function formatPercent(value: number) {
  return `${Math.max(0, value).toFixed(1)}%`;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = Math.max(0, value);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[unit]}`;
}

const styles = `
.resource-panel {
  --resource-accent: var(--mint, #0a84ff);
  width: 100%;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  margin: 6px 10px 10px 0;
  display: flex;
  flex-direction: row;
  overflow: hidden;
  color: var(--text, #f5f5f7);
  background: color-mix(in srgb, var(--surface, #1c1c1e) 94%, transparent);
  border: 1px solid var(--line, rgba(255,255,255,.09));
  border-radius: 16px;
  box-shadow: 0 12px 36px rgba(0,0,0,.12);
}
.resource-panel *, .resource-panel *::before { box-sizing: border-box; }
.resource-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.resource-header { display: flex; align-items: center; gap: 10px; padding: 14px 14px 11px; }
.resource-heading-icon { width: 30px; height: 30px; display: grid; place-items: center; flex: none; color: var(--resource-accent); border: 1px solid color-mix(in srgb, var(--resource-accent) 16%, transparent); border-radius: 9px; background: color-mix(in srgb, var(--resource-accent) 8%, transparent); }
.resource-heading { flex: 1; min-width: 0; }
.resource-heading span { display: block; margin-bottom: 2px; color: var(--muted, #8e8e93); font-size: 8px; font-weight: 650; letter-spacing: .12em; }
.resource-heading h2 { margin: 0; font-size: 16px; line-height: 1.2; letter-spacing: -.025em; }
.resource-close, .resource-card-close { display: inline-grid; place-items: center; padding: 0; border: 0; color: var(--muted, #8e8e93); background: transparent; cursor: pointer; }
.resource-close { width: 30px; height: 30px; border-radius: 9px; }
.resource-close:hover, .resource-card-close:hover { color: var(--text, #f5f5f7); background: var(--surface-3, rgba(120,120,128,.2)); }
.resource-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; padding: 0 12px 10px; }
.resource-stat { min-width: 0; padding: 7px 8px; border: 1px solid var(--line, rgba(255,255,255,.07)); border-radius: 10px; background: color-mix(in srgb, var(--surface-2, #2c2c2e) 52%, transparent); }
.resource-stat-label { display: flex; align-items: center; gap: 5px; color: var(--muted, #9898a0); font-size: 9px; white-space: nowrap; }
.resource-stat-label svg { color: var(--resource-accent); }
.resource-stat strong { display: block; margin-top: 4px; font-size: 18px; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: -.035em; }
.resource-stat-recording .resource-stat-label svg { color: var(--danger, #ff453a); }
.resource-section-title { display: flex; align-items: center; justify-content: space-between; padding: 8px 14px 6px; color: var(--muted, #9898a0); border-top: 1px solid var(--line, rgba(255,255,255,.07)); font-size: 10px; font-weight: 600; }
.resource-section-title span:last-child { color: var(--faint, #72727a); font-size: 9px; font-weight: 450; }
.resource-list { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 6px; overflow: auto; padding: 1px 9px 10px; }
.resource-card { position: relative; flex: none; overflow: hidden; border: 1px solid var(--line, rgba(255,255,255,.07)); border-radius: 12px; background: color-mix(in srgb, var(--surface-2, #2c2c2e) 60%, transparent); transition: border-color .16s ease, background .16s ease, transform .16s ease; }
.resource-card:hover { border-color: var(--line-strong, rgba(255,255,255,.16)); background: var(--surface-2, #2c2c2e); }
.resource-card.active { border-color: color-mix(in srgb, var(--resource-accent) 40%, transparent); background: color-mix(in srgb, var(--resource-accent) 6%, var(--surface-2, #2c2c2e)); box-shadow: inset 3px 0 0 var(--resource-accent); }
.resource-card-focus { width: 100%; display: block; padding: 9px 10px; border: 0; color: inherit; background: transparent; text-align: left; cursor: pointer; }
.resource-card-top { display: flex; align-items: center; gap: 8px; padding-right: 22px; }
.resource-system { width: 28px; height: 28px; display: grid; place-items: center; flex: none; color: var(--system-icon-color, var(--muted)); border: 1px solid color-mix(in srgb, currentColor 13%, transparent); border-radius: 8px; background: color-mix(in srgb, currentColor 7%, transparent); }
.resource-system .system-icon { display: inline-flex; align-items: center; justify-content: center; color: var(--system-icon-color, currentColor); line-height: 0; }
.resource-card-identity { min-width: 0; flex: 1; }
.resource-card-title { display: flex; align-items: center; gap: 6px; min-width: 0; }
.resource-card-title strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 600; }
.resource-protocol { flex: none; color: var(--faint, #7c7c84); font-size: 8px; font-weight: 700; letter-spacing: .08em; }
.resource-address { display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted, #a1a1a8); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9px; }
.resource-card-close { position: absolute; z-index: 1; top: 6px; right: 6px; width: 22px; height: 22px; border-radius: 6px; opacity: .7; }
.resource-card:hover .resource-card-close, .resource-card-close:focus-visible { opacity: 1; }
.resource-meta { display: grid; gap: 4px; margin-top: 8px; padding-top: 7px; border-top: 1px solid var(--line, rgba(255,255,255,.06)); }
.resource-meta-row { min-width: 0; display: flex; align-items: center; gap: 7px; color: var(--muted, #9898a0); font-size: 9px; }
.resource-meta-row > svg { flex: none; color: var(--faint, #7c7c84); }
.resource-meta-value { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text, #e8e8ed); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9px; }
.resource-runtime { flex: none; margin-left: auto; color: var(--text, #e8e8ed); font-variant-numeric: tabular-nums; }
.resource-card-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 7px; }
.resource-state { display: inline-flex; align-items: center; gap: 5px; color: var(--muted, #9898a0); font-size: 9px; }
.resource-state i { width: 6px; height: 6px; flex: none; border-radius: 50%; background: currentColor; }
.resource-state-connected { color: var(--mint, #30d158); }
.resource-state-connected i { box-shadow: 0 0 8px color-mix(in srgb, currentColor 45%, transparent); }
.resource-state-connecting { color: var(--warning, #ffd60a); }
.resource-state-error { color: var(--danger, #ff453a); }
.resource-recording { display: inline-flex; align-items: center; gap: 4px; color: var(--danger, #ff453a); font-size: 9px; }
.resource-recording i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.resource-live { padding: 0 10px 10px; }
.resource-live-heading { display: flex; align-items: center; justify-content: space-between; min-height: 25px; padding-top: 7px; border-top: 1px solid var(--line, rgba(255,255,255,.07)); color: var(--muted, #9898a0); font-size: 9px; font-weight: 600; }
.resource-refresh { width: 24px; height: 24px; display: inline-grid; place-items: center; padding: 0; border: 0; border-radius: 6px; color: var(--muted, #9898a0); background: transparent; cursor: pointer; }
.resource-refresh:hover { color: var(--resource-accent); background: color-mix(in srgb, var(--resource-accent) 8%, transparent); }
.resource-peer { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: 6px; margin: 3px 0 7px; }
.resource-peer > span { min-width: 0; color: var(--faint, #7c7c84); font-size: 8px; }
.resource-peer strong { display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text, #e8e8ed); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9px; font-weight: 500; }
.resource-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
.resource-metric { min-width: 0; padding: 6px 7px; border-radius: 8px; background: color-mix(in srgb, var(--surface-3, #3a3a3c) 42%, transparent); }
.resource-metric > span { display: block; color: var(--faint, #85858d); font-size: 8px; }
.resource-metric strong { display: block; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text, #f5f5f7); font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; }
.resource-metric small { display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted, #9898a0); font-size: 8px; font-variant-numeric: tabular-nums; }
.resource-metric.network strong { display: flex; align-items: center; gap: 4px; color: var(--resource-accent); }
.resource-process-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 9px; color: var(--muted, #9898a0); font-size: 9px; font-weight: 600; }
.resource-process-count { color: var(--faint, #7c7c84); font-weight: 450; }
.resource-process-sort { display: inline-flex; padding: 2px; border-radius: 6px; background: color-mix(in srgb, var(--surface-3, #3a3a3c) 45%, transparent); }
.resource-process-sort button { padding: 2px 6px; border: 0; border-radius: 4px; color: var(--muted, #9898a0); background: transparent; font-size: 8px; cursor: pointer; }
.resource-process-sort button[aria-pressed="true"] { color: var(--text, #f5f5f7); background: var(--surface-3, #3a3a3c); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.resource-process-columns, .resource-process-row { display: grid; grid-template-columns: minmax(0, 1fr) 38px 38px 34px; align-items: center; gap: 4px; }
.resource-process-columns { padding: 6px 2px 4px; color: var(--faint, #72727a); font-size: 7px; text-align: right; }
.resource-process-columns span:first-child { text-align: left; }
.resource-process-row { min-height: 25px; padding: 3px 2px; border-top: 1px solid color-mix(in srgb, var(--line, rgba(255,255,255,.07)) 60%, transparent); font-size: 8px; font-variant-numeric: tabular-nums; }
.resource-process-command { min-width: 0; }
.resource-process-command strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text, #e8e8ed); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 8px; font-weight: 500; }
.resource-process-command small { display: block; margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--faint, #7c7c84); font-size: 7px; }
.resource-process-value { overflow: hidden; color: var(--muted, #a1a1a8); text-align: right; }
.resource-process-action { min-width: 0; display: flex; justify-content: flex-end; }
.resource-process-kill, .resource-process-confirm button { padding: 3px 4px; border: 0; border-radius: 5px; font-size: 8px; cursor: pointer; }
.resource-process-kill { color: var(--faint, #8e8e93); background: transparent; }
.resource-process-kill:hover { color: var(--danger, #ff453a); background: color-mix(in srgb, var(--danger, #ff453a) 10%, transparent); }
.resource-process-confirm { grid-column: 1 / -1; display: flex; align-items: center; justify-content: flex-end; gap: 5px; padding: 3px 0; color: var(--danger, #ff453a); font-size: 8px; }
.resource-process-confirm button { color: var(--muted, #a1a1a8); background: var(--surface-3, #3a3a3c); }
.resource-process-confirm button.confirm { color: white; background: var(--danger, #ff453a); }
.resource-process-empty { margin: 5px 0 0; color: var(--faint, #7c7c84); font-size: 8px; text-align: center; }
.resource-empty { flex: 1; min-height: 210px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 24px; text-align: center; }
.resource-empty-icon { width: 48px; height: 48px; display: grid; place-items: center; margin-bottom: 14px; color: var(--resource-accent); border: 1px solid color-mix(in srgb, var(--resource-accent) 16%, transparent); border-radius: 15px; background: color-mix(in srgb, var(--resource-accent) 7%, transparent); }
.resource-empty strong { font-size: 13px; }
.resource-empty p { max-width: 205px; margin: 8px 0 0; color: var(--muted, #9898a0); font-size: 10px; line-height: 1.65; }
.resource-panel button:focus-visible { outline: 2px solid var(--resource-accent); outline-offset: 2px; }
@media (max-width: 1100px) { .resource-panel { width: 100%; flex-basis: auto; } }
@media (prefers-reduced-motion: reduce) { .resource-card { transition: none; } }
`;

export function ResourcePanel({ sessions, activeId, onFocus, onCloseSession, metrics, onRefreshMetrics, onTerminateProcess, onSendCommand = async () => false, view = 'resources' }: ResourcePanelProps) {
  const resourceList = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState('');
  const [processSort, setProcessSort] = useState<'cpu' | 'memory'>('cpu');
  const [confirmingPid, setConfirmingPid] = useState<number | null>(null);
  const online = sessions.filter((session) => session.state === 'connected').length;
  const recording = sessions.filter((session) => session.recording).length;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => setConfirmingPid(null), [activeId]);
  const stats = [
    { label: '连接数', value: sessions.length, Icon: Link2, className: '' },
    { label: '在线数', value: online, Icon: Activity, className: 'resource-stat-online' },
    { label: '录制数', value: recording, Icon: Disc3, className: 'resource-stat-recording' },
  ];
  const processes = metrics
    ? [...metrics.processes].sort((a, b) => b[processSort] - a[processSort] || a.pid - b.pid).slice(0, 8)
    : [];
  const visibleSessions = sessions.filter((session) => {
    const needle = query.trim().toLowerCase();
    return !needle || `${session.name} ${session.address || ''}`.toLowerCase().includes(needle);
  });

  return (
    <aside className="resource-panel" aria-label="资源与历史面板">
      <style>{styles}</style>
      <div className="resource-main">
      {view === 'resources' ? <>
      <div className="resource-stats">
        {stats.map(({ label, value, Icon, className }) => (
          <div className={`resource-stat ${className}`} key={label}>
            <span className="resource-stat-label"><Icon size={11} aria-hidden="true" />{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <label className="resource-filter"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选" aria-label="筛选终端会话" /></label>

      {sessions.length === 0 ? (
        <div className="resource-empty">
          <div className="resource-empty-icon"><Radio size={23} strokeWidth={1.6} /></div>
          <strong>暂无终端会话</strong>
          <p>打开本地 Shell 或远程连接后，运行状态会显示在这里。</p>
        </div>
      ) : (
        <div id="resource-session-list" ref={resourceList} className="resource-list">
          {visibleSessions.map((item) => {
            const session = item as SessionDetails;
            const openedAt = openedTimestamp(session.openedAt);
            const address = addressOf(session);
            const active = activeId === session.id;
            const system = session.os || session.platform;
            const cardStyle = { '--system-icon-color': system ? undefined : 'currentColor' } as CSSProperties;
            return (
              <article className={`resource-card${active ? ' active' : ''}`} data-state={session.state} key={session.id}>
                <button
                  type="button"
                  className="resource-card-focus"
                  onClick={() => onFocus(session.id)}
                  aria-label={`切换到 ${session.name}`}
                  aria-current={active ? 'true' : undefined}
                >
                  <div className="resource-card-top">
                    <span className="resource-system" style={cardStyle}><SystemIcon os={system} protocol={session.protocol} size={16} /></span>
                    <div className="resource-card-identity">
                      <div className="resource-card-title"><strong title={session.name}>{session.name}</strong><span className="resource-protocol">{protocolLabels[session.protocol]}</span></div>
                      <span className="resource-address" title={address}>{address}</span>
                    </div>
                  </div>
                  <div className="resource-meta">
                    <div className="resource-meta-row" title={session.cwd ? `当前目录：${session.cwd}` : '当前目录尚未同步'}>
                      <Folder size={12} aria-hidden="true" /><span className="resource-meta-value">{session.cwd || '目录未同步'}</span>
                    </div>
                    <div className="resource-meta-row" title={openedAt ? `打开时间：${openedTimeLabel(openedAt)}` : '打开时间尚未同步'}>
                      <Clock3 size={12} aria-hidden="true" /><span>运行时长</span><time className="resource-runtime">{openedAt ? formatDuration(now - openedAt) : '—'}</time>
                    </div>
                  </div>
                  <div className="resource-card-footer">
                    <span className={`resource-state resource-state-${session.state}`}><i />{stateLabels[session.state]}</span>
                    {session.recording && <span className="resource-recording"><i />录制中</span>}
                  </div>
                </button>
                {active && metrics && (
                  <section className="resource-live" aria-label={`${session.name} 实时资源`}>
                    <div className="resource-live-heading">
                      <span>实时资源</span>
                      {onRefreshMetrics && <button type="button" className="resource-refresh" onClick={onRefreshMetrics} aria-label="刷新资源指标" title="刷新资源指标"><RefreshCw size={12} /></button>}
                    </div>
                    <div className="resource-peer">
                      <span>用户<strong title={metrics.user}>{metrics.user || '—'}</strong></span>
                      <span>IP<strong title={metrics.ip}>{metrics.ip || '—'}</strong></span>
                    </div>
                    <div className="resource-metrics">
                      <div className="resource-metric"><span>CPU</span><strong>{formatPercent(metrics.cpuPercent)}</strong></div>
                      <div className="resource-metric"><span>内存</span><strong>{formatPercent(metrics.memoryPercent)}</strong><small>{formatBytes(metrics.memoryUsed)} / {formatBytes(metrics.memoryTotal)}</small></div>
                      <div className="resource-metric network"><span>下行速率</span><strong><ArrowDown size={11} />{formatBytes(metrics.rxPerSecond)}/s</strong></div>
                      <div className="resource-metric network"><span>上行速率</span><strong><ArrowUp size={11} />{formatBytes(metrics.txPerSecond)}/s</strong></div>
                    </div>
                    <div className="resource-process-heading">
                      <span>进程 <span className="resource-process-count">{metrics.processes.length}</span></span>
                      <div className="resource-process-sort" role="group" aria-label="进程排序">
                        <button type="button" aria-pressed={processSort === 'cpu'} onClick={() => setProcessSort('cpu')}>CPU</button>
                        <button type="button" aria-pressed={processSort === 'memory'} onClick={() => setProcessSort('memory')}>内存</button>
                      </div>
                    </div>
                    {processes.length > 0 && <div className="resource-process-columns" aria-hidden="true"><span>进程 / PID</span><span>CPU</span><span>内存</span><span /></div>}
                    <div className="resource-process-list">
                      {processes.length === 0 ? <p className="resource-process-empty">暂无进程数据</p> : processes.map((process) => (
                        <div className="resource-process-row" key={process.pid}>
                          <div className="resource-process-command"><strong title={process.command}>{processDisplayName(process.command) || '—'}</strong><small>{process.pid} · {process.user || '—'}</small></div>
                          <span className="resource-process-value">{process.cpu.toFixed(1)}%</span>
                          <span className="resource-process-value">{process.memory.toFixed(1)}%</span>
                          <span className="resource-process-action">
                            {onTerminateProcess && confirmingPid !== process.pid && <button type="button" className="resource-process-kill" onClick={() => setConfirmingPid(process.pid)} aria-label={`结束进程 ${process.pid}`}>结束</button>}
                          </span>
                          {onTerminateProcess && confirmingPid === process.pid && (
                            <div className="resource-process-confirm" role="group" aria-label={`确认结束进程 ${process.pid}`}>
                              <span>确认结束 PID {process.pid}？</span>
                              <button type="button" className="confirm" onClick={() => { onTerminateProcess(process.pid); setConfirmingPid(null); }}>确认</button>
                              <button type="button" onClick={() => setConfirmingPid(null)}>取消</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                <button
                  type="button"
                  className="resource-card-close"
                  onClick={() => onCloseSession(session.id)}
                  aria-label={`关闭 ${session.name}`}
                  title={`关闭 ${session.name}`}
                ><X size={13} /></button>
              </article>
            );
          })}
        </div>
      )}
      <HorizontalScrollbar target={resourceList} targetId="resource-session-list" label="横向查看资源内容" refreshKey={sessions.length} />
      </> : <ResourceHistory onSendCommand={onSendCommand} />}
      </div>
    </aside>
  );
}

export default ResourcePanel;
