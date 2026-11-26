import { useEffect, useRef, type ComponentType } from 'react';
import { Activity, ArrowLeftRight, Check, FolderOpen, History, PanelLeft, Plus, Send, Settings, SquareTerminal } from 'lucide-react';
import type { PanelModule, PanelSide } from '../preferences';

interface PanelMenuProps {
  side: PanelSide;
  modules: Record<PanelModule, boolean>;
  onToggleModule: (module: PanelModule) => void;
  onSender: () => void;
  onShell: () => void;
  onTransfers: () => void;
  onClose: () => void;
  onOpenSettings: () => void;
  onNewConnection: () => void;
}

interface PanelMenuItemProps {
  label: string;
  icon: ComponentType<{ size?: number }>;
  onSelect: () => void;
  checked?: boolean;
}

function PanelMenuItem({ label, icon: Icon, onSelect, checked }: PanelMenuItemProps) {
  const toggle = checked !== undefined;
  return <button
    type="button"
    className={`panel-menu-item${checked ? ' panel-menu-item-checked' : ''}`}
    role={toggle ? 'menuitemcheckbox' : 'menuitem'}
    aria-checked={toggle ? checked : undefined}
    onClick={onSelect}
  >
    <span className="panel-menu-check" aria-hidden="true">{checked && <Check size={14} />}</span>
    <span className="panel-menu-icon"><Icon size={16} /></span>
    <span className="panel-menu-label">{label}</span>
  </button>;
}

export function PanelMenu(props: PanelMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const items = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('.panel-menu-item') ?? []);
    items()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const buttons = items();
      if (!buttons.length) return;
      event.preventDefault();
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? buttons.length - 1
          : event.key === 'ArrowDown' ? (current + 1 + buttons.length) % buttons.length
            : (current - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, []);

  const run = (action: () => void, close = true) => {
    action();
    if (close) onClose();
  };

  return <div className="panel-menu-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`panel-menu panel-menu-${props.side}`} role="menu" aria-label="窗口面板" ref={menu}>
      <div className="panel-menu-heading">{props.side === 'left' ? '左侧' : '右侧'}窗格 · 点击显示或移到这里</div>
      <PanelMenuItem label="会话" icon={PanelLeft} checked={props.modules.sessions} onSelect={() => run(() => props.onToggleModule('sessions'), false)} />
      <PanelMenuItem label="文件管理器" icon={FolderOpen} checked={props.modules.files} onSelect={() => run(() => props.onToggleModule('files'), false)} />
      <PanelMenuItem label="资源管理器" icon={Activity} checked={props.modules.resources} onSelect={() => run(() => props.onToggleModule('resources'), false)} />
      <PanelMenuItem label="历史命令" icon={History} checked={props.modules.history} onSelect={() => run(() => props.onToggleModule('history'), false)} />
      <div className="panel-menu-separator" role="separator" />
      <PanelMenuItem label="新建连接" icon={Plus} onSelect={() => run(props.onNewConnection)} />
      <PanelMenuItem label="批量发送" icon={Send} onSelect={() => run(props.onSender)} />
      <PanelMenuItem label="本地 Shell" icon={SquareTerminal} onSelect={() => run(props.onShell)} />
      <PanelMenuItem label="传输记录" icon={ArrowLeftRight} onSelect={() => run(props.onTransfers)} />
      <div className="panel-menu-separator" role="separator" />
      <PanelMenuItem label="全部设置" icon={Settings} onSelect={() => run(props.onOpenSettings)} />
    </div>
  </div>;
}
