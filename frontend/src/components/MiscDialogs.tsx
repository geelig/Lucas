import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Braces, Check, Command, FileJson, Folder, KeyRound, LockKeyhole, Moon, Plus, Search, Settings, ShieldCheck, Upload, X } from 'lucide-react';
import type { Group, Profile, PromptRequest } from '../types';
import { displayAddress } from '../utils';
import { Modal } from './UI';

export function GroupDialog({ group, parentId, onSave, onClose }: { group?: Group; parentId?: string; onSave: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(group?.name || '');
  return <Modal title={group ? '重命名分组' : '新建分组'} subtitle={parentId ? '在当前分组内创建子分组。' : '将相关连接整理在一起。'} onClose={onClose} size="small" footer={<><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={!name.trim()} onClick={() => void onSave(name.trim()).then(onClose)}>{group ? '保存名称' : '创建分组'}</button></>}><label className="field"><span>分组名称</span><input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && name.trim()) void onSave(name.trim()).then(onClose); }} placeholder="例如：生产环境" /></label></Modal>;
}

export function ImportDialog({ onImport, onClose }: { onImport: (data: string, format: string) => Promise<void>; onClose: () => void }) {
  const [data, setData] = useState('');
  const [format, setFormat] = useState('auto');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const submit = async () => {
    if (!data.trim()) { setError('请选择文件或粘贴要导入的数据。'); return; }
    setBusy(true); setError('');
    try { await onImport(data, format); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <Modal title="导入你的连接" subtitle="只导入你选择的数据，不会静默覆盖已有项目。" onClose={onClose} size="medium" footer={<><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={busy} onClick={() => void submit()}><Upload size={15} />{busy ? '正在导入…' : '导入数据'}</button></>}>
    <div className="import-types"><div><FileJson size={18} /><strong>Lucas 备份</strong><span>连接、历史与常用命令</span></div><div><Braces size={18} /><strong>SSH 配置</strong><span>Host 主机定义</span></div><div><Folder size={18} /><strong>旧版配置</strong><span>你自己的 JSON 数据</span></div></div>
    <input ref={fileRef} hidden type="file" accept=".lucas,.json,.txt,.config,config" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then((content) => { setData(content); if (file.name.includes('config')) setFormat('ssh'); }); }} />
    <button className="import-file-button" onClick={() => fileRef.current?.click()}><Upload size={17} /><span>{data ? '重新选择文件' : '从这台设备选择文件'}</span>{data && <Check size={16} />}</button>
    <div className="or-divider"><span>或粘贴数据</span></div>
    <label className="field"><span>数据格式</span><select value={format} onChange={(event) => setFormat(event.target.value)}><option value="auto">自动识别</option><option value="lucas">Lucas 备份 JSON</option><option value="ssh">OpenSSH 配置</option><option value="legacy">旧版连接 JSON</option></select></label>
    <textarea className="import-textarea" value={data} onChange={(event) => setData(event.target.value)} placeholder="在此粘贴 JSON 或 SSH 配置…" spellCheck={false} />
    {data && <div className="import-meta"><Check size={13} />已读取 {data.length.toLocaleString()} 个字符</div>}{error && <div className="form-error">{error}</div>}
  </Modal>;
}

