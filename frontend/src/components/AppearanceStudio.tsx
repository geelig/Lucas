import { useEffect, useState, type CSSProperties } from 'react';
import { Check, Download, Palette, RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { Preferences, ThemeName } from '../types';
import { backend } from '../backend';
import { DEFAULT_APPEARANCE, apply, colorForRole, load, save, type CustomAppearance } from '../appearance';
import { fileColorRole } from '../terminalSemantic';
import { Modal } from './UI';

interface AppearanceStudioProps {
  preferences: Preferences;
  onChange: (preferences: Preferences) => void;
  onClose: () => void;
}

const colorFields: { key: keyof CustomAppearance; label: string }[] = [
  { key: 'background', label: '终端背景' },
  { key: 'foreground', label: '终端前景' },
  { key: 'permission', label: '文件权限' },
  { key: 'permissionRead', label: '权限：读取' },
  { key: 'permissionWrite', label: '权限：写入' },
  { key: 'permissionExecute', label: '权限：执行' },
  { key: 'permissionDash', label: '权限：占位符' },
  { key: 'owner', label: '所属用户' },
  { key: 'group', label: '所属用户组' },
  { key: 'size', label: '文件大小' },
  { key: 'date', label: '月份' },
  { key: 'dateDay', label: '日号' },
  { key: 'dateYear', label: '年份' },
  { key: 'fileName', label: '普通文件' },
  { key: 'fileDirectory', label: '目录' },
  { key: 'fileArchive', label: '压缩包' },
  { key: 'fileExecutable', label: '可执行文件' },
  { key: 'fileSymlink', label: '符号链接' },
  { key: 'fileDocument', label: '文档文件' },
  { key: 'fileSource', label: '源码文件' },
  { key: 'fileMedia', label: '媒体文件' },
  { key: 'promptUser', label: '提示符用户' },
  { key: 'promptHost', label: '提示符主机' },
  { key: 'promptPath', label: '提示符路径' },
  { key: 'currentTimestamp', label: '当前行时间戳' },
  { key: 'historyTimestamp', label: '历史时间戳' },
  { key: 'command', label: '命令名称' },
  { key: 'option', label: '命令参数' },
  { key: 'path', label: '文件路径' },
  { key: 'url', label: '网络地址' },
  { key: 'number', label: '数字与用量' },
  { key: 'string', label: '文本字符串' },
  { key: 'keyword', label: '关键字' },
  { key: 'error', label: '错误信息' },
  { key: 'warning', label: '警告信息' },
  { key: 'success', label: '成功信息' },
  { key: 'info', label: '提示信息' },
  { key: 'muted', label: '次要信息' },
];

const themes: { value: ThemeName; label: string }[] = [
  { value: 'midnight', label: '深靛夜' },
  { value: 'graphite', label: '石墨灰' },
  { value: 'daylight', label: '日光白' },
];

const studioStyles = `
  .appearance-studio { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(280px, .85fr); gap: 18px; }
  .appearance-controls { min-width: 0; }
  .appearance-section { margin-bottom: 16px; }
  .appearance-section:last-child { margin-bottom: 0; }
  .appearance-heading { display: flex; align-items: center; gap: 7px; margin: 0 0 10px; color: var(--text); font-size: 12px; font-weight: 600; }
  .appearance-heading svg { color: var(--violet); }
  .appearance-colors { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 12px; }
  .appearance-color { display: grid; grid-template-columns: 30px minmax(0, 1fr) 72px; align-items: center; gap: 7px; min-width: 0; }
  .appearance-color > span { overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .appearance-color input[type=color] { width: 30px; height: 26px; padding: 2px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface-2); cursor: pointer; }
  .appearance-color input[type=text] { width: 72px; min-width: 0; height: 26px; padding: 0 6px; border: 1px solid var(--line); border-radius: 6px; color: var(--text); background: var(--surface-2); font: 9px var(--font-mono, monospace); text-transform: lowercase; }
  .appearance-color input:focus { border-color: var(--mint); outline: none; }
  .appearance-theme { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .appearance-theme > span { color: var(--muted); font-size: 10px; }
  .appearance-theme select { min-width: 130px; height: 30px; }
  .appearance-sliders { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; }
  .appearance-slider { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 5px 8px; color: var(--muted); font-size: 10px; }
  .appearance-slider output { min-width: 45px; color: var(--text); font: 9px var(--font-mono, monospace); text-align: right; }
  .appearance-slider input { grid-column: 1 / -1; width: 100%; height: 3px; margin: 3px 0; accent-color: var(--mint); cursor: pointer; }
  .appearance-preview { position: sticky; top: 0; align-self: start; min-width: 0; }
  .appearance-terminal { overflow: hidden; border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 10px 28px rgba(0,0,0,.14); }
  .appearance-terminal-bar { display: flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px; border-bottom: 1px solid rgba(127,127,127,.16); background: rgba(127,127,127,.07); }
  .appearance-terminal-bar i { width: 7px; height: 7px; border-radius: 50%; background: #5f6368; }
  .appearance-terminal-bar i:first-child { background: #ff5f57; }
  .appearance-terminal-bar i:nth-child(2) { background: #febc2e; }
  .appearance-terminal-bar i:nth-child(3) { background: #28c840; }
  .appearance-terminal-bar span { margin-left: auto; color: var(--faint); font-size: 8px; }
  .appearance-terminal-body { min-height: 286px; padding: 14px 12px; overflow: auto; line-height: 1.75; white-space: pre; }
  .appearance-line { display: block; }
  .appearance-preview-note { margin: 9px 2px 0; color: var(--faint); font-size: 9px; line-height: 1.5; }
  .appearance-status { min-height: 18px; margin-top: 10px; color: var(--muted); font-size: 10px; overflow-wrap: anywhere; }
  .appearance-status.error { color: var(--danger); }
  .appearance-actions { display: flex; align-items: center; gap: 8px; width: 100%; }
  .appearance-actions .appearance-save { margin-left: auto; }
  @media (max-width: 760px) { .appearance-studio { grid-template-columns: 1fr; } .appearance-preview { position: static; } }
  @media (max-width: 520px) { .appearance-colors, .appearance-sliders { grid-template-columns: 1fr; } }
`;

export function AppearanceStudio({ preferences, onChange, onClose }: AppearanceStudioProps) {
  const [appearance, setAppearance] = useState<CustomAppearance>(() => load());
  const [draftPreferences, setDraftPreferences] = useState(preferences);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraftPreferences(preferences), [preferences]);

  const setColor = (role: keyof CustomAppearance, value: string) => {
    setAppearance((current) => ({ ...current, [role]: value.toLowerCase() }));
    setMessage('');
  };

  const setPreference = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    const next = { ...draftPreferences, [key]: value };
    setDraftPreferences(next);
    onChange(next);
  };

  const saveAndApply = () => {
    const next = save(appearance);
    setAppearance(next);
    apply(next);
    onChange(draftPreferences);
    setError('');
    setMessage('外观已保存并应用。');
  };

  const restoreDefaults = () => {
    setAppearance({ ...DEFAULT_APPEARANCE });
    setError('');
    setMessage('已恢复默认配色，点击“保存应用”后生效。');
  };

  const exportAppearance = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const content = JSON.stringify({ version: 1, appearance, preferences: draftPreferences }, null, 2);
      const path = await backend.saveTextFile('lucas-appearance.json', content);
      setMessage(typeof path === 'string' && path ? `已导出到 ${path}` : '外观配置已导出。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const previewStyle = {
    background: colorForRole('background', appearance),
    color: colorForRole('foreground', appearance),
    fontFamily: draftPreferences.fontFamily,
    fontSize: draftPreferences.fontSize,
  } satisfies CSSProperties;
  const color = (role: keyof CustomAppearance): CSSProperties => ({ color: colorForRole(role, appearance) });
  const permissionPreview = (value: string) => [...value].map((character, index) => {
    const role: keyof CustomAppearance = index === 0 ? (character === '-' ? 'permissionDash' : 'permission')
      : character === 'r' ? 'permissionRead'
        : character === 'w' ? 'permissionWrite'
          : /[xsStT]/.test(character) ? 'permissionExecute'
            : 'permissionDash';
    return <span key={index} style={color(role)}>{character}</span>;
  });
  const filePreview = (permissions: string, name: string) => <span className="appearance-line">
    <span style={color('historyTimestamp')}>[16:09:46]</span> {permissionPreview(permissions)} 1 <span style={color('owner')}>renew</span> <span style={color('group')}>renew</span> <span style={color('size')}>4096</span> <span style={color('date')}>1月</span> <span style={color('dateDay')}>29</span> <span style={color('dateYear')}>2021</span> <span style={color(fileColorRole(permissions, name))}>{name}</span>
  </span>;

  return <Modal title="可视化外观编辑器" subtitle="先预览每一项调整，再保存为你的终端外观。" onClose={onClose} size="large" footer={<div className="appearance-actions"><button className="button secondary" onClick={restoreDefaults}><RotateCcw size={14} />恢复默认</button><button className="button secondary" disabled={busy} onClick={() => void exportAppearance()}><Download size={14} />{busy ? '正在导出…' : '导出配置'}</button><button className="button primary appearance-save" onClick={saveAndApply}><Check size={14} />保存应用</button></div>}>
    <style>{studioStyles}</style>
    <div className="appearance-studio">
      <div className="appearance-controls">
        <section className="appearance-section">
          <h3 className="appearance-heading"><Palette size={15} />终端配色</h3>
          <div className="appearance-colors">
            {colorFields.map(({ key, label }) => <label className="appearance-color" key={key}>
              <input type="color" aria-label={`${label}选择器`} value={colorForRole(key, appearance)} onChange={(event) => setColor(key, event.target.value)} />
              <span>{label}</span>
              <input type="text" aria-label={`${label}色值`} value={colorForRole(key, appearance)} maxLength={7} spellCheck={false} onChange={(event) => setColor(key, event.target.value)} onBlur={(event) => setColor(key, event.target.value)} />
            </label>)}
          </div>
        </section>
        <section className="appearance-section">
          <h3 className="appearance-heading"><SlidersHorizontal size={15} />界面与布局</h3>
          <label className="appearance-theme"><span>界面主题</span><select aria-label="界面主题" value={draftPreferences.theme} onChange={(event) => setPreference('theme', event.target.value as ThemeName)}>{themes.map((theme) => <option key={theme.value} value={theme.value}>{theme.label}</option>)}</select></label>
          <div className="appearance-sliders">
            {([
              ['sidebarWidth', '左侧面板宽度', 220, 520, 'px'],
              ['resourceWidth', '右侧面板宽度', 300, 520, 'px'],
              ['fileBottomHeight', '底部文件栏高度', 180, 560, 'px'],
              ['fontSize', '终端字号', 10, 24, 'px'],
            ] as const).map(([key, label, min, max, unit]) => <label className="appearance-slider" key={key}><span>{label}</span><output>{draftPreferences[key]}{unit}</output><input aria-label={label} type="range" min={min} max={max} step={1} value={draftPreferences[key]} onChange={(event) => setPreference(key, Number(event.target.value))} /></label>)}
          </div>
        </section>
        <div className={`appearance-status ${error ? 'error' : ''}`} role="status">{error || message}</div>
      </div>
      <aside className="appearance-preview">
        <h3 className="appearance-heading">实时终端样例</h3>
        <div className="appearance-terminal">
          <div className="appearance-terminal-bar"><i /><i /><i /><span>外观预览</span></div>
          <div className="appearance-terminal-body" style={previewStyle}>
            <span className="appearance-line"><span style={color('historyTimestamp')}>[16:09:45]</span> 总用量 127732</span>
            {filePreview('drwxrwxr-x', 'projects')}
            {filePreview('-rw-r--r--', 'README.md')}
            {filePreview('-rw-r--r--', 'main.ts')}
            {filePreview('-rw-r--r--', 'photo.png')}
            {filePreview('-rw-r--r--', 'release.tar.gz')}
            {filePreview('-rwxr-xr-x', 'server')}
            {filePreview('lrwxrwxrwx', 'current')}
            {filePreview('-rw-r--r--', 'notes')}
            <span className="appearance-line"><span style={color('currentTimestamp')}>[16:09:47]</span> [<span style={color('promptUser')}>renew</span>@<span style={color('promptHost')}>server</span> <span style={color('promptPath')}>~</span>]$ <span style={{ opacity: .8 }}>▋</span></span>
          </div>
        </div>
        <p className="appearance-preview-note">示例中的权限、用户、大小、日期、各类文件及提示行均使用上方颜色。</p>
      </aside>
    </div>
  </Modal>;
}

export default AppearanceStudio;
