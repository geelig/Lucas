import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { ArrowDown, ArrowUp, CircleAlert, LoaderCircle, RotateCcw, Search, X } from 'lucide-react';
import type { Preferences, Session, ThemeName } from '../types';
import { backend, onTerminalData } from '../backend';
import { decodeBase64, encodeBase64 } from '../utils';
import { IconButton } from './UI';
import { Modal } from './UI';
import { LineTimestamp } from '../terminalStream';
import { createZmodemHandler } from '../zmodem';
import { colorForRole } from '../appearance';
import { ClipboardGetText, ClipboardSetText } from '../../wailsjs/runtime/runtime';
import { findHighRiskCommand, isMultiLinePaste } from '../terminalInputGuard';
import { addHistory } from '../commandHistory';
import { SemanticTerminalStream } from '../terminalSemantic';
import { refreshTerminalMetrics } from '../terminalMetrics';
import { remainingPacketBytes } from '../terminalReplay';
import { TerminalBufferDecorator } from '../terminalBufferDecoration';

export interface TerminalHandle { focus: () => void; search: () => void; fit: () => void }

const terminalThemes: Record<ThemeName, { background: string; foreground: string; cursor: string; selectionBackground: string }> = {
  midnight: { background: '#0c111e', foreground: '#d6deed', cursor: '#65e6cb', selectionBackground: '#43527880' },
  graphite: { background: '#14161b', foreground: '#d9dde5', cursor: '#65e6cb', selectionBackground: '#50556380' },
  daylight: { background: '#f8faff', foreground: '#263249', cursor: '#087f6b', selectionBackground: '#b7c8ef80' },
};

const windtermTheme = {
  background: '#1c1c1c', foreground: '#f8f8f2', cursor: '#f8f8f2', cursorAccent: '#1c1c1c', selectionBackground: '#36368d', selectionInactiveBackground: '#2a2a5c',
  black: '#333333', red: '#c4265e', green: '#86b42b', yellow: '#d0a500', blue: '#3465a4', magenta: '#8c6bc8', cyan: '#56adbc', white: '#e3e3dd',
  brightBlack: '#666666', brightRed: '#f92672', brightGreen: '#a6e22e', brightYellow: '#9e862f', brightBlue: '#819aff', brightMagenta: '#ae81ff', brightCyan: '#66d9ef', brightWhite: '#f8f8f2',
};
const paletteFor = (preferences: Preferences) => ({ ...(preferences.terminalPalette === 'windterm' ? windtermTheme : terminalThemes[preferences.theme]), background: colorForRole('background'), foreground: colorForRole('foreground') });

interface Props { session: Session; preferences: Preferences; active: boolean; onActivate: () => void; onReconnect: () => void }