export function PromptDialog({ prompt, onAnswer }: { prompt: PromptRequest; onAnswer: (id: string, answer: string) => Promise<void> }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const secret = prompt.kind === 'password';
  const confirmation = prompt.kind === 'confirm' || prompt.kind === 'hostkey';
  const answerPrompt = async (value: string) => { setBusy(true); try { await onAnswer(prompt.id, value); } finally { setBusy(false); } };
  return <Modal title={prompt.title || (prompt.kind === 'hostkey' ? '验证主机身份' : secret ? '需要身份认证' : '连接需要你的输入')} subtitle="安全连接正在等待你的回应。" onClose={() => void answerPrompt('')} size="small" footer={confirmation ? <><button className="button secondary" disabled={busy} onClick={() => void answerPrompt('no')}>拒绝</button><button className={`button ${prompt.changed ? 'danger' : 'primary'}`} disabled={busy} onClick={() => void answerPrompt('yes')}><ShieldCheck size={15} />{prompt.changed ? '信任变更后的密钥' : '接受并继续'}</button></> : <><button className="button secondary" onClick={() => void answerPrompt('')}>取消</button><button className="button primary" disabled={busy} onClick={() => void answerPrompt(answer)}>继续<ArrowRight size={15} /></button></>}>
    <div className={`prompt-symbol ${prompt.changed ? 'warning' : ''}`}>{prompt.kind === 'hostkey' ? <ShieldCheck size={25} /> : secret ? <LockKeyhole size={25} /> : <KeyRound size={25} />}</div><p className="prompt-message">{prompt.message}</p>
    {prompt.fingerprint && <div className="fingerprint"><span>SHA256 指纹</span><code>{prompt.fingerprint}</code></div>}
    {prompt.changed && <div className="hostkey-warning"><AlertTriangle size={17} /><span>主机密钥已变更。接受前请通过可信渠道核实。</span></div>}
    {!confirmation && <label className="field"><span>{secret ? '密码或验证码' : '你的回应'}</span><input type={secret ? 'password' : 'text'} value={answer} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void answerPrompt(answer); }} autoComplete="off" /></label>}
  </Modal>;
}

interface PaletteProps { profiles: Profile[]; onOpen: (profile: Profile) => void; onNew: () => void; onSettings: () => void; onCommand: () => void; onTheme: () => void; onImport: () => void; onClose: () => void }
export function CommandPalette(props: PaletteProps) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const actions = useMemo(() => [
    { id: 'new', label: '新建连接', detail: '本地终端、SSH、Telnet、串口或 FTP', icon: Plus, run: props.onNew },
    { id: 'command', label: '打开命令中心', detail: '发送命令到一个或多个会话', icon: Command, run: props.onCommand },
    { id: 'theme', label: '切换界面主题', detail: '循环切换 Lucas 主题', icon: Moon, run: props.onTheme },
    { id: 'settings', label: '打开偏好设置', detail: '主题、字体与布局', icon: Settings, run: props.onSettings },
    { id: 'import', label: '导入连接', detail: 'Lucas JSON 或 SSH 配置', icon: Upload, run: props.onImport },
    ...props.profiles.map((profile) => ({ id: profile.id, label: profile.name, detail: displayAddress(profile), icon: ArrowRight, run: () => props.onOpen(profile) })),
  ].filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(query.toLowerCase())), [props.profiles, query]);
  useEffect(() => setIndex(0), [query]);
  const run = (position: number) => { const item = actions[position]; if (item) { props.onClose(); item.run(); } };
  return <div className="palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}><div className="command-palette"><div className="palette-input"><Search size={19} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(Math.min(actions.length - 1, index + 1)); } if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(Math.max(0, index - 1)); } if (event.key === 'Enter') run(index); if (event.key === 'Escape') props.onClose(); }} placeholder="搜索连接或执行操作…" /><kbd>esc</kbd><button onClick={props.onClose} aria-label="关闭快捷操作"><X size={16} /></button></div><div className="palette-results">{actions.slice(0, 9).map((item, position) => { const Icon = item.icon; return <button key={item.id} className={position === index ? 'selected' : ''} onMouseEnter={() => setIndex(position)} onClick={() => run(position)}><span><Icon size={17} /></span><div><strong>{item.label}</strong><small>{item.detail}</small></div>{position === index && <kbd>↵</kbd>}</button>; })}{!actions.length && <div className="palette-empty">没有匹配的连接或操作。</div>}</div><footer><span><kbd>↑</kbd><kbd>↓</kbd> 导航</span><span><kbd>↵</kbd> 选择</span><span className="palette-brand">Lucas 快捷操作</span></footer></div></div>;
}
