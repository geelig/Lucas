import { describe, expect, it } from 'vitest';
import { LineTimestamp } from './terminalStream';

const bytes = (value: string) => new TextEncoder().encode(value);
const decode = (value: Uint8Array) => new TextDecoder().decode(value);
const plain = (value: Uint8Array) => decode(value).replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '');
const time = new Date('2026-11-20T12:34:56');

describe('LineTimestamp', () => {
  it('adds one timestamp per line and carries partial lines across packets', () => {
    const formatter = new LineTimestamp(() => true, () => time);
    const first = plain(formatter.apply(bytes('hello')));
    const second = decode(formatter.apply(bytes(' world\r\nnext')));
    expect(first).toContain('[12:34:56] hello');
    expect(second.match(/\[12:34:56\]/g)).toHaveLength(1);
    expect(second).toContain(' world\r\n');
    expect(second).toContain('next');
  });

  it('can be disabled without changing bytes', () => {
    const input = bytes('plain\n');
    expect(new LineTimestamp(() => false).apply(input)).toEqual(input);
  });

  it('does not create a timestamp-only line for terminal control packets', () => {
    const formatter = new LineTimestamp(() => true, () => time);
    formatter.apply(bytes('output\r\n'));
    const control = bytes('\x1b[?2004h');
    expect(formatter.apply(control)).toEqual(control);
    expect(plain(formatter.apply(bytes('prompt ')))).toContain('[12:34:56] prompt');
  });

  it('suppresses the padded zsh marker and timestamps the real prompt', () => {
    const formatter = new LineTimestamp(() => true, () => time);
    const control = bytes('\x1b[1m\x1b[7m%\x1b[27m\x1b[0m \r\x1b[Jprompt ');
    const result = decode(formatter.apply(control));
    expect(result).toContain('\x1b[38;2;249;38;114m[12:34:56]');
    expect(result).not.toContain('\x1b[7m%');
    expect(result).toContain('prompt');
  });

  it('keeps the zsh prompt intact when its marker is split across packets', () => {
    const formatter = new LineTimestamp(() => true, () => time);
    formatter.apply(bytes('\x1b[1m'));
    expect(formatter.apply(bytes('\x1b[7m%'))).toEqual(new Uint8Array());
    const output = decode(formatter.apply(bytes('\x1b[27m\x1b[0m \r\x1b[J[renew@beifen ~]$ ')));
    expect(output).not.toContain('\x1b[7m%');
    expect(output.match(/\[renew@beifen ~\]\$/g)).toHaveLength(1);
    expect(output).toContain('\x1b[38;2;249;38;114m[12:34:56]');
  });

  it('timestamps the exact initial zsh packet sequence', () => {
    const formatter = new LineTimestamp(() => true, () => time);
    const first = '\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m                                                                                                                       \r \r';
    const second = '\r\x1b[0m\x1b[27m\x1b[24m\x1b[Jlucas@bogon ~ % \x1b[K\x1b[?2004h';
    expect(formatter.apply(bytes(first))).toEqual(new Uint8Array());
    const output = decode(formatter.apply(bytes(second)));
    expect(output).toContain('\x1b[38;2;249;38;114m[12:34:56]');
    expect(output.match(/lucas@bogon ~ %/g)).toHaveLength(1);
  });

  it('uses white for output and red for the active prompt', () => {
    const formatter = new LineTimestamp(() => true, () => time);
    expect(decode(formatter.apply(bytes('plain output')))).toContain('\x1b[38;2;248;248;242m');
    const promptFormatter = new LineTimestamp(() => true, () => time);
    expect(decode(promptFormatter.apply(bytes('[renew@beifen ~]$ ')))).toContain('\x1b[38;2;249;38;114m');
  });

  it('keeps timestamping text that follows terminal control packets', () => {
    const formatter = new LineTimestamp(() => true, () => time);
    const output = plain(formatter.apply(bytes('\x1b[?2004l\r\r\nplain output\r\n')));
    expect(output).toContain('[12:34:56] plain output');
    expect(output.match(/\[12:34:56\]/g)).toHaveLength(1);
  });

  it('timestamps a prompt arriving after a newline in another packet', () => {
    const formatter = new LineTimestamp(() => true, () => time);
    formatter.apply(bytes('previous output\r\n'));
    expect(plain(formatter.apply(bytes('\x1b[?2004h[renew@beifen ~]$ ')))).toContain('[12:34:56] [renew@beifen ~]$ ');
  });

  it('timestamps a redrawn prompt without removing its editing controls', () => {
    const formatter = new LineTimestamp(() => true, () => time);
    formatter.apply(bytes('[renew@beifen ~]$ '));
    const output = decode(formatter.apply(bytes('\r\x1b[K[renew@beifen ~]$ ')));
    expect(output).toMatch(/^\r\x1b\[K\x1b\[38;2;249;38;114m\[12:34:56\]/);
    expect(output.match(/\[12:34:56\]/g)).toHaveLength(1);
  });

  it('timestamps the first prompt after a clear-screen sequence', () => {
    const formatter = new LineTimestamp(() => true, () => time);
    formatter.apply(bytes('previous prompt $ '));
    const output = decode(formatter.apply(bytes('\x1b[H\x1b[2J\x1b[3J[renew@beifen ~]$ ')));
    expect(output.match(/\[12:34:56\]/g)).toHaveLength(1);
    expect(output).toContain('\x1b[38;2;249;38;114m[12:34:56]');
  });

  it('waits for a split terminal control sequence instead of injecting a timestamp into it', () => {
    const formatter = new LineTimestamp(() => true, () => time);
    expect(plain(formatter.apply(bytes('output\r\n\x1b')))).toBe('[12:34:56] output\r\n');
    expect(plain(formatter.apply(bytes('[?2004hnext line\r\n')))).toBe('[12:34:56] next line\r\n');
  });

  it('does not mistake an OSC newline for a new terminal row', () => {
    const formatter = new LineTimestamp(() => true, () => time);
    expect(formatter.apply(bytes('\x1b]0;window\n'))).toEqual(new Uint8Array());
    expect(plain(formatter.apply(bytes('title\x07real output')))).toMatch(/\[12:34:56\] real output$/);
  });
});
