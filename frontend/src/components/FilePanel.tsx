import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { ArrowLeft, ArrowUp, ChevronRight, CircleX, Download, Edit3, Eye, EyeOff, File, FileUp, Folder, FolderPlus, FolderSync, Home, LoaderCircle, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import type { FileEntry, Session, Transfer } from '../types';
import { backend } from '../backend';
import { formatBytes, joinPath, parentPath, sortFiles } from '../utils';
import { ConfirmDialog, EmptyState, IconButton, Modal } from './UI';
import { FinderFolder } from './FinderFolder';
import { HorizontalScrollbar } from './HorizontalScrollbar';
import { shouldFollowDirectory } from '../fileFollow';

type Operation = { type: 'mkdir' | 'rename' | 'upload' | 'download'; entry?: FileEntry };
type SortKey = 'name' | 'size' | 'modified';

export function formatFileTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatFileSize(value: number): string {
  return value === 0 ? '0 Bytes' : formatBytes(value);
}

export function fileTypeLabel(entry: FileEntry): string {
  if (entry.isDir) return '目录';
  if (entry.symlink) return '链接';
  const name = entry.name.toLowerCase();
  if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) return 'Tar 归档文件';
  if (name.endsWith('.zip')) return 'Zip 归档文件';
  if (name.endsWith('.sh')) return 'Shell 脚本';
  if (name.endsWith('.log')) return '应用程序日志';
  if (name.endsWith('.txt')) return '纯文本文档';
  const extension = entry.name.includes('.') ? entry.name.split('.').pop()?.toUpperCase() : '';
  return extension ? `${extension} 文件` : '文件';
}

