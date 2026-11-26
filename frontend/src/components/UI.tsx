import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, Check, Info, X } from 'lucide-react';

export function IconButton({ label, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

interface ModalProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  size?: 'small' | 'medium' | 'large';
}

export function Modal({ title, subtitle, children, footer, onClose, size = 'medium' }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => panel.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus(), 30);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onCloseRef.current(); }
      if (event.key === 'Tab' && panel.current) {
        const items = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'));
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => { window.clearTimeout(timer); document.removeEventListener('keydown', keydown, true); previous?.focus(); };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={panel}>
        <header className="modal-header">
          <div><span className="eyebrow">Lucas 工作台</span><h2 id="modal-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
          <IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = '删除', danger = true, onConfirm, onClose }: {
  title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return <Modal title={title} onClose={onClose} size="small" footer={<><button className="button secondary" onClick={onClose}>取消</button><button className={`button ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button></>}>
    <div className="confirm-message"><AlertTriangle size={22} /><p>{message}</p></div>
  </Modal>;
}

export type ToastItem = { id: string; message: string; tone: 'success' | 'error' | 'info' };
export function Toasts({ items, dismiss }: { items: ToastItem[]; dismiss: (id: string) => void }) {
  return <div className="toast-stack" aria-live="polite">{items.map((item) => <button key={item.id} className={`toast ${item.tone}`} onClick={() => dismiss(item.id)}>
    {item.tone === 'success' ? <Check size={16} /> : item.tone === 'error' ? <AlertTriangle size={16} /> : <Info size={16} />}
    <span>{item.message}</span><X size={14} />
  </button>)}</div>;
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><div>{children}</div></div>;
}
