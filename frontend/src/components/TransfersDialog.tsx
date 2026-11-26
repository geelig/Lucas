import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, CircleAlert, CircleX, LoaderCircle, X } from 'lucide-react';
import type { Transfer } from '../types';
import { Modal } from './UI';

interface TransfersDialogProps {
  transfers: Transfer[];
  onCancel: (id: string) => void;
  onClose: () => void;
}

const stateLabels: Record<Transfer['state'], string> = {
  running: '传输中',
  done: '已完成',
  error: '失败',
  cancelled: '已取消',
};

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / (1024 ** unit);
  return `${amount.toFixed(unit === 0 || amount >= 10 ? 0 : 1)} ${units[unit]}`;
}

function StateIcon({ state }: { state: Transfer['state'] }) {
  if (state === 'running') return <LoaderCircle className="transfer-history-state-running" size={16} />;
  if (state === 'done') return <CheckCircle2 className="transfer-history-state-done" size={16} />;
  if (state === 'error') return <CircleAlert className="transfer-history-state-error" size={16} />;
  return <CircleX className="transfer-history-state-cancelled" size={16} />;
}

export function TransfersDialog({ transfers, onCancel, onClose }: TransfersDialogProps) {
  const running = transfers.filter((transfer) => transfer.state === 'running').length;
  return <Modal
    title="传输记录"
    subtitle="查看文件上传、下载的进度和状态。"
    onClose={onClose}
    size="large"
    footer={<div className="transfer-history-footer"><span>{running ? `${running} 项正在传输` : '当前没有正在进行的传输'}</span><span>共 {transfers.length} 项</span></div>}
  >
    <div className="transfer-history-list">
      {transfers.map((transfer) => {
        const progress = transfer.total > 0 ? Math.min(100, Math.max(0, transfer.transferred / transfer.total * 100)) : undefined;
        const download = transfer.direction === 'download';
        return <article className={`transfer-history-entry transfer-history-${transfer.state}`} key={transfer.id}>
          <div className="transfer-history-direction" title={download ? '下载' : '上传'}>
            {download ? <ArrowDownToLine size={19} /> : <ArrowUpFromLine size={19} />}
          </div>
          <div className="transfer-history-content">
            <div className="transfer-history-heading">
              <div className="transfer-history-name"><strong title={transfer.name}>{transfer.name}</strong><span>{download ? '下载' : '上传'}</span></div>
              <span className={`transfer-history-status transfer-history-status-${transfer.state}`}><StateIcon state={transfer.state} />{stateLabels[transfer.state]}</span>
            </div>
            <div className="transfer-history-progress-row">
              <progress className="transfer-history-progress" max={100} value={progress} aria-label={`${transfer.name}传输进度`} />
              <span className="transfer-history-progress-label">{progress === undefined ? `${formatBytes(transfer.transferred)} 已传输` : `${Math.round(progress)}%`}</span>
            </div>
            <div className="transfer-history-details">
              <span>{formatBytes(transfer.transferred)} / {transfer.total > 0 ? formatBytes(transfer.total) : '未知大小'}</span>
              {transfer.error && <span className="transfer-history-error" role="alert">{transfer.error}</span>}
            </div>
          </div>
          {transfer.state === 'running' && <button type="button" className="transfer-history-cancel" onClick={() => onCancel(transfer.id)} aria-label={`取消传输 ${transfer.name}`} title="取消传输"><X size={16} /></button>}
        </article>;
      })}
      {!transfers.length && <div className="transfer-history-empty"><ArrowUpFromLine size={28} /><p>暂无传输记录。</p></div>}
    </div>
  </Modal>;
}
