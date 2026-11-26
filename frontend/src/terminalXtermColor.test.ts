import { describe, expect, it } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { colorizePlainLine } from './terminalSemantic';
import { LineTimestamp } from './terminalStream';
import { remainingPacketBytes } from './terminalReplay';
import { SemanticTerminalStream } from './terminalSemantic';

const waitWrite = (terminal: Terminal, value: string) => new Promise<void>((resolve) => terminal.write(value, resolve));

describe('xterm color buffer', () => {
  it('puts semantic ANSI colors into actual terminal cells', async () => {
    const terminal = new Terminal({ cols: 120, rows: 4 });
    await waitWrite(terminal, colorizePlainLine('\x1b[0mdrwxrwxr-x 7 renew renew 46 1月  29 2021 \x1b[01;34mtest\x1b[0m'));
    const line = terminal.buffer.active.getLine(0)!;
    expect(line.getCell(0)?.getFgColor()).toBe(0xc76cee);
    expect(line.getCell(1)?.getFgColor()).toBe(0x63a0ee);
    expect(line.getCell(2)?.getFgColor()).toBe(0xdda01d);
    expect(line.getCell(3)?.getFgColor()).toBe(0xff4149);
    expect(line.getCell(13)?.getFgColor()).toBe(0xc088ff);
    expect(line.getCell(25)?.getFgColor()).toBe(0xc088ff);
    expect(line.getCell(28)?.getFgColor()).toBe(0x9ee900);
    const indexOfText = (value: string) => {
      for (let index = 0; index < 80; index += 1) {
        if ([...value].every((character, offset) => line.getCell(index + offset)?.getChars() === character)) return index;
      }
      return -1;
    };
    expect(line.getCell(indexOfText('29'))?.getFgColor()).toBe(0x63a0ee);
    expect(line.getCell(indexOfText('2021'))?.getFgColor()).toBe(0xc088ff);
    expect(line.getCell(indexOfText('test'))?.getFgColor()).toBe(0x63a0ee);
    terminal.dispose();
  });

  it.each([
    ['drwxr-xr-x', 'projects', 0x63a0ee],
    ['-rw-r--r--', 'backup.rar', 0xf92672],
    ['-rwxr-xr-x', 'server', 0x9ee900],
    ['lrwxrwxrwx', 'current', 0x66d9ef],
    ['-rw-r--r--', 'README.md', 0xe6db74],
    ['-rw-r--r--', 'main.go', 0xdda01d],
    ['-rw-r--r--', 'photo.png', 0xc088ff],
    ['-rw-r--r--', 'notes', 0xf8f8f2],
  ] as const)('puts the requested filename colors into actual terminal cells', async (permissions, name, hex) => {
    const terminal = new Terminal({ cols: 120, rows: 4 });
    await waitWrite(terminal, colorizePlainLine(permissions + ' 1 renew renew 46 Jan 29 2021 ' + name));
    const line = terminal.buffer.active.getLine(0)!;
    const column = line.translateToString(true).indexOf(name);
    expect(column).toBeGreaterThanOrEqual(0);
    expect(line.getCell(column)?.getFgColor()).toBe(hex);
    terminal.dispose();
  });

  it('actually clears the terminal buffer for clear-screen output', async () => {
    const terminal = new Terminal({ cols: 80, rows: 4 });
    await waitWrite(terminal, 'visible before clear');
    await waitWrite(terminal, colorizePlainLine('\x1b[H\x1b[2J\x1b[3J'));
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('');
    terminal.dispose();
  });

  it('renders only the real zsh prompt with its timestamp after split packets', async () => {
    const terminal = new Terminal({ cols: 120, rows: 4 });
    const formatter = new LineTimestamp(() => true, () => new Date('2026-11-20T12:34:56'));
    const bytes = (value: string) => new TextEncoder().encode(value);
    const first = '\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m                                                                                                                       \r \r';
    const second = '\r\x1b[0m\x1b[27m\x1b[24m\x1b[Jlucas@bogon ~ % \x1b[K\x1b[?2004h';
    await waitWrite(terminal, new TextDecoder().decode(formatter.apply(bytes(first))));
    await waitWrite(terminal, new TextDecoder().decode(formatter.apply(bytes(second))));
    expect(terminal.buffer.active.getLine(0)?.translateToString(true).trimEnd()).toBe('[12:34:56] lucas@bogon ~ %');
    expect(terminal.buffer.active.getLine(0)?.getCell(0)?.getFgColor()).toBe(0xf92672);
    terminal.dispose();
  });

  it('does not duplicate a prompt when the snapshot splits a live packet', async () => {
    const terminal = new Terminal({ cols: 80, rows: 4 });
    const formatter = new LineTimestamp(() => true, () => new Date('2026-11-20T12:34:56'));
    const bytes = (value: string) => new TextEncoder().encode(value);
    const first = '\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m                                                                               \r \r';
    const second = '\r\x1b[0m\x1b[27m\x1b[24m\x1b[J[renew@beifen ~]$ \x1b[K\x1b[?2004h';
    const split = 4;
    const snapshot = bytes(first + second.slice(0, split));
    const pending = bytes(second);
    const sequence = bytes(first).length + pending.length;
    await waitWrite(terminal, new TextDecoder().decode(formatter.apply(snapshot)));
    const suffix = remainingPacketBytes(pending, sequence, snapshot.length);
    await waitWrite(terminal, new TextDecoder().decode(formatter.apply(suffix)));
    const output = Array.from({ length: terminal.buffer.active.length }, (_, row) => terminal.buffer.active.getLine(row)?.translateToString(true) ?? '').join('\n');
    expect(output.match(/renew@beifen/g)).toHaveLength(1);
    expect(output).toContain('[12:34:56] [renew@beifen ~]$');
    expect(output).not.toContain('beifen ~]$ beifen');
    terminal.dispose();
  });

  it('keeps clear input intact and timestamps only the new prompt after clear', async () => {
    const terminal = new Terminal({ cols: 80, rows: 4 });
    const formatter = new LineTimestamp(() => true, () => new Date('2026-11-20T12:34:56'));
    const semantic = new SemanticTerminalStream(() => true);
    const bytes = (value: string) => new TextEncoder().encode(value);
    const write = async (value: string) => {
      const colored = semantic.push(bytes(value));
      if (colored.length) await waitWrite(terminal, new TextDecoder().decode(formatter.apply(colored)));
      if (semantic.hasPending) {
        const flushed = semantic.flush();
        if (flushed.length) await waitWrite(terminal, new TextDecoder().decode(formatter.apply(flushed)));
      }
    };
    await write('[renew@beifen ~]$ ');
    for (const frame of ['c', 'cl', 'cle', 'clea', 'clear']) {
      await write(`\r\x1b[K[renew@beifen ~]$ ${frame}`);
      terminal.resize(frame.length % 2 ? 45 : 100, 4);
    }
    expect(terminal.buffer.active.getLine(0)?.translateToString(true).trimEnd()).toBe('[12:34:56] [renew@beifen ~]$ clear');
    await write('\r\n\x1b[H\x1b[2J\x1b[3J[renew@beifen ~]$ ');
    expect(terminal.buffer.active.getLine(0)?.translateToString(true).trimEnd()).toBe('[12:34:56] [renew@beifen ~]$');
    expect(terminal.buffer.active.getLine(0)?.getCell(0)?.getFgColor()).toBe(0xf92672);
    terminal.dispose();
  });
});
