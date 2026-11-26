import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Settings } from 'lucide-react';
import type { PanelModule, PanelSide } from '../preferences';

export interface DockModule {
  id: PanelModule;
  label: string;
  icon: ReactNode;
}

interface PanelDockProps {
  side: PanelSide;
  modules: DockModule[];
  active: PanelModule;
  onChange: (module: PanelModule) => void;
  onOpenSettings: () => void;
  children: ReactNode;
}

export function PanelDock({ side, modules, active, onChange, onOpenSettings, children }: PanelDockProps) {
  const sideLabel = side === 'left' ? '左侧' : '右侧';
  const tabList = useRef<HTMLDivElement>(null);
  const moduleKey = modules.map((module) => module.id).join(',');
  useEffect(() => {
    const list = tabList.current;
    const selected = list?.querySelector<HTMLElement>(`[data-module="${active}"]`);
    if (!list || !selected) return;
    const listBounds = list.getBoundingClientRect();
    const selectedBounds = selected.getBoundingClientRect();
    if (selectedBounds.left < listBounds.left) list.scrollLeft -= listBounds.left - selectedBounds.left;
    else if (selectedBounds.right > listBounds.right) list.scrollLeft += selectedBounds.right - listBounds.right;
  }, [active, moduleKey]);
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const current = (event.target as HTMLElement).dataset.module;
    const index = Math.max(0, modules.findIndex((module) => module.id === current));
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? modules.length - 1
      : event.key === 'ArrowRight' ? (index + 1) % modules.length : (index - 1 + modules.length) % modules.length;
    const next = modules[nextIndex];
    if (!next) return;
    event.preventDefault();
    onChange(next.id);
    tabList.current?.querySelector<HTMLElement>(`[data-module="${next.id}"]`)?.focus();
  };
  return <div className="left-console panel-dock">
    <div className="left-panel-tabs panel-dock-tabs">
      <div className="panel-dock-tab-scroll" role="tablist" aria-label={`${sideLabel}面板`} ref={tabList} onKeyDown={onTabKeyDown}>
        {modules.map((module) => <button
          key={module.id}
          id={`${side}-tab-${module.id}`}
          data-module={module.id}
          role="tab"
          aria-selected={active === module.id}
          aria-controls={active === module.id ? `${side}-panel-${module.id}` : undefined}
          className={active === module.id ? 'active' : ''}
          tabIndex={active === module.id ? 0 : -1}
          onClick={() => onChange(module.id)}
        >{module.icon}{module.label}</button>)}
      </div>
      <button className="left-panel-settings" aria-label={`${sideLabel}面板设置`} title={`${sideLabel}面板设置`} onClick={onOpenSettings}><Settings size={15} /></button>
    </div>
    <div className="left-panel-content panel-dock-content" id={`${side}-panel-${active}`} role="tabpanel" aria-labelledby={`${side}-tab-${active}`}>{children}</div>
  </div>;
}
