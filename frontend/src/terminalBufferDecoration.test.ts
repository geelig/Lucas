import { describe, expect, it } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { listingSpans, TerminalBufferDecorator } from './terminalBufferDecoration';

describe('terminal display decorations', () => {
  it('parses English dates and all requested field roles from the visible line', () => {
    const text = '[12:15:58] -rw-rw-r-- 1 tomcat tomcat 107 Aug 5 2021 token?appId=10000000002';
    const spans = listingSpans(text).map((span) => ({ ...span, text: text.slice(span.start, span.end) }));
    expect(spans).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'r', role: 'permissionRead' }),
      expect.objectContaining({ text: 'w', role: 'permissionWrite' }),
      expect.objectContaining({ text: 'tomcat', role: 'owner' }),
      expect.objectContaining({ text: 'tomcat', role: 'group' }),
      expect.objectContaining({ text: '107', role: 'size' }),
      expect.objectContaining({ text: 'Aug', role: 'date' }),
      expect.objectContaining({ text: '5', role: 'dateDay' }),
      expect.objectContaining({ text: '2021', role: 'dateYear' }),
    ]));
    expect(spans.at(-1)).toEqual(expect.objectContaining({ role: 'fileName', text: 'token?appId=10000000002' }));
  });

  it('parses the real SELinux suffix and Chinese date', () => {
    const text = 'drwx------. 12 renew renew 4096 6月  26 11:13 .';
    const spans = listingSpans(text);
    expect(spans[0]).toEqual({ start: 0, end: 1, role: 'permission' });
    expect(spans.at(-1)?.role).toBe('fileDirectory');
    expect(text.slice(spans.at(-1)!.start, spans.at(-1)!.end)).toBe('.');
    expect(spans.some((span) => span.role === 'dateYear' && text.slice(span.start, span.end) === '11:13')).toBe(true);
    expect(spans.some((span) => text.slice(span.start, span.end) === '.' && span.role === 'permissionDash')).toBe(true);
    expect(spans.some((span) => text.slice(span.start, span.end) === '26' && span.role === 'dateDay')).toBe(true);
  });

  it.each([
    ['drwxr-xr-x', 'projects', 'fileDirectory'],
    ['-rw-r--r--', 'backup.rar', 'fileArchive'],
    ['-rwxr-xr-x', 'server', 'fileExecutable'],
    ['lrwxrwxrwx', 'current', 'fileSymlink'],
    ['-rw-r--r--', 'README.md', 'fileDocument'],
    ['-rw-r--r--', 'main.go', 'fileSource'],
    ['-rw-r--r--', 'photo.jpg', 'fileMedia'],
    ['-rw-r--r--', 'notes', 'fileName'],
  ] as const)('decorates %s with the shared filename role', (permissions, name, role) => {
    const text = permissions + ' 1 renew renew 46 Jan 29 2021 ' + name;
    const span = listingSpans(text).at(-1);
    expect(span?.role).toBe(role);
    expect(text.slice(span!.start, span!.end)).toBe(name);
  });

  it('registers foreground decorations on actual xterm rows without duplicates', async () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 160, rows: 3 });
    await new Promise<void>((resolve) => terminal.write('\x1b[0m-rw-rw-r-- 1 tomcat tomcat 107 Aug 5 2021 \x1b[38;5;27mtoken\x1b[0m', resolve));
    const registrations: { color?: string; dispose: () => void }[] = [];
    const original = terminal.registerDecoration.bind(terminal);
    terminal.registerDecoration = (options) => {
      const decoration = original(options);
      if (decoration) registrations.push({ color: options.foregroundColor, dispose: () => decoration.dispose() });
      return decoration;
    };
    const decorator = new TerminalBufferDecorator(terminal, () => true);
    decorator.update();
    expect(registrations.map((item) => item.color)).toEqual(expect.arrayContaining(['#63a0ee', '#dda01d', '#c088ff', '#9ee900']));
    const count = registrations.length;
    decorator.update();
    expect(registrations).toHaveLength(count);
    decorator.dispose();
    terminal.dispose();
  });

  it('registers command and option colors on actual xterm rows', async () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 80, rows: 2 });
    await new Promise<void>((resolve) => terminal.write('\x1b[0mgit status --short', resolve));
    const colors: (string | undefined)[] = [];
    const original = terminal.registerDecoration.bind(terminal);
    terminal.registerDecoration = (options) => {
      const decoration = original(options);
      if (decoration) colors.push(options.foregroundColor);
      return decoration;
    };
    const decorator = new TerminalBufferDecorator(terminal, () => true);
    decorator.update();
    expect(colors).toEqual(expect.arrayContaining(['#a6e22e', '#e6db74']));
    decorator.dispose();
    terminal.dispose();
  });
});
