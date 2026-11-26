import { useMemo, useState } from 'react';
import { Clock3, History, Search, Send, Trash2 } from 'lucide-react';
import { clearHistory, listHistory, type HistoryEntry } from '../commandHistory';
import { Modal } from './UI';

interface HistoryDialogProps {
  onSend: (command: string) => void;
  onClose: () => void;
}

function formatTime(time: number): string {
  return new Date(time).toLocaleString('zh-CN', { hour12: false });
}

export function HistoryDialog({ onSend, onClose }: HistoryDialogProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>(() => listHistory());
  const [query, setQuery] = useState('');
  const [confirmingClear, setConfirmingClear] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleEntries = useMemo(() => entries.filter((entry) => (
    !normalizedQuery
    || entry.command.toLocaleLowerCase().includes(normalizedQuery)
    || entry.sessionName.toLocaleLowerCase().includes(normalizedQuery)
  )), [entries, normalizedQuery]);

  const send = (command: string) => {
    onSend(command);
    onClose();
  };
  const clear = () => {
    clearHistory();
    setEntries([]);
    setConfirmingClear(false);
  };

  return <Modal
    title="历史命令"
    subtitle="搜索并重新发送这台设备上记录过的命令。"
    onClose={onClose}
    size="large"
    footer={<div className="history-footer">
      <span className="history-count">共 {entries.length} 条，最多保留 200 条</span>
      <button type="button" className="history-clear" disabled={!entries.length} onClick={() => setConfirmingClear(true)}>
        <Trash2 size={15} />清空历史
      </button>
    </div>}
  >
    <div className="history-dialog">
      <label className="history-search">
        <Search size={17} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索命令或会话名称…" aria-label="搜索历史命令" />
      </label>
      {confirmingClear && <div className="history-confirm" role="alert">
        <div className="history-confirm-copy"><strong>清空全部历史？</strong><span>此操作无法撤销。</span></div>
        <div className="history-confirm-actions">
          <button type="button" className="history-confirm-cancel" onClick={() => setConfirmingClear(false)}>取消</button>
          <button type="button" className="history-confirm-delete" onClick={clear}>确认清空</button>
        </div>
      </div>}
      <div className="history-list">
        {visibleEntries.map((entry) => <button type="button" className="history-entry" key={entry.id} onClick={() => send(entry.command)} title="点击发送此命令">
          <span className="history-entry-icon"><History size={17} /></span>
          <span className="history-entry-content">
            <code className="history-command">{entry.command}</code>
            <span className="history-meta">
              <span className="history-session">{entry.sessionName || '未知会话'}</span>
              <time className="history-time" dateTime={new Date(entry.time).toISOString()}><Clock3 size={12} />{formatTime(entry.time)}</time>
            </span>
          </span>
          <Send className="history-send-icon" size={16} />
        </button>)}
        {!visibleEntries.length && <div className="history-empty">
          <History size={28} />
          <p>{entries.length ? '没有匹配的历史命令。' : '暂无历史命令，在终端执行命令后会显示在这里。'}</p>
        </div>}
      </div>
    </div>
  </Modal>;
}
