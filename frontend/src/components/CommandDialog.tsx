import { useState } from 'react';
import { Command, Play, Plus, Send, Trash2 } from 'lucide-react';
import type { SavedCommand, Session } from '../types';
import { Modal } from './UI';

export function CommandDialog({ sessions, activeSessionId, saved, onSavedChange, onSend, onClose }: {
  sessions: Session[]; activeSessionId?: string; saved: SavedCommand[];
  onSavedChange: (commands: SavedCommand[]) => void; onSend: (command: string, ids: string[]) => Promise<void>; onClose: () => void;
}) {
  const available = sessions.filter((session) => session.state === 'connected');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(activeSessionId ? [activeSessionId] : available[0] ? [available[0].id] : []));
  const [command, setCommand] = useState('');
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const send = async () => {
    if (!command.trim()) { setError('请输入要发送的命令。'); return; }
    if (!selected.size) { setError('请至少选择一个已连接的会话。'); return; }
    setSaving(true); setError('');
    try {
      await onSend(command, Array.from(selected));
      if (saveName.trim()) onSavedChange([...saved, { id: crypto.randomUUID(), name: saveName.trim(), command }]);
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  return <Modal title="命令中心" subtitle="在单个终端执行，或同时发送到多个已连接会话。" onClose={onClose} size="large" footer={<><span className="command-footer-hint"><kbd>⌘</kbd><kbd>↵</kbd> 发送</span><button className="button primary" onClick={() => void send()} disabled={saving}><Send size={15} />发送到 {selected.size || 0} 个会话</button></>}>
    <div className="command-layout"><aside className="saved-commands"><div className="section-label">已保存命令 <span>{saved.length}</span></div>{saved.length === 0 && <div className="saved-empty"><Command size={23} /><p>保存常用命令，下次一键使用。</p></div>}{saved.map((item) => <div className="saved-command" key={item.id}><button onClick={() => setCommand(item.command)}><strong>{item.name}</strong><code>{item.command}</code></button><button aria-label={`删除 ${item.name}`} onClick={() => onSavedChange(saved.filter((savedItem) => savedItem.id !== item.id))}><Trash2 size={13} /></button></div>)}</aside><div className="command-composer"><label className="field"><span>命令</span><textarea className="command-input" value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void send(); } }} placeholder="例如：git status" spellCheck={false} /></label><div className="save-command-row"><input value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="保存为（可选）" aria-label="命令保存名称" /><Plus size={15} /></div><div className="session-targets"><div className="section-label">目标会话 <button onClick={() => setSelected(new Set(available.map((session) => session.id)))}>全选</button></div>{available.length === 0 && <p className="field-help">当前没有已连接的会话。</p>}{available.map((session) => <label className={`session-target ${selected.has(session.id) ? 'selected' : ''}`} key={session.id}><input type="checkbox" checked={selected.has(session.id)} onChange={() => toggle(session.id)} /><span className={`status-pill ${session.state}`}><i /></span><span><strong>{session.name}</strong><small>{session.protocol.toUpperCase()}</small></span><Play size={14} /></label>)}</div>{error && <div className="form-error">{error}</div>}</div></div>
  </Modal>;
}
