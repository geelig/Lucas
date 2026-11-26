import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowUpDown, Check, Command, Database, Download, History, Keyboard,
  LayoutGrid, Monitor, Moon, Palette, PanelBottom, PanelLeft, PanelRight,
  Plug, Plus, RefreshCw, Settings2, SquareTerminal, Sun, Terminal, Type, Upload,
} from 'lucide-react';
import type { Preferences, ThemeName } from '../types';
import { Modal } from './UI';
import { backend } from '../backend';
import { DEFAULT_HIGH_RISK_RULES } from '../terminalInputGuard';
import './SettingsDialog.css';

const shortcuts = [
  ['快捷操作', '⌘ K'], ['新建连接', '⌘ N'], ['关闭标签页', '⌘ W'], ['终端搜索', '⌘ F'],
  ['显示或隐藏连接库', '⌘ B'], ['显示或隐藏文件', '⌘ J'], ['发送命令', '⌘ ↵'], ['向右分屏', '⌘ \\'],
  ['向下分屏', '⌘ ⇧ \\'], ['开始或停止录制', '⌘ R'], ['下一个标签页', '⌃ Tab'], ['全屏', 'F11'],
];

const categories = [
  { id: 'appearance', label: '外观', detail: '主题、字体与界面颜色', icon: Palette },
  { id: 'terminal', label: '终端', detail: '配色与终端操作', icon: Terminal },
  { id: 'panels', label: '面板', detail: '布局、文件与工作区', icon: LayoutGrid },
  { id: 'connection', label: '连接', detail: '默认会话与快捷键', icon: Plug },
  { id: 'data', label: '数据', detail: '配置目录、导入导出与密码', icon: Database },
] as const;

type Category = typeof categories[number]['id'];

interface SettingsDialogProps {
  preferences: Preferences;
  onChange: (value: Preferences) => void;
  onClose: () => void;
  initialCategory?: Category;
  onImport: () => void;
  onExport: () => void;
  onCustomize: () => void;
  onOpenPalette?: () => void;
  onOpenHistory?: () => void;
  onOpenTransfers?: () => void;
  onOpenShell?: () => void;
  onNewConnection?: () => void;
  onRefreshProfiles?: () => void;
  onOpenSettings?: () => void;
}

function PreferenceToggle({ label, detail, value, onChange }: { label: string; detail: string; value: boolean; onChange: (value: boolean) => void }) {
  return <div className="preference-row"><span><strong>{label}</strong><small>{detail}</small></span><button type="button" role="switch" aria-checked={value} aria-label={label} className={`toggle ${value ? 'on' : ''}`} onClick={() => onChange(!value)}><i /></button></div>;
}

function PanelDockPicker<T extends 'left' | 'right' | 'bottom'>({ label, value, onChange, includeBottom = false }: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  includeBottom?: boolean;
}) {
  return <div className="field">
    <span>{label}位置</span>
    <div className="segmented setting-segment" role="group" aria-label={`${label}位置`}>
      <button type="button" className={value === 'left' ? 'selected' : ''} aria-pressed={value === 'left'} onClick={() => onChange('left' as T)}><PanelLeft size={15} />左侧</button>
      <button type="button" className={value === 'right' ? 'selected' : ''} aria-pressed={value === 'right'} onClick={() => onChange('right' as T)}><PanelRight size={15} />右侧</button>
      {includeBottom && <button type="button" className={value === 'bottom' ? 'selected' : ''} aria-pressed={value === 'bottom'} onClick={() => onChange('bottom' as T)}><PanelBottom size={15} />底部</button>}
    </div>
  </div>;
}

function SettingsSection({ icon: Icon, title, detail, children }: { icon: typeof Moon; title: string; detail: string; children: ReactNode }) {
  return <section className="settings-section lucas-settings-section">
    <div className="settings-title"><Icon size={17} /><div><h3>{title}</h3><p>{detail}</p></div></div>
    {children}
  </section>;
}

