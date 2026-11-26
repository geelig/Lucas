import { describe, expect, it } from 'vitest';
import { colorizePlainLine, fileColorRole, SemanticTerminalStream } from './terminalSemantic';

const bytes = (value: string) => new TextEncoder().encode(value);

describe('semantic terminal colors', () => {
  it('colors uncoloured ls permissions, owners, sizes, dates and names', () => {
    const result = colorizePlainLine('drwxrwxr-x 7 renew renew 46 1月  29 2021 test');
    expect(result).toContain('\x1b[38;2;199;108;238md');
    expect(result.match(/\x1b\[38;2;192;136;255mrenew/g)).toHaveLength(2);
    expect(result).toContain('\x1b[38;2;192;136;255m46');
    expect(result).toContain('\x1b[38;2;158;233;0m1月');
    expect(result).toContain('\x1b[38;2;99;160;238m29');
    expect(result).toContain('\x1b[38;2;192;136;255m2021');
    expect(result).toContain('\x1b[38;2;99;160;238mtest');
  });

  it.each([
    ['drwxr-xr-x', 'projects', 'fileDirectory', '99;160;238'],
    ['-rw-r--r--', 'backup.rar', 'fileArchive', '249;38;114'],
    ['-rwxr-xr-x', 'server', 'fileExecutable', '158;233;0'],
    ['lrwxrwxrwx', 'current', 'fileSymlink', '102;217;239'],
    ['-rw-r--r--', 'README.md', 'fileDocument', '230;219;116'],
    ['-rw-r--r--', 'main.ts', 'fileSource', '221;160;29'],
    ['-rw-r--r--', 'photo.png', 'fileMedia', '192;136;255'],
    ['-rw-r--r--', 'notes', 'fileName', '248;248;242'],
  ] as const)('colors %s in raw semantic output', (permissions, name, role, rgb) => {
    expect(fileColorRole(permissions, name)).toBe(role);
    const result = colorizePlainLine(permissions + ' 1 renew renew 46 Jan 29 2021 ' + name);
    expect(result).toContain('\x1b[38;2;' + rgb + 'm' + name + '\x1b[0m');
  });

  it.each([
    { role: 'fileDocument', extensions: ['txt', 'md', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'json', 'yaml', 'yml', 'xml', 'conf', 'log'] },
    { role: 'fileSource', extensions: ['sh', 'bash', 'zsh', 'py', 'go', 'js', 'ts', 'tsx', 'jsx', 'java', 'c', 'h', 'cpp', 'rs', 'sql'] },
    { role: 'fileMedia', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'mp4', 'mov', 'mp3', 'wav'] },
  ] as const)('classifies every $role extension case-insensitively', ({ role, extensions }) => {
    for (const extension of extensions) {
      expect(fileColorRole('-rw-r--r--', 'sample.' + extension)).toBe(role);
      expect(fileColorRole('-rw-r--r--', 'sample.' + extension.toUpperCase())).toBe(role);
    }
  });

  it('uses link, directory, archive and executable priority before other extensions', () => {
    expect(fileColorRole('lrwxrwxrwx', 'directory.rar')).toBe('fileSymlink');
    expect(fileColorRole('drwxr-xr-x', 'archive.zip')).toBe('fileDirectory');
    expect(fileColorRole('-rwxr-xr-x', 'backup.RAR')).toBe('fileArchive');
    expect(fileColorRole('-rwxr-xr-x', 'README.md')).toBe('fileExecutable');
    expect(fileColorRole('-rwSr--r-T', 'notes')).toBe('fileName');
    expect(fileColorRole('-rw-r--r--', 'backup.tar.gz')).toBe('fileArchive');
  });

  it('colors prompts and preserves existing ANSI', () => {
    expect(colorizePlainLine('[renew@beifen ~]$ ')).toContain('\x1b[38;2;166;226;46mrenew');
    const existing = '\x1b[31malready\x1b[0m';
    expect(colorizePlainLine(existing)).toBe(existing);
  });

  it('colors the whole ls row even when the filename already has ANSI colors', () => {
    const result = colorizePlainLine('\x1b[0mdrwxrwxr-x 7 renew renew 46 1月  29 2021 \x1b[01;34mtest\x1b[0m');
    expect(result).toContain('\x1b[38;2;199;108;238md');
    expect(result.match(/\x1b\[38;2;192;136;255mrenew/g)).toHaveLength(2);
    expect(result).toContain('\x1b[38;2;158;233;0m1月');
    expect(result).toContain('\x1b[38;2;99;160;238m29');
    expect(result).toContain('\x1b[38;2;192;136;255m2021');
    expect(result).not.toContain('\x1b[01;34m');
  });

  it('colors the actual SELinux permission suffix emitted by the server', () => {
    const result = colorizePlainLine('drwx------. 12 renew renew 4096 6月  26 11:13 \x1b[0m\x1b[38;5;27m.\x1b[0m');
    expect(result).toContain('\x1b[38;2;199;108;238md');
    expect(result.match(/\x1b\[38;2;192;136;255mrenew/g)).toHaveLength(2);
    expect(result).toContain('\x1b[38;2;192;136;255m4096');
    expect(result).toContain('\x1b[38;2;158;233;0m6月');
    expect(result).toContain('\x1b[38;2;99;160;238m26');
    expect(result).toContain('\x1b[38;2;192;136;255m11:13');
  });

  it('accepts numeric months from non-Chinese locales', () => {
    expect(colorizePlainLine('-rw-r--r-- 1 root root 394 11  10 2021 l.pub')).toContain('\x1b[38;2;158;233;0m-');
  });

  it('uses the exact WindTerm read, write and execute permission colors', () => {
    const result = colorizePlainLine('-rwxrwxr-x 1 root root 394 11  10 2021 l.pub');
    expect(result).toContain('\x1b[38;2;99;160;238mr');
    expect(result).toContain('\x1b[38;2;221;160;29mw');
    expect(result).toContain('\x1b[38;2;255;65;73mx');
  });

  it('does not mistake cursor-control-only remote output for colored output', () => {
    expect(colorizePlainLine('\x1b[Kdrwxrwxr-x 7 renew renew 46 1月  29 2021 test')).toContain('\x1b[38;2;199;108;238md');
  });

  it('keeps clear-screen control sequences intact', () => {
    const clear = '\x1b[H\x1b[2J\x1b[3J';
    expect(colorizePlainLine(clear)).toBe(clear);
  });

  it('preserves carriage-return and erase controls during prompt redraws', () => {
    const input = '\r\x1b[K[renew@beifen ~]$ clear';
    expect(colorizePlainLine(input)).toBe(input);
  });

  it('colors CRLF listings without dropping their line endings', () => {
    const result = colorizePlainLine('-rw-rw-r-- 1 tomcat tomcat 107 Aug 5 2021 token\r');
    expect(result).toContain('\x1b[38;2;99;160;238mr');
    expect(result).toContain('\x1b[38;2;192;136;255mtomcat');
    expect(result.endsWith('\r')).toBe(true);
  });

  it('handles lines split across packets', () => {
    const stream = new SemanticTerminalStream(() => true);
    expect(stream.push(bytes('drwxrwxr-x 7 renew'))).toEqual(new Uint8Array());
    expect(stream.push(bytes(' renew 46 1月  29 2021 test\n'))).not.toEqual(new Uint8Array());
  });
});
