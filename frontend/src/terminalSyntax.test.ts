import { describe, expect, it } from 'vitest';
import { colorizeSyntaxText, genericSyntaxSpans } from './terminalSyntax';
import { colorizePlainLine } from './terminalSemantic';

const texts = (text: string) => genericSyntaxSpans(text).map((span) => ({ ...span, value: text.slice(span.start, span.end) }));

describe('general terminal syntax colors', () => {
  it('colors commands, options and paths without coloring every word', () => {
    const spans = texts('git status --short /var/log');
    expect(spans).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'git', role: 'command' }),
      expect.objectContaining({ value: '--short', role: 'option' }),
      expect.objectContaining({ value: '/var/log', role: 'path' }),
    ]));
  });

  it('colors errors, warnings, success, addresses and measurements', () => {
    const spans = texts('ERROR failed 172.31.16.46:22355 98 Bytes 12.5%');
    expect(spans).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'ERROR', role: 'error' }),
      expect.objectContaining({ value: '172.31.16.46:22355', role: 'info' }),
      expect.objectContaining({ value: '98', role: 'number' }),
      expect.objectContaining({ value: '12.5%', role: 'number' }),
    ]));
  });

  it('colors JSON keys, string values, booleans and counts', () => {
    const spans = texts('{"status":"ok","ready":true,"count":3}');
    expect(spans).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: '"status"', role: 'info' }),
      expect.objectContaining({ value: '"ok"', role: 'string' }),
      expect.objectContaining({ value: 'true', role: 'keyword' }),
      expect.objectContaining({ value: '3', role: 'number' }),
    ]));
  });

  it('emits ANSI colors for general commands', () => {
    expect(colorizeSyntaxText('git status --short')).toContain('\x1b[38;2;166;226;46mgit');
    expect(colorizeSyntaxText('git status --short')).toContain('\x1b[38;2;230;219;116m--short');
  });

  it('colors commands after shell prompts and command separators', () => {
    const spans = texts('[renew@beifen ~]$ sudo systemctl status nginx && tail -f /var/log/nginx.log');
    expect(spans).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'sudo', role: 'command' }),
      expect.objectContaining({ value: 'systemctl', role: 'command' }),
      expect.objectContaining({ value: 'tail', role: 'command' }),
      expect.objectContaining({ value: '/var/log/nginx.log', role: 'path' }),
    ]));
  });

  it('recolors reset-only output but preserves meaningful server colors', () => {
    expect(colorizePlainLine('\x1b[0mgit status --short')).toContain('\x1b[38;2;166;226;46mgit');
    expect(colorizePlainLine('\x1b[31malready\x1b[0m')).toBe('\x1b[31malready\x1b[0m');
  });
});
