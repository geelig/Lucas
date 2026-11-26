import { useMemo, useRef, useState } from 'react';
import { Cable, Folder, HardDrive, KeyRound, Network, Radio, Save, TerminalSquare, Unplug } from 'lucide-react';
import { Modal } from './UI';
import { backend } from '../backend';
import type { Group, Preferences, Profile, Protocol } from '../types';
import { defaultPort, protocolInfo, uid } from '../utils';

const protocolIcons = { local: TerminalSquare, ssh: HardDrive, telnet: Network, serial: Cable, ftp: Folder };

type SessionDefaults = Pick<Preferences, 'defaultShell' | 'defaultDirectory' | 'defaultSSHPort' | 'defaultUsername'>;

export function privateKeyPathFromSelection(currentPath: string, selectedPath: string): string {
  return selectedPath || currentPath;
}

function blankProfile(protocol: Protocol, groupId = '', defaults?: SessionDefaults): Profile {
  return {
    id: '', name: '', protocol, host: '', port: protocol === 'ssh' ? defaults?.defaultSSHPort || 22 : defaultPort(protocol), username: defaults?.defaultUsername || '', auth: 'password',
    privateKeyPath: '', jumpProfileId: '', serialPort: '', baudRate: 9600, dataBits: 8, stopBits: 1,
    parity: 'none', flowControl: 'none', groupId, description: '', color: protocolInfo[protocol].color,
    shell: defaults?.defaultShell || '', directory: defaults?.defaultDirectory || '',
  };
}

interface Props {
  profile?: Profile;
  protocol?: Protocol;
  groupId?: string;
  groups: Group[];
  profiles: Profile[];
  onClose: () => void;
  onSave: (profile: Profile) => Promise<void>;
  onConnect: (profile: Profile, save: boolean) => Promise<void>;
  defaults?: SessionDefaults;
}

