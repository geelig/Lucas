import { useState } from 'react';
import { ArrowRight, Cable, ChevronRight, Clock3, Folder, HardDrive, Network, Plus, Sparkles, TerminalSquare } from 'lucide-react';
import type { Profile, Protocol } from '../types';
import { displayAddress, protocolInfo } from '../utils';
import { SystemIcon } from './SystemIcon';
import { SessionActivationTracker } from '../sessionActivation';

const icons = { local: TerminalSquare, ssh: HardDrive, telnet: Network, serial: Cable, ftp: Folder };

export function Welcome({ profiles, onNew, onOpen }: { profiles: Profile[]; onNew: (protocol: Protocol) => void; onOpen: (profile: Profile) => void }) {
  const [activation] = useState(() => new SessionActivationTracker());
  const openRecentWithKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>, profile: Profile) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    activation.openByKeyboard();
    onOpen(profile);
  };
  return <div className="welcome-scroll">
    <section className="welcome-hero">
      <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
      <div className="hero-copy"><span className="hero-kicker"><Sparkles size={14} />你的连接工作站</span><h2>连接每个系统，<br /><em>保持从容有序。</em></h2><p>打开终端、连接服务器或管理文件，<br />让每一次操作都流畅、清晰、恰到好处。</p><button className="button primary hero-button" onClick={() => onNew('ssh')}><Plus size={17} />新建连接<ArrowRight size={16} /></button></div>
      <div className="hero-visual" aria-hidden="true"><div className="visual-window"><div className="visual-top"><i /><i /><i /><span>lucas — 工作区</span></div><div className="visual-code"><span className="code-muted">01</span><code><b>~</b> lucas connect</code><span className="code-muted">02</span><code><i>●</i> 安全通道已就绪</code><span className="code-muted">03</span><code><strong>lucas</strong><b> @ </b>anywhere <u>▋</u></code></div><div className="visual-status"><span><i />已连接</span><small>UTF-8 · zsh</small></div></div><div className="floating-chip chip-one"><span>↑</span> SFTP 已就绪</div><div className="floating-chip chip-two">24 ms <i /></div></div>
    </section>
    <section className="welcome-section"><div className="section-heading"><div><span className="eyebrow">从这里开始</span><h3>选择连接方式</h3></div><span>五种协议，一个简洁工作区</span></div><div className="new-protocol-grid">{(Object.keys(protocolInfo) as Protocol[]).map((protocol) => {
      const Icon = icons[protocol]; const info = protocolInfo[protocol];
      return <button className="new-protocol-card" key={protocol} onClick={() => onNew(protocol)} style={{ '--protocol-accent': info.color } as React.CSSProperties}><span className="new-protocol-icon"><Icon size={23} /></span><strong>{info.label}</strong><p>{info.description}</p><span className="card-arrow"><ArrowRight size={16} /></span></button>;
    })}</div></section>
    {profiles.length > 0 && <section className="welcome-section recent-section"><div className="section-heading"><div><span className="eyebrow">继续之前的工作</span><h3>最近连接</h3></div></div><div className="recent-grid">{profiles.slice(0, 4).map((profile) => <button key={profile.id} className="recent-card" title={`双击连接 ${profile.name}；按 Enter 连接`} onClick={() => { if (activation.click(profile.id) === 'open') onOpen(profile); }} onKeyDown={(event) => openRecentWithKeyboard(event, profile)}><span className="protocol-gem" style={{ '--profile-color': profile.color || protocolInfo[profile.protocol].color } as React.CSSProperties}><SystemIcon os={profile.os} protocol={profile.protocol} size={16} /></span><span><strong>{profile.name}</strong><small>{displayAddress(profile)}</small></span><ChevronRight size={16} /><Clock3 size={12} /></button>)}</div></section>}
    <footer className="welcome-footer"><span>Lucas</span><p>本地优先，为隐私而设计</p><div><kbd>⌘</kbd><kbd>K</kbd><span>快捷操作</span></div></footer>
  </div>;
}
