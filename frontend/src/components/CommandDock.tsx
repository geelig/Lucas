import { useState } from 'react';
import { ChevronDown, ChevronUp, Command, Plus, Send, X } from 'lucide-react';
import type { Preferences, SavedCommand } from '../types';
import { uid } from '../utils';

const styles = `
.command-dock { flex: none; border-top: 1px solid var(--line); background: var(--surface); }
.command-dock-single { display: flex; align-items: center; gap: 5px; height: 31px; padding: 0 5px; }
.command-dock-reopen { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; height: 25px; border: 0; border-top: 1px solid var(--line); color: var(--muted); background: var(--surface); }
.command-dock-reopen:hover { color: var(--text); background: var(--surface-2); }
.command-dock-close, .command-dock-add { display: grid; flex: none; place-items: center; width: 25px; height: 25px; border: 0; color: var(--muted); background: transparent; }
.command-dock-close { margin-left: auto; }
.command-dock-chips { display: flex; flex: 1; align-items: center; gap: 5px; min-width: 0; min-height: 25px; overflow-x: auto; scrollbar-width: none; }
.command-dock-chips::-webkit-scrollbar { display: none; }
.command-chip { display: inline-flex; flex: none; align-items: center; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-2); }
.command-chip > button { height: 22px; padding: 0 6px; border: 0; color: var(--muted); background: transparent; font-size: 10px; }
.command-chip > button:first-child { max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.command-chip-delete { width: 20px; padding: 0 !important; }
.command-editor { display: flex; flex: 1; align-items: center; gap: 5px; min-width: 0; }
.command-editor input { flex: 1; min-width: 0; height: 25px; padding: 0 8px; font: 10px var(--font-mono, monospace); }
.command-dock-action { display: inline-flex; flex: none; align-items: center; gap: 4px; height: 25px; padding: 0 8px; border: 1px solid var(--line); border-radius: 6px; color: var(--text); background: var(--surface-2); font-size: 10px; }
.command-dock-action.primary { color: #fff; background: #007acc; border-color: #007acc; }
`;

export function CommandDock({ preferences, onPreferencesChange, savedCommands, onSavedChange, onSend, collapsed = false }: {
  preferences: Preferences; onPreferencesChange: (value: Preferences) => void;
  savedCommands: SavedCommand[]; onSavedChange: (value: SavedCommand[]) => void;
  onSend: (command: string) => Promise<boolean>; collapsed?: boolean;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  if (collapsed) return <><style>{styles}</style><button className="command-dock-reopen" aria-label="展开常用命令" title="展开常用命令" onClick={() => onPreferencesChange({ ...preferences, commandPanelOpen: true })}><Command size={12} /><ChevronUp size={12} /></button></>;

  const send = async () => {
    const command = value.trim();
    if (!command || busy) return;
    setBusy(true);
    try { if (await onSend(command)) { setValue(''); setEditing(false); } } finally { setBusy(false); }
  };
  const save = () => {
    const command = value.trim();
    if (!command) return;
    const name = command.split(/\s+/).slice(0, 4).join(' ').slice(0, 32);
    onSavedChange([...savedCommands, { id: uid(), name, command }]);
    setValue(''); setEditing(false);
  };

  return <section className="command-dock" aria-label="终端命令面板">
    <style>{styles}</style>
    <div className="command-dock-single">
      {editing ? <div className="command-editor">
        <input autoFocus aria-label="常用命令输入" value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void send(); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); } if (event.key === 'Escape') setEditing(false); }} placeholder="输入命令，回车发送，点击保存加入常用命令" spellCheck={false} />
        <button className="command-dock-action primary" disabled={busy || !value.trim()} onClick={() => void send()}><Send size={11} />发送</button>
        <button className="command-dock-action" disabled={!value.trim()} onClick={save}><Plus size={11} />保存</button>
        <button className="command-dock-add" aria-label="取消编辑命令" onClick={() => setEditing(false)}><X size={12} /></button>
      </div> : <>
        <div className="command-dock-chips">{savedCommands.map((item) => <span className="command-chip" key={item.id}><button title={item.command} onClick={() => void onSend(item.command)}>{item.name}</button><button className="command-chip-delete" aria-label={`删除常用命令 ${item.name}`} onClick={() => onSavedChange(savedCommands.filter((command) => command.id !== item.id))}><X size={10} /></button></span>)}</div>
        <button className="command-dock-add" aria-label="添加常用命令" title="添加常用命令" onClick={() => setEditing(true)}><Plus size={13} /></button>
      </>}
      <button className="command-dock-close" aria-label="收起命令面板" title="收起后单击底部图标即可恢复" onClick={() => onPreferencesChange({ ...preferences, commandPanelOpen: false })}><ChevronDown size={14} /></button>
    </div>
  </section>;
}