export function FilePanel({ session, transfers, dock, followCwd, onToggleFollowCwd, onClose, notify }: {
  session: Session; transfers: Transfer[]; dock: 'left' | 'right' | 'bottom'; onClose: () => void;
  followCwd: boolean; onToggleFollowCwd: () => void;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [path, setPath] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [selected, setSelected] = useState<FileEntry>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [operation, setOperation] = useState<Operation>();
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [name, setName] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [remotePath, setRemotePath] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [ascending, setAscending] = useState(true);
  const [dragging, setDragging] = useState(false);
  const request = useRef(0);
  const fileTable = useRef<HTMLDivElement>(null);
  const previousCwd = useRef({ sessionId: session.id, cwd: session.cwd, followCwd });
  const supported = session.protocol === 'local' || session.protocol === 'ssh' || session.protocol === 'ftp';

  const load = useCallback(async (target = path) => {
    if (!supported || !['connected', 'connecting'].includes(session.state)) return;
    const token = ++request.current;
    setLoading(true); setError('');
    try {
      const result = await backend.listFiles(session.id, target);
      if (token !== request.current) return;
      setEntries(result.entries); setPath(result.path); setPathInput(result.path); setSelected(undefined);
    } catch (reason) { if (token === request.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (token === request.current) setLoading(false); }
  }, [session.id, session.state, supported, path]);

  useEffect(() => {
    setPath(''); setPathInput(''); setEntries([]); setSelected(undefined); setError('');
    void load(followCwd ? session.cwd || '' : '');
    return () => { request.current += 1; };
  }, [session.id]);

  useEffect(() => {
    const previous = previousCwd.current;
    const next = { sessionId: session.id, cwd: session.cwd, followCwd };
    previousCwd.current = next;
    if (shouldFollowDirectory(previous, next)) {
      void load(session.cwd);
    }
  }, [session.id, session.cwd, followCwd]);

  const visible = useMemo(() => {
    const filtered = entries.filter((entry) => showHidden || !entry.name.startsWith('.'));
    const sorted = sortFiles(filtered);
    if (sortKey === 'name') return ascending ? sorted : sorted.reverse();
    return sorted.sort((a, b) => {
      const result = sortKey === 'size' ? a.size - b.size : (a.modified || '').localeCompare(b.modified || '');
      return ascending ? result : -result;
    });
  }, [entries, showHidden, sortKey, ascending]);
  const activeTransfers = transfers.filter((item) => (!item.sessionId || item.sessionId === session.id) && item.state === 'running');

  const openOperation = (type: Operation['type'], entry?: FileEntry) => {
    setOperation({ type, entry }); setSelected(entry);
    setName(type === 'rename' ? entry?.name || '' : '');
    setRemotePath(entry?.path || (type === 'upload' ? path : ''));
    setLocalPath(type === 'download' ? `~/Downloads/${entry?.name || 'download'}` : '');
  };
  const runOperation = async () => {
    if (!operation) return;
    const currentOperation = operation;
    try {
      if (currentOperation.type === 'mkdir') await backend.mkdir(session.id, joinPath(path, name));
      if (currentOperation.type === 'rename' && currentOperation.entry) await backend.renameFile(session.id, currentOperation.entry.path, joinPath(path, name));
      if (currentOperation.type === 'upload') await backend.upload(session.id, localPath, remotePath || joinPath(path, localPath.split('/').pop() || 'upload'));
      if (currentOperation.type === 'download') await backend.download(session.id, remotePath, localPath);
      if (currentOperation.type === 'upload') notify('上传完成', 'success');
      else if (currentOperation.type === 'download') notify(`下载完成：${localPath}`, 'success');
      else notify('文件操作已完成', 'success');
      setOperation(undefined); await load();
    } catch (reason) {
      const action = currentOperation.type === 'upload' ? '上传' : currentOperation.type === 'download' ? '下载' : '文件操作';
      notify(`${action}失败：${reason instanceof Error ? reason.message : String(reason)}`, 'error');
    }
  };
  const remove = async () => {
    if (!selected) return;
    try { await backend.deleteFile(session.id, selected.path); notify(`已删除 ${selected.name}`, 'success'); setSelected(undefined); await load(); }
    catch (reason) { notify(reason instanceof Error ? reason.message : String(reason), 'error'); }
  };
  const drop = async (event: DragEvent) => {
    event.preventDefault(); setDragging(false);
    const files = Array.from(event.dataTransfer.files) as (File & { path?: string })[];
    if (!files.length) return;
    if (files.some((file) => !file.path)) { notify('请点击上传按钮并输入本地文件路径。', 'info'); return; }
    try {
      await Promise.all(files.map((file) => backend.upload(session.id, file.path!, joinPath(path, file.name))));
      notify(`已上传 ${files.length} 个文件`, 'success');
      await load();
    } catch (reason) { notify(`上传失败：${reason instanceof Error ? reason.message : String(reason)}`, 'error'); }
  };
  const crumbs = path && path !== '~' ? path.split('/').filter(Boolean) : [];
  const changeSort = (key: SortKey) => {
    if (sortKey === key) setAscending((value) => !value);
    else { setSortKey(key); setAscending(true); }
  };
  const sortMark = (key: SortKey) => sortKey === key ? (ascending ? ' ↑' : ' ↓') : '';

  return <aside className={`file-panel dock-${dock}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { if (event.target === event.currentTarget) setDragging(false); }} onDrop={(event) => void drop(event)}>
    <header className="file-header"><div><span className="eyebrow">文件管理器</span><h2>{session.protocol === 'local' ? '本地文件' : session.protocol === 'ftp' ? 'FTP 文件' : '远程文件'}</h2></div><IconButton label="关闭文件面板" onClick={onClose}><X size={17} /></IconButton></header>
    {!supported ? <EmptyState icon={<Folder size={28} />} title="此协议不支持文件管理"><p>本地终端、SSH 和 FTP 会话可使用文件管理。</p></EmptyState> : <>
      <div className="file-toolbar"><IconButton label="返回上级目录" disabled={!path || path === '/' || path === '~'} onClick={() => void load(parentPath(path))}><ArrowUp size={16} /></IconButton><IconButton label="主目录" onClick={() => void load('')}><Home size={16} /></IconButton><IconButton label="刷新" onClick={() => void load()}><RefreshCw size={16} className={loading ? 'spin' : ''} /></IconButton><button type="button" className={`file-follow-button ${followCwd ? 'selected' : ''}`} aria-label={followCwd ? '关闭跟随终端目录' : '开启并立即跟随终端目录'} aria-pressed={followCwd} title={followCwd ? '关闭跟随终端目录' : '开启并立即跟随终端目录'} onClick={onToggleFollowCwd}><FolderSync size={16} /></button><span /><IconButton label={showHidden ? '隐藏隐藏文件' : '显示隐藏文件'} className={showHidden ? 'selected' : ''} onClick={() => setShowHidden(!showHidden)}>{showHidden ? <Eye size={16} /> : <EyeOff size={16} />}</IconButton><IconButton label="新建文件夹" onClick={() => openOperation('mkdir')}><FolderPlus size={16} /></IconButton><IconButton label="上传文件" onClick={() => openOperation('upload')}><Upload size={16} /></IconButton></div>
      <form className="path-bar" onSubmit={(event) => { event.preventDefault(); void load(pathInput); }}><button type="button" onClick={() => void load(parentPath(path))} aria-label="上级目录"><ArrowLeft size={14} /></button><input value={pathInput} onChange={(event) => setPathInput(event.target.value)} placeholder="路径" aria-label="当前路径" /><button type="submit">前往</button></form>
      {path && <div className="breadcrumbs"><button onClick={() => void load(path.startsWith('~') ? '~' : '/')}><Home size={12} /></button>{crumbs.map((crumb, index) => <span key={`${crumb}-${index}`}><ChevronRight size={11} /><button onClick={() => void load(`${path.startsWith('~') ? '~/' : path.startsWith('/') ? '/' : ''}${crumbs.slice(0, index + 1).join('/')}`)}>{crumb}</button></span>)}</div>}
      <div id={`file-table-${session.id}`} ref={fileTable} className="file-table">
      <div className="file-table-heading"><button onClick={() => changeSort('name')}>名称{sortMark('name')}</button><button onClick={() => changeSort('modified')}>修改时间{sortMark('modified')}</button><span>类型</span><button onClick={() => changeSort('size')}>大小{sortMark('size')}</button><span>权限</span><span>所有者</span><span>分组</span></div>
      <div className="file-list">
        {loading && !entries.length && <div className="file-loading"><LoaderCircle className="spin" size={22} /><span>正在读取目录…</span></div>}
        {error && <EmptyState icon={<CircleX size={26} />} title="无法读取此文件夹"><p>{error}</p><button className="button secondary" onClick={() => void load()}>重试</button></EmptyState>}
        {!loading && !error && !visible.length && <EmptyState icon={<Folder size={28} />} title="此文件夹为空"><p>新建文件夹，或将文件拖到这里上传。</p></EmptyState>}
        {visible.map((entry) => <div key={entry.path} className={`file-row ${entry.isDir ? 'directory' : ''} ${selected?.path === entry.path ? 'selected' : ''}`} tabIndex={0} onClick={() => setSelected(entry)} onDoubleClick={() => entry.isDir ? void load(entry.path) : openOperation('download', entry)} onKeyDown={(event) => { if (event.key === 'Enter') entry.isDir ? void load(entry.path) : openOperation('download', entry); }}>
          <span className="file-name" title={entry.path}><span className={`file-kind ${entry.isDir ? 'directory' : ''}`}>{entry.isDir ? <FinderFolder size={17} /> : <File size={16} />}</span><strong>{entry.name}</strong></span><time className="file-date">{formatFileTime(entry.modified)}</time><span className="file-type">{fileTypeLabel(entry)}</span><span className="file-size">{entry.isDir ? '' : formatFileSize(entry.size)}</span><code className="file-permissions">{entry.permissions || '—'}</code><span className="file-owner">{entry.owner || '—'}</span><span className="file-group">{entry.group || '—'}</span>
        </div>)}
      </div>
      </div>
      <HorizontalScrollbar target={fileTable} targetId={`file-table-${session.id}`} label="横向查看文件内容" refreshKey={session.id} />
      {selected && <div className="file-selection-bar"><span title={selected.path}>{selected.name}</span><IconButton label="重命名" onClick={() => openOperation('rename', selected)}><Edit3 size={15} /></IconButton>{!selected.isDir && <IconButton label="下载" onClick={() => openOperation('download', selected)}><Download size={15} /></IconButton>}<IconButton label="删除" className="danger-icon" onClick={() => setDeleteConfirm(true)}><Trash2 size={15} /></IconButton></div>}
      {activeTransfers.length > 0 && <div className="transfer-tray">{activeTransfers.slice(-3).map((transfer) => {
        const progress = transfer.total > 0 ? Math.min(100, Math.round(transfer.transferred / transfer.total * 100)) : 0;
        return <div className="transfer-item" key={transfer.id}><div><span>{transfer.direction === 'download' ? <Download size={13} /> : <FileUp size={13} />}{transfer.name}</span><small>{formatBytes(transfer.transferred)} / {formatBytes(transfer.total)}</small><IconButton label="取消传输" onClick={() => void backend.cancelTransfer(transfer.id)}><X size={13} /></IconButton></div><div className={`progress-track ${!transfer.total ? 'indeterminate' : ''}`}><i style={{ width: `${progress}%` }} /></div></div>;
      })}</div>}
      <footer className="file-footer"><span>{visible.length} 个项目{entries.length !== visible.length ? ` · ${entries.length - visible.length} 个已隐藏` : ''}</span><span>{session.protocol === 'ssh' ? 'SFTP' : session.protocol.toUpperCase()}</span></footer>
      {dragging && <div className="file-drop-overlay"><Upload size={30} /><strong>松开以上传</strong><span>{path || '主目录'}</span></div>}
    </>}
    {operation && operation.type !== 'download' && <Modal title={operation.type === 'mkdir' ? '新建文件夹' : operation.type === 'rename' ? '重命名' : '上传文件'} onClose={() => setOperation(undefined)} size="small" footer={<><button className="button secondary" onClick={() => setOperation(undefined)}>取消</button><button className="button primary" onClick={() => void runOperation()}>{operation.type === 'upload' ? '开始上传' : '确定'}</button></>}>
      <div className="form-grid single">{['mkdir', 'rename'].includes(operation.type) && <label className="field"><span>名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="文件夹名称" /></label>}{operation.type === 'upload' && <><label className="field"><span>本地文件路径</span><input value={localPath} onChange={(event) => setLocalPath(event.target.value)} placeholder="/Users/you/Documents/file.zip" /></label><label className="field"><span>远程保存路径</span><input value={remotePath} onChange={(event) => setRemotePath(event.target.value)} placeholder={joinPath(path, 'file.zip')} /></label><p className="field-help">也可以直接从 Finder 拖放文件到此面板。</p></>}</div>
    </Modal>}
    {operation?.type === 'download' && <Modal title="下载文件" onClose={() => setOperation(undefined)} size="small" footer={<><button className="button secondary" onClick={() => setOperation(undefined)}>取消</button><button className="button primary" onClick={() => void runOperation()}><Download size={15} />下载</button></>}><div className="form-grid single"><label className="field"><span>远程文件</span><input value={remotePath} readOnly /></label><label className="field"><span>保存到</span><input value={localPath} onChange={(event) => setLocalPath(event.target.value)} /></label></div></Modal>}
    {deleteConfirm && selected && <ConfirmDialog title={`删除 ${selected.name}？`} message={selected.isDir ? '此文件夹及其全部内容将被永久删除。' : '此文件将被永久删除。'} onClose={() => setDeleteConfirm(false)} onConfirm={() => { setDeleteConfirm(false); void remove(); }} />}
  </aside>;
}
