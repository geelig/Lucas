import { useEffect, useMemo, useState } from 'react';
import { Clock3, Search, Send } from 'lucide-react';
import { listHistory, type HistoryEntry } from '../commandHistory';

const styles = `
.resource-history { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: transparent; }
.resource-history-body { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 8px 9px 7px; }
.resource-history-search { flex: none; display: flex; align-items: center; gap: 6px; height: 29px; padding: 0 7px; border: 1px solid var(--line, rgba(255,255,255,.07)); border-radius: 7px; color: var(--faint, #7c7c84); background: color-mix(in srgb, var(--surface, #1c1c1e) 65%, transparent); }
.resource-history-search:focus-within { border-color: color-mix(in srgb, var(--resource-accent) 45%, transparent); }
.resource-history-search input { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; outline: 0; color: var(--text, #f5f5f7); background: transparent; font-size: 10px; }
.resource-history-search input::placeholder { color: var(--faint, #7c7c84); }
.resource-history-list { flex: 1; min-height: 0; margin-top: 5px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.resource-history-row { display: flex; align-items: center; gap: 7px; width: 100%; min-height: 37px; padding: 4px 5px; border: 0; border-bottom: 1px solid color-mix(in srgb, var(--line, rgba(255,255,255,.07)) 65%, transparent); border-radius: 5px; color: var(--muted, #9898a0); background: transparent; text-align: left; cursor: pointer; }
.resource-history-row:hover:not(:disabled) { color: var(--resource-accent); background: color-mix(in srgb, var(--resource-accent) 7%, transparent); }
.resource-history-row:disabled { opacity: .55; cursor: wait; }
.resource-history-row > svg { flex: none; }
.resource-history-command { flex: 1; min-width: 0; }
.resource-history-command code { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text, #e8e8ed); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; }
.resource-history-command small { display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--faint, #7c7c84); font-size: 8px; }
.resource-history-empty { flex: 1; display: grid; place-items: center; padding: 10px; color: var(--faint, #7c7c84); font-size: 9px; line-height: 1.5; text-align: center; }
.resource-history-status { flex: none; margin: 3px 2px 0; color: var(--danger, #ff453a); font-size: 9px; }
`;

export function filterResourceHistory(entries: HistoryEntry[], query: string, limit = 30): HistoryEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter((entry) => !needle
    || entry.command.toLocaleLowerCase().includes(needle)
    || entry.sessionName.toLocaleLowerCase().includes(needle)).slice(0, limit);
}

export function ResourceHistory({ onSendCommand }: { onSendCommand: (command: string) => Promise<boolean> }) {
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<HistoryEntry[]>(() => listHistory());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [sendFailed, setSendFailed] = useState(false);
  const visibleEntries = useMemo(() => filterResourceHistory(entries, query), [entries, query]);

  useEffect(() => {
    const update = () => setEntries(listHistory());
    window.addEventListener('lucas:history-changed', update);
    return () => window.removeEventListener('lucas:history-changed', update);
  }, []);

  const send = async (entry: HistoryEntry) => {
    if (pendingId) return;
    setPendingId(entry.id);
    setSendFailed(false);
    try { setSendFailed(!(await onSendCommand(entry.command))); }
    catch { setSendFailed(true); }
    finally { setPendingId(null); }
  };

  return <section className="resource-history" aria-label="命令历史">
    <style>{styles}</style>
    <div className="resource-history-body">
      <label className="resource-history-search"><Search size={12} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索命令或会话" aria-label="搜索历史命令" spellCheck={false} /></label>
      <div className="resource-history-list" aria-label="最近命令">
        {visibleEntries.map((entry) => <button type="button" className="resource-history-row" key={entry.id} disabled={pendingId !== null} title={`点击发送：${entry.command}`} onClick={() => void send(entry)}>
          <Clock3 size={12} aria-hidden="true" /><span className="resource-history-command"><code>{entry.command}</code><small>{entry.sessionName || '未知会话'} · {new Date(entry.time).toLocaleTimeString('zh-CN', { hour12: false })}</small></span><Send size={11} aria-hidden="true" />
        </button>)}
        {!visibleEntries.length && <div className="resource-history-empty">{entries.length ? '没有匹配的历史命令' : '暂无历史命令，在终端执行命令后会显示在这里'}</div>}
      </div>
      {sendFailed && <p className="resource-history-status" role="status">发送失败，请检查当前终端连接</p>}
    </div>
  </section>;
}

export default ResourceHistory;