export const TerminalView = forwardRef<TerminalHandle, Props>(function TerminalView({ session, preferences, active, onActivate, onReconnect }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | undefined>(undefined);
  const fitAddon = useRef<FitAddon | undefined>(undefined);
  const searchAddon = useRef<SearchAddon | undefined>(undefined);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [zmodemNote, setZmodemNote] = useState('');
  const [zmodemPath, setZmodemPath] = useState('');
  const [pendingPaste, setPendingPaste] = useState('');
  const [guardWarning, setGuardWarning] = useState('');
  const inputBuffer = useRef('');

  const handleTerminalInput = (data: string) => {
    if (preferencesRef.current.commandGuard) {
      const end = data.search(/[\r\n]/);
      const candidate = end >= 0 ? inputBuffer.current + data.slice(0, end) : data;
      const dangerous = findHighRiskCommand(data, preferencesRef.current.commandRules) || findHighRiskCommand(candidate, preferencesRef.current.commandRules);
      if (dangerous) {
        inputBuffer.current = '';
        setGuardWarning(dangerous);
        void backend.write(session.id, '\x03');
        return;
      }
    }
    if (preferencesRef.current.pasteWarning && isMultiLinePaste(data)) { setPendingPaste(data); return; }
    if (data === '\x03') inputBuffer.current = '';
    else if (data === '\b' || data === '\x7f') inputBuffer.current = inputBuffer.current.slice(0, -1);
    else if (/\r|\n/.test(data)) {
      if (inputBuffer.current.trim()) addHistory(inputBuffer.current, session.name);
      inputBuffer.current = '';
    }
    else inputBuffer.current += data;
    void backend.write(session.id, data).catch(() => undefined);
  };
  const inputHandlerRef = useRef(handleTerminalInput);
  inputHandlerRef.current = handleTerminalInput;

  useImperativeHandle(ref, () => ({
    focus: () => terminal.current?.focus(),
    search: () => setSearchOpen(true),
    fit: () => fitAddon.current?.fit(),
  }));

  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({
      allowProposedApi: true, cursorBlink: true, cursorStyle: 'bar', scrollback: 10000,
      fontFamily: preferences.fontFamily, fontSize: preferences.fontSize, lineHeight: 1.25,
      macOptionIsMeta: true, theme: paletteFor(preferences),
    });
    const semantic = new SemanticTerminalStream(() => preferencesRef.current.semanticColors);
    let semanticTimer: number | undefined;
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit); term.loadAddon(search); term.open(host.current);
    terminal.current = term; fitAddon.current = fit; searchAddon.current = search;
    const bufferDecorator = new TerminalBufferDecorator(term, () => preferencesRef.current.semanticColors);
    const parsedDecorationDisposable = term.onWriteParsed(() => bufferDecorator.update());
    const renderDecorationDisposable = term.onRender(() => bufferDecorator.update());
    fit.fit();
    const frame = requestAnimationFrame(() => { fit.fit(); if (active) term.focus(); });
    const measureFont = () => {
      if (terminal.current !== term) return;
      refreshTerminalMetrics(term, preferencesRef.current.fontSize, () => fit.fit());
    };
    void document.fonts.ready.then(() => requestAnimationFrame(measureFont));
    const dataDisposable = term.onData((data) => inputHandlerRef.current(data));
    const resizeDisposable = term.onResize(({ cols, rows }) => { void backend.resize(session.id, cols, rows).catch(() => undefined); });
    const timestamps = new LineTimestamp(() => preferencesRef.current.showTimestamps);
    const zmodem = createZmodemHandler({
      enabled: true,
      send: (data) => { void backend.writeBinary(session.id, encodeBase64(data)).catch((reason) => setZmodemNote(`传输失败：${String(reason)}`)); },
      save: async (file) => {
        const saved = await backend.saveBinaryFile(file.name, encodeBase64(file.data));
        if (saved) { setZmodemPath(saved); setZmodemNote(`下载完成：${file.name}`); }
      },
      onOutput: (data) => term.write(timestamps.apply(data)),
      onProgress: (progress) => { if (progress.phase === 'receiving') setZmodemPath(''); setZmodemNote(`${progress.phase === 'saved' ? '已接收' : '正在接收'} ${progress.fileName}${progress.percent === undefined ? '' : ` · ${progress.percent}%`}`); },
      onError: (error) => setZmodemNote(`ZMODEM：${error.message}`),
    });
    const selectionDisposable = term.onSelectionChange(() => {
      if (preferencesRef.current.selectCopy && term.hasSelection()) void ClipboardSetText(term.getSelection()).catch(() => setZmodemNote('无法写入系统剪贴板'));
    });
    let lastSequence = 0;
    let replayFinished = false;
    const pendingPackets: { bytes: Uint8Array; sequence: number }[] = [];
    const writeBytes = (bytes: Uint8Array) => {
      if (preferencesRef.current.zmodemEnabled && zmodem.consume(bytes)) return;
      const colored = semantic.push(bytes);
      if (colored.length) {
        const rendered = timestamps.apply(colored);
        term.write(rendered);
      }
      if (semantic.hasPending) {
        window.clearTimeout(semanticTimer);
        semanticTimer = window.setTimeout(() => {
          const flushed = semantic.flush();
          if (flushed.length) {
            const rendered = timestamps.apply(flushed);
            term.write(rendered);
          }
        }, 25);
      }
    };
    const flushPending = () => {
      pendingPackets.sort((a, b) => a.sequence - b.sequence);
      for (const packet of pendingPackets) writePacket(packet.bytes, packet.sequence);
      pendingPackets.length = 0;
    };
    const writePacket = (bytes: Uint8Array, sequence: number) => {
      if (sequence && sequence <= lastSequence) return;
      const remaining = remainingPacketBytes(bytes, sequence, lastSequence);
      if (remaining.length) writeBytes(remaining);
      if (sequence) lastSequence = sequence;
    };
    const offData = onTerminalData((id, base64, sequence) => {
      if (id !== session.id) return;
      try {
        const bytes = decodeBase64(base64);
        if (!replayFinished) { pendingPackets.push({ bytes, sequence }); return; }
        writePacket(bytes, sequence);
      } catch { term.write('\r\n[终端数据无法解码]\r\n'); }
    });
    void backend.getOutputState(session.id).then((state) => {
      const replaySequence = Number(state.sequence) || 0;
      if (state.data && replaySequence > lastSequence) writeBytes(decodeBase64(state.data));
      lastSequence = Math.max(lastSequence, replaySequence);
      replayFinished = true;
      flushPending();
    }).catch(() => { replayFinished = true; flushPending(); });
    const observer = new ResizeObserver(() => requestAnimationFrame(() => fit.fit()));
    observer.observe(host.current);
    return () => {
      cancelAnimationFrame(frame); window.clearTimeout(semanticTimer); observer.disconnect(); offData?.(); zmodem.dispose(); dataDisposable.dispose(); resizeDisposable.dispose(); selectionDisposable.dispose(); parsedDecorationDisposable.dispose(); renderDecorationDisposable.dispose(); bufferDecorator.dispose(); term.dispose();
      terminal.current = undefined;
    };
  }, [session.id]);

  useEffect(() => {
    if (!terminal.current) return;
    terminal.current.options.fontFamily = preferences.fontFamily;
    terminal.current.options.fontSize = preferences.fontSize;
    terminal.current.options.theme = paletteFor(preferences);
    requestAnimationFrame(() => fitAddon.current?.fit());
  }, [preferences.fontFamily, preferences.fontSize, preferences.theme, preferences.terminalPalette]);
  useEffect(() => { if (active) requestAnimationFrame(() => { fitAddon.current?.fit(); terminal.current?.focus(); }); }, [active]);

  useEffect(() => {
    if (!zmodemPath) return;
    const timer = window.setTimeout(() => { setZmodemNote(''); setZmodemPath(''); }, 10_000);
    return () => window.clearTimeout(timer);
  }, [zmodemPath]);

  const find = (backwards = false) => {
    if (!query) return;
    const options = { caseSensitive, decorations: { matchOverviewRuler: '#a78bfa', activeMatchColorOverviewRuler: '#52dbc1' } };
    if (backwards) searchAddon.current?.findPrevious(query, options); else searchAddon.current?.findNext(query, options);
  };

  return <div className={`terminal-view ${active ? 'active' : ''}`} onMouseDown={onActivate} onContextMenu={(event) => {
    if (!preferencesRef.current.rightClickPaste || !terminal.current) return;
    event.preventDefault(); event.stopPropagation();
    void ClipboardGetText().then((value) => { if (value) inputHandlerRef.current(value); }).catch(() => setZmodemNote('无法读取系统剪贴板'));
  }} onPasteCapture={(event) => {
    const value = event.clipboardData.getData('text');
    if (!value) return;
    event.preventDefault(); event.stopPropagation(); inputHandlerRef.current(value);
  }}>
    {pendingPaste && <Modal title="确认多行粘贴" subtitle={`${pendingPaste.split(/\r\n|\r|\n/).length} 行内容将发送到当前终端。`} onClose={() => setPendingPaste('')} size="medium" footer={<><button className="button secondary" onClick={() => setPendingPaste('')}>取消</button><button className="button primary" onClick={() => { const value = pendingPaste; setPendingPaste(''); value.split(/\r\n|\r|\n/).filter((line) => line.trim()).forEach((line) => addHistory(line, session.name)); void backend.write(session.id, value); }}>确认粘贴</button></>}><pre className="paste-preview">{pendingPaste.slice(0, 2000)}</pre></Modal>}
    {guardWarning && <Modal title="高风险命令已拦截" subtitle="该命令没有发送到终端。请确认影响后再使用其他安全方式。" onClose={() => setGuardWarning('')} size="small" footer={<button className="button primary" onClick={() => setGuardWarning('')}>知道了</button>}><div className="blocked-command"><code>{guardWarning}</code><p>命令命中了当前高风险规则，可在偏好设置中修改规则。</p></div></Modal>}
    <div className="terminal-host" ref={host} />
    {zmodemNote && <div className="zmodem-status"><span>{zmodemNote}</span>{zmodemPath && <button className="zmodem-reveal" onClick={() => void backend.revealInFinder(zmodemPath)}>在 Finder 中显示</button>}<button aria-label="关闭传输提示" onClick={() => { setZmodemNote(''); setZmodemPath(''); }}><X size={13} /></button></div>}
    {searchOpen && <div className="terminal-search" onMouseDown={(event) => event.stopPropagation()}>
      <Search size={15} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); find(event.shiftKey); } if (event.key === 'Escape') setSearchOpen(false); }} placeholder="在终端中查找" />
      <button className={caseSensitive ? 'selected' : ''} onClick={() => setCaseSensitive(!caseSensitive)} title="区分大小写">Aa</button>
      <IconButton label="上一个匹配项" onClick={() => find(true)}><ArrowUp size={15} /></IconButton><IconButton label="下一个匹配项" onClick={() => find()}><ArrowDown size={15} /></IconButton><IconButton label="关闭搜索" onClick={() => setSearchOpen(false)}><X size={15} /></IconButton>
    </div>}
    {session.state === 'connecting' && <div className="terminal-state"><LoaderCircle className="spin" size={25} /><strong>正在建立连接</strong><span>{session.message || '正在协商安全会话…'}</span></div>}
    {['error', 'disconnected', 'closed'].includes(session.state) && <div className="terminal-state ended"><CircleAlert size={25} /><strong>{session.state === 'closed' ? '会话已关闭' : '连接已中断'}</strong><span>{session.message || '终端会话已停止。'}</span><button className="button secondary" onClick={onReconnect}><RotateCcw size={14} />重新连接</button></div>}
  </div>;
});