export function SettingsDialog({
  preferences, onChange, onClose, onImport, onExport, onCustomize,
  onOpenPalette, onOpenHistory, onOpenTransfers, onOpenShell,
  onNewConnection, onRefreshProfiles, onOpenSettings, initialCategory = 'appearance',
}: SettingsDialogProps) {
  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) => onChange({ ...preferences, [key]: value });
  const [category, setCategory] = useState<Category>(initialCategory);
  const [configDir, setConfigDir] = useState('');
  const [configMessage, setConfigMessage] = useState('');
  useEffect(() => { void backend.configDirectory().then(setConfigDir); }, []);

  const activeCategory = categories.find((item) => item.id === category) ?? categories[0];
  const panelActions = [
    { label: '快捷操作', detail: '搜索连接并执行常用操作', icon: Command, callback: onOpenPalette },
    { label: '历史命令', detail: '查看、筛选和重新发送历史命令', icon: History, callback: onOpenHistory },
    { label: '文件传输', detail: '查看上传、下载和传输进度', icon: ArrowUpDown, callback: onOpenTransfers },
    { label: '本地 Shell', detail: '打开一个本地终端会话', icon: SquareTerminal, callback: onOpenShell },
    { label: '新建连接', detail: '创建新的远程或本地会话', icon: Plus, callback: onNewConnection },
    { label: '刷新连接库', detail: '重新读取已保存的连接配置', icon: RefreshCw, callback: onRefreshProfiles },
    { label: '设置中心', detail: '打开 Lucas 设置', icon: Settings2, callback: onOpenSettings },
  ].filter((item) => item.callback);

  return <Modal title="Lucas 设置" subtitle="外观、连接与工作区偏好仅保存在这台设备上。" onClose={onClose} size="large" footer={<button className="button primary" onClick={onClose}><Check size={15} />完成</button>}>
    <div className="lucas-settings">
      <nav className="lucas-settings-nav" aria-label="设置分类">
        <div className="lucas-settings-nav-heading">设置</div>
        {categories.map(({ id, label, detail, icon: Icon }) => <button
          type="button"
          key={id}
          className={`lucas-settings-category ${category === id ? 'selected' : ''}`}
          aria-current={category === id ? 'page' : undefined}
          onClick={() => setCategory(id)}
        >
          <span className="lucas-settings-category-icon"><Icon size={17} /></span>
          <span><strong>{label}</strong><small>{detail}</small></span>
        </button>)}
      </nav>

      <main className="lucas-settings-content" key={category}>
        <header className="lucas-settings-content-header">
          <span>{activeCategory.label}</span>
          <h3>{activeCategory.detail}</h3>
        </header>

        {category === 'appearance' && <>
          <SettingsSection icon={Moon} title="界面主题" detail="无论白天夜晚，都有舒适的视觉体验。">
            <div className="theme-grid">{([
              ['midnight', '深靛夜', '深邃靛灰', Moon], ['graphite', '石墨灰', '中性专注', Monitor], ['daylight', '日光白', '清晰明亮', Sun],
            ] as [ThemeName, string, string, typeof Moon][]).map(([value, label, detail, Icon]) => <button key={value} className={`theme-card theme-preview-${value} ${preferences.theme === value ? 'selected' : ''}`} onClick={() => set('theme', value)}><div className="theme-sample"><i /><span><b /><b /><b /></span><em /></div><div><Icon size={15} /><span><strong>{label}</strong><small>{detail}</small></span>{preferences.theme === value && <Check size={14} />}</div></button>)}</div>
          </SettingsSection>
          <button className="button secondary appearance-entry-button" onClick={onCustomize}><Palette size={15} />界面自定义（颜色与布局实时预览）</button>
          <SettingsSection icon={Type} title="终端字体" detail="调整字号与字体，让内容清晰易读。">
            <div className="settings-inline"><label className="field"><span>字体</span><select value={preferences.fontFamily} onChange={(event) => set('fontFamily', event.target.value)}><option value="SFMono-Regular, Menlo, monospace">SF Mono</option><option value="JetBrains Mono, Menlo, monospace">JetBrains Mono</option><option value="Menlo, monospace">Menlo</option><option value="Monaco, monospace">Monaco</option><option value="Courier New, monospace">Courier New</option></select></label><label className="field font-size-field"><span>字号</span><div className="stepper"><button onClick={() => set('fontSize', Math.max(10, preferences.fontSize - 1))}>−</button><input type="number" min="10" max="24" value={preferences.fontSize} onChange={(event) => set('fontSize', Math.min(24, Math.max(10, Number(event.target.value))))} /><button onClick={() => set('fontSize', Math.min(24, preferences.fontSize + 1))}>+</button></div></label></div>
            <div className="font-preview"><span>lucas@studio</span><b> ~ </b><code>echo "连接，如此美好"</code><i>▋</i></div>
          </SettingsSection>
        </>}

        {category === 'terminal' && <SettingsSection icon={Command} title="终端与操作" detail="配色、时间戳和鼠标行为均可独立调整。">
          <label className="field palette-field"><span>终端配色</span><select value={preferences.terminalPalette} onChange={(event) => set('terminalPalette', event.target.value as Preferences['terminalPalette'])}><option value="windterm">默认配色</option><option value="lucas">柔和配色</option></select></label>
          <div className="preference-list">
            <PreferenceToggle label="语义着色" detail="为未着色的权限、用户、目录和文件输出补充颜色。" value={preferences.semanticColors} onChange={(value) => set('semanticColors', value)} />
            <PreferenceToggle label="显示行时间戳" detail="在每个新终端行前显示本地时间。" value={preferences.showTimestamps} onChange={(value) => set('showTimestamps', value)} />
            <PreferenceToggle label="选择即复制" detail="鼠标左键选择文本后自动复制。" value={preferences.selectCopy} onChange={(value) => set('selectCopy', value)} />
            <PreferenceToggle label="右键粘贴" detail="终端内单击鼠标右键直接粘贴。" value={preferences.rightClickPaste} onChange={(value) => set('rightClickPaste', value)} />
            <PreferenceToggle label="多行粘贴确认" detail="粘贴多行内容前显示预览，确认后才发送。" value={preferences.pasteWarning} onChange={(value) => set('pasteWarning', value)} />
            <PreferenceToggle label="高风险命令保护" detail="按下方规则拦截危险命令并显示警告。" value={preferences.commandGuard} onChange={(value) => set('commandGuard', value)} />
            {preferences.commandGuard && <div className="command-rules"><label className="field"><span>高风险命令规则</span><textarea className="command-input" aria-label="高风险命令规则" rows={7} value={preferences.commandRules} onChange={(event) => set('commandRules', event.target.value)} placeholder="每行一条，例如：docker rm" /></label><p className="field-help">每行一条，按命令开头匹配；支持 sudo、链式命令和自定义多词规则。空行及 # 开头的注释会被忽略。</p><button type="button" className="button secondary" onClick={() => set('commandRules', DEFAULT_HIGH_RISK_RULES)}>恢复默认规则</button></div>}
            <PreferenceToggle label="启用 ZMODEM" detail="识别 sz/rz 控制序列并接收文件，不再显示 **B000…。" value={preferences.zmodemEnabled} onChange={(value) => set('zmodemEnabled', value)} />
          </div>
        </SettingsSection>}

        {category === 'panels' && <>
          <SettingsSection icon={PanelLeft} title="模块显示与位置" detail="同侧模块合并为页签，每侧可整体拖动调整宽度。">
            <div className="preference-list">
              <div>
                <PreferenceToggle label="会话" detail="显示连接、分组和系统图标。" value={preferences.sidebarOpen} onChange={(value) => set('sidebarOpen', value)} />
                <PanelDockPicker label="会话" value={preferences.sessionDock} onChange={(value) => set('sessionDock', value)} />
              </div>
              <div>
                <PreferenceToggle label="文件管理器" detail="显示远程文件列表与目录导航。" value={preferences.filePanelOpen} onChange={(value) => set('filePanelOpen', value)} />
                <PanelDockPicker label="文件管理器" value={preferences.filePanelDock} onChange={(value) => set('filePanelDock', value)} includeBottom />
              </div>
              <div>
                <PreferenceToggle label="资源管理器" detail="显示已连接终端、状态和运行时间。" value={preferences.resourcePanelOpen} onChange={(value) => set('resourcePanelOpen', value)} />
                <PanelDockPicker label="资源管理器" value={preferences.resourceDock} onChange={(value) => set('resourceDock', value)} />
              </div>
              <div>
                <PreferenceToggle label="历史命令" detail="显示可筛选、可重新发送的历史命令。" value={preferences.historyPanelEnabled} onChange={(value) => set('historyPanelEnabled', value)} />
                <PanelDockPicker label="历史命令" value={preferences.historyDock} onChange={(value) => set('historyDock', value)} />
              </div>
            </div>
          </SettingsSection>
          <SettingsSection icon={Monitor} title="工作区与文件" detail="管理命令面板、目录跟随和资源信息。">
            <div className="preference-list">
              <PreferenceToggle label="终端底部命令面板" detail="在终端底部显示常用命令、发送和保存。" value={preferences.commandPanelOpen} onChange={(value) => set('commandPanelOpen', value)} />
              <PreferenceToggle label="实时资源指标" detail="仅采集当前会话的 CPU、内存、带宽和进程。" value={preferences.resourceMetrics} onChange={(value) => set('resourceMetrics', value)} />
              <label className="field"><span>资源采样间隔</span><select disabled={!preferences.resourceMetrics} value={preferences.metricsInterval} onChange={(event) => set('metricsInterval', Number(event.target.value))}><option value={3}>3 秒</option><option value={5}>5 秒</option><option value={10}>10 秒</option></select></label>
              <PreferenceToggle label="默认折叠分组" detail="启动时收起全部分组，展开状态仍可手动调整。" value={preferences.collapseGroups} onChange={(value) => set('collapseGroups', value)} />
              <PreferenceToggle label="文件跟随终端目录" detail="终端执行 cd 后，文件面板自动进入对应目录。" value={preferences.followCwd} onChange={(value) => set('followCwd', value)} />
              <PreferenceToggle label="显示系统图标" detail="按 macOS、Linux、Windows 或设备类型显示图标。" value={preferences.systemIcons} onChange={(value) => set('systemIcons', value)} />
              <PreferenceToggle label="文件高对比度" detail="增强目录名称和次要信息的可读性。" value={preferences.highContrastFiles} onChange={(value) => set('highContrastFiles', value)} />
            </div>
          </SettingsSection>
          {panelActions.length > 0 && <SettingsSection icon={LayoutGrid} title="面板与操作" detail="集中使用原顶部工具栏的功能。">
            <div className="lucas-settings-actions">{panelActions.map(({ label, detail, icon: Icon, callback }) => <button type="button" className="lucas-settings-action" key={label} onClick={callback}><span><Icon size={17} /></span><div><strong>{label}</strong><small>{detail}</small></div></button>)}</div>
          </SettingsSection>}
        </>}

        {category === 'connection' && <>
          <SettingsSection icon={Monitor} title="默认会话" detail="新建连接时自动使用这些值，仍可在表单中单独修改。">
            <div className="form-grid"><label className="field"><span>默认 Shell</span><input value={preferences.defaultShell} onChange={(event) => set('defaultShell', event.target.value)} placeholder="/bin/zsh" /></label><label className="field"><span>默认工作目录</span><div className="input-with-icon"><input value={preferences.defaultDirectory} onChange={(event) => set('defaultDirectory', event.target.value)} placeholder="~" /><button type="button" onClick={() => void backend.pickFolder('选择默认工作目录').then((path) => { if (path) set('defaultDirectory', path); })}>选择</button></div></label><label className="field"><span>默认 SSH 端口</span><input type="number" min="1" max="65535" value={preferences.defaultSSHPort} onChange={(event) => set('defaultSSHPort', Number(event.target.value))} /></label><label className="field"><span>默认用户名</span><input value={preferences.defaultUsername} onChange={(event) => set('defaultUsername', event.target.value)} placeholder="可选" /></label></div>
          </SettingsSection>
          <SettingsSection icon={Keyboard} title="快捷键" detail="减少鼠标操作，让工作更流畅。">
            <div className="shortcut-list">{shortcuts.map(([label, keys]) => <div key={label}><span>{label}</span><kbd>{keys}</kbd></div>)}</div>
            <div className="shortcut-tip"><Command size={16} /><span>在 Windows 和 Linux 上使用 Ctrl 代替 ⌘。</span></div>
          </SettingsSection>
        </>}

        {category === 'data' && <>
          <SettingsSection icon={Type} title="配置文件目录" detail="配置、加密凭据和录制文件保存在此目录。">
            <div className="config-directory"><code>{configDir || '正在读取…'}</code><button className="button secondary" onClick={() => void backend.openConfigDirectory()}>打开目录</button><button className="button secondary" onClick={() => void backend.pickFolder('选择新的配置目录').then(async (path) => { if (!path) return; try { const next = await backend.setConfigDirectory(path); setConfigDir(next); setConfigMessage(`配置已迁移到 ${next}`); } catch (reason) { setConfigMessage(`迁移失败：${String(reason)}`); } })}>更改并迁移目录</button></div>
            {configMessage && <p className="field-help">{configMessage}</p>}
          </SettingsSection>
          <SettingsSection icon={Upload} title="数据管理" detail="导入和导出统一放在偏好设置中。">
            <div className="settings-data-actions"><button className="button secondary" onClick={onImport}><Upload size={15} />导入配置</button><button className="button secondary" onClick={onExport}><Download size={15} />导出配置</button></div>
            <div className="lucas-settings-export-option"><PreferenceToggle label="导出时询问位置" detail="关闭后自动保存到系统“下载”目录。" value={preferences.exportAskPath} onChange={(value) => set('exportAskPath', value)} /></div>
          </SettingsSection>
          <SettingsSection icon={Check} title="密码安全" detail="已保存密码始终使用 AES-GCM 加密，不会明文落盘。">
            <PreferenceToggle label="保存连接密码" detail="关闭后，保存连接时会删除该配置已保存的密码和密钥口令。" value={preferences.rememberPasswords} onChange={(value) => set('rememberPasswords', value)} />
          </SettingsSection>
        </>}
      </main>
    </div>
  </Modal>;
}