export function ProfileDialog({ profile, protocol = 'ssh', groupId, groups, profiles, onClose, onSave, onConnect, defaults }: Props) {
  const editing = Boolean(profile);
  const [form, setForm] = useState<Profile>(() => profile ? { ...blankProfile(profile.protocol, '', defaults), ...profile, password: '', passphrase: '' } : blankProfile(protocol, groupId, defaults));
  const [saveToLibrary, setSaveToLibrary] = useState(true);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => setForm((current) => ({ ...current, [key]: value }));
  const sshProfiles = useMemo(() => profiles.filter((item) => item.protocol === 'ssh' && item.id !== form.id), [profiles, form.id]);

  const chooseProtocol = (value: Protocol) => setForm((current) => ({ ...blankProfile(value, current.groupId, defaults), id: current.id, name: current.name, description: current.description }));
  const prepare = () => {
    const result = { ...form, id: form.id || uid(), name: form.name.trim() || (form.protocol === 'local' ? 'Local shell' : form.host || form.serialPort || protocolInfo[form.protocol].label) };
    if (!result.password) delete result.password;
    if (!result.passphrase) delete result.passphrase;
    if (!result.jumpProfileId) delete result.jumpProfileId;
    return result;
  };
  const validate = () => {
    if (['ssh', 'telnet', 'ftp'].includes(form.protocol) && !form.host.trim()) return '请输入主机名或 IP 地址。';
    if (form.protocol === 'serial' && !form.serialPort?.trim()) return '请输入串口设备路径。';
    if (form.protocol === 'ssh' && form.auth === 'key' && !form.privateKeyPath?.trim()) return '请输入私钥路径。';
    return '';
  };
  const choosePrivateKey = async () => {
    try {
      const selectedPath = await backend.pickFile('选择 SSH 私钥');
      if (!selectedPath) return;
      setForm((current) => ({ ...current, privateKeyPath: privateKeyPathFromSelection(current.privateKeyPath || '', selectedPath) }));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const submit = async (connect: boolean) => {
    if (submitting.current) return;
    const problem = validate();
    if (problem) { setError(problem); return; }
    submitting.current = true; setBusy(true); setError('');
    try {
      const value = prepare();
      if (connect) await onConnect(value, saveToLibrary); else await onSave(value);
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { submitting.current = false; setBusy(false); }
  };

  return <Modal title={editing ? '编辑连接' : '新建连接'} subtitle={editing ? '修改配置不会影响已经打开的会话。' : '用一个工作区连接每台服务器、终端与设备。'} onClose={onClose} size="large" footer={<>
    {!editing && <label className="check-label save-check"><input type="checkbox" checked={saveToLibrary} onChange={(event) => setSaveToLibrary(event.target.checked)} /><span>保存到连接库</span></label>}
    <div className="modal-actions"><button className="button secondary" onClick={() => void submit(false)} disabled={busy}><Save size={15} />{editing ? '保存修改' : '保存'}</button><button className="button primary" onClick={() => void submit(true)} disabled={busy}><Unplug size={16} />{busy ? '正在处理…' : '立即连接'}</button></div>
  </>}>
    {!editing && <div className="protocol-picker">{(Object.keys(protocolInfo) as Protocol[]).map((item) => {
      const Icon = protocolIcons[item];
      return <button key={item} className={`protocol-choice ${form.protocol === item ? 'selected' : ''}`} onClick={() => chooseProtocol(item)}><Icon size={20} /><span>{protocolInfo[item].label}</span></button>;
    })}</div>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="form-grid">
      <label className="field span-2"><span>名称</span><input value={form.name} onChange={(event) => set('name', event.target.value)} placeholder={form.protocol === 'local' ? '本地终端' : '例如：生产网关'} /></label>
      {form.protocol === 'local' && <><label className="field"><span>Shell</span><input value={form.shell || ''} onChange={(event) => set('shell', event.target.value)} placeholder="/bin/zsh" /></label><label className="field"><span>工作目录</span><input value={form.directory || ''} onChange={(event) => set('directory', event.target.value)} placeholder="~" /></label></>}
      {['ssh', 'telnet', 'ftp'].includes(form.protocol) && <>
        <label className="field host-field"><span>主机</span><input value={form.host} onChange={(event) => set('host', event.target.value)} placeholder="server.example.com" autoCapitalize="off" /></label>
        <label className="field port-field"><span>端口</span><input type="number" min="1" max="65535" value={form.port} onChange={(event) => set('port', Number(event.target.value))} /></label>
      </>}
      {['ssh', 'ftp'].includes(form.protocol) && <label className="field span-2"><span>用户名</span><input value={form.username} onChange={(event) => set('username', event.target.value)} placeholder="登录用户名" autoCapitalize="off" /></label>}
      {form.protocol === 'ssh' && <>
        <label className="field span-2"><span>认证方式</span><select value={form.auth} onChange={(event) => set('auth', event.target.value as Profile['auth'])}><option value="password">密码认证</option><option value="key">私钥认证</option><option value="agent">SSH Agent</option><option value="interactive">交互式认证 / MFA</option></select></label>
        {(form.auth === 'password') && <label className="field span-2"><span>密码 <small>{editing && '留空则保持不变'}</small></span><input type="password" value={form.password || ''} onChange={(event) => set('password', event.target.value)} placeholder="••••••••••••" autoComplete="off" /></label>}
        {form.auth === 'key' && <>
          <label className="field span-2"><span>私钥路径</span><div className="input-with-icon"><KeyRound size={16} /><input value={form.privateKeyPath || ''} onChange={(event) => set('privateKeyPath', event.target.value)} placeholder="~/.ssh/id_ed25519" /><button type="button" onClick={() => void choosePrivateKey()}>选择私钥</button></div></label>
          <label className="field span-2"><span>私钥口令 <small>{editing && '留空则保持不变'}</small></span><input type="password" value={form.passphrase || ''} onChange={(event) => set('passphrase', event.target.value)} autoComplete="off" /></label>
        </>}
        <label className="field span-2"><span>跳板机 <small>可选，使用已有 SSH 连接</small></span><select value={form.jumpProfileId || ''} onChange={(event) => set('jumpProfileId', event.target.value)}><option value="">直接连接</option>{sshProfiles.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.host}</option>)}</select></label>
      </>}
      {form.protocol === 'ftp' && <label className="field span-2"><span>密码 <small>{editing && '留空则保持不变'}</small></span><input type="password" value={form.password || ''} onChange={(event) => set('password', event.target.value)} autoComplete="off" /></label>}
      {form.protocol === 'serial' && <>
        <label className="field span-2"><span>设备路径</span><div className="input-with-icon"><Radio size={16} /><input value={form.serialPort || ''} onChange={(event) => set('serialPort', event.target.value)} placeholder="/dev/cu.usbserial-0001" /></div></label>
        <label className="field"><span>波特率</span><select value={form.baudRate} onChange={(event) => set('baudRate', Number(event.target.value))}>{[300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400].map((rate) => <option key={rate}>{rate}</option>)}</select></label>
        <label className="field"><span>数据位</span><select value={form.dataBits} onChange={(event) => set('dataBits', Number(event.target.value))}><option value="8">8</option><option value="7">7</option><option value="6">6</option><option value="5">5</option></select></label>
        <label className="field"><span>校验位</span><select value={form.parity} onChange={(event) => set('parity', event.target.value as Profile['parity'])}><option value="none">无校验</option><option value="even">偶校验</option><option value="odd">奇校验</option></select></label>
        <label className="field"><span>停止位</span><select value={form.stopBits} onChange={(event) => set('stopBits', Number(event.target.value))}><option value="1">1</option><option value="2">2</option></select></label>
        <label className="field span-2"><span>流控制</span><select value={form.flowControl} onChange={(event) => set('flowControl', event.target.value as Profile['flowControl'])}><option value="none">无</option><option value="hardware">RTS / CTS</option><option value="software">XON / XOFF</option></select></label>
      </>}
      <label className="field"><span>所属分组</span><select value={form.groupId || ''} onChange={(event) => set('groupId', event.target.value)}><option value="">未分组</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label className="field"><span>标识颜色</span><div className="color-picker">{['#52dbc1', '#70a7ff', '#a78bfa', '#f5bc6b', '#ff8fab', '#94a3b8'].map((color) => <button type="button" aria-label={`标识颜色 ${color}`} key={color} className={form.color === color ? 'selected' : ''} style={{ '--swatch': color } as React.CSSProperties} onClick={() => set('color', color)} />)}</div></label>
      <label className="field span-2"><span>备注</span><input value={form.description || ''} onChange={(event) => set('description', event.target.value)} placeholder="这个连接用于什么？" /></label>
    </div>
  </Modal>;
}
