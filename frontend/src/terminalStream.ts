const encoder = new TextEncoder();
const decoder = new TextDecoder();
import { colorForRole } from './appearance';

function colorText(hex: string, value: string): string {
  const rgb = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${value}\x1b[39m`;
}

type TerminalToken = { end: number; kind: 'visible' | 'control' | 'newline' | 'incomplete' };

/** Never split a CSI/OSC/DCS packet when deciding where a line begins. */
function terminalTokenAt(data: Uint8Array, offset: number): TerminalToken {
  const byte = data[offset];
  if (byte === 10) return { end: offset + 1, kind: 'newline' };
  if (byte !== 27) return { end: offset + 1, kind: byte < 32 || byte === 127 ? 'control' : 'visible' };
  if (offset + 1 >= data.length) return { end: data.length, kind: 'incomplete' };
  const introducer = data[offset + 1];
  if (introducer === 91) {
    for (let index = offset + 2; index < data.length; index += 1) {
      if (data[index] >= 64 && data[index] <= 126) return { end: index + 1, kind: 'control' };
    }
    return { end: data.length, kind: 'incomplete' };
  }
  if ([80, 88, 93, 94, 95].includes(introducer)) {
    for (let index = offset + 2; index < data.length; index += 1) {
      if (introducer === 93 && data[index] === 7) return { end: index + 1, kind: 'control' };
      if (data[index] === 27) {
        if (index + 1 >= data.length) return { end: data.length, kind: 'incomplete' };
        if (data[index + 1] === 92) return { end: index + 2, kind: 'control' };
      }
    }
    return { end: data.length, kind: 'incomplete' };
  }
  let index = offset + 1;
  while (index < data.length && data[index] >= 32 && data[index] <= 47) index += 1;
  return index < data.length ? { end: index + 1, kind: 'control' } : { end: data.length, kind: 'incomplete' };
}

function isPromptAt(data: Uint8Array, offset: number): boolean {
  const end = data.indexOf(10, offset);
  const line = decoder.decode(data.subarray(offset, end < 0 ? data.length : end));
  const plain = line.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  return /[%$#]\s*$/.test(plain);
}

function startsFreshLine(data: Uint8Array, offset: number, end: number, afterCarriageReturn: boolean): boolean {
  if (data[offset] !== 27 || data[offset + 1] !== 91) return false;
  const final = data[end - 1];
  const parameters = decoder.decode(data.subarray(offset + 2, end - 1));
  if (final === 74 && parameters === '2') return true;
  return afterCarriageReturn && (final === 75 || (final === 74 && (parameters === '' || parameters === '0' || parameters === '2')));
}

// Wait for zsh's full-line erase before placing the timestamp. Its padded
// inverse-% marker is non-content and may wrap when the PTY and view widths
// differ, so replace that marker with an explicit cursor/line reset.
function zshMarkerRange(data: Uint8Array, offset: number): { start: number; end: number } | undefined {
  const remaining = decoder.decode(data.subarray(offset));
  const marker = remaining.indexOf('\x1b[7m%');
  if (marker < 0) return undefined;
  const newline = remaining.indexOf('\n');
  if (newline >= 0 && newline < marker) return undefined;
  const prompt = remaining.indexOf('\x1b[J', marker);
  return prompt < 0 ? undefined : { start: offset + marker, end: offset + prompt + 3 };
}

function hasPartialZshMarker(data: Uint8Array, offset: number): boolean {
  if (data.indexOf(10, offset) >= 0) return false;
  return decoder.decode(data.subarray(offset)).includes('\x1b[7m');
}

/** Adds white output timestamps and a red timestamp on the active prompt. */
export class LineTimestamp {
  private lineStart = true;
  private afterCarriageReturn = false;
  private pendingControl: number[] = [];
  constructor(private readonly enabled: () => boolean, private readonly now: () => Date = () => new Date()) {}

  apply(data: Uint8Array): Uint8Array {
    if (!this.enabled()) {
      if (!this.pendingControl.length) return data;
      const pending = Uint8Array.from(this.pendingControl);
      this.pendingControl = [];
      const output = new Uint8Array(pending.length + data.length);
      output.set(pending); output.set(data, pending.length);
      return output;
    }
    let input = data;
    if (this.pendingControl.length) {
      input = new Uint8Array(this.pendingControl.length + data.length);
      input.set(this.pendingControl); input.set(data, this.pendingControl.length);
      this.pendingControl = [];
    }
    const chunks: Uint8Array[] = [];
    let index = 0;
    while (index < input.length) {
      if (this.lineStart) {
        const marker = zshMarkerRange(input, index);
        if (marker) {
          if (marker.start > index) chunks.push(input.subarray(index, marker.start));
          chunks.push(encoder.encode('\r\x1b[J'));
          index = marker.end;
          chunks.push(encoder.encode(colorText(colorForRole('currentTimestamp'), `[${this.now().toLocaleTimeString('zh-CN', { hour12: false })}]`) + ' '));
          this.lineStart = false;
          this.afterCarriageReturn = false;
          continue;
        }
        if (hasPartialZshMarker(input, index)) {
          this.pendingControl.push(...input.subarray(index));
          break;
        }
      }
      const token = terminalTokenAt(input, index);
      if (token.kind === 'incomplete') {
        this.pendingControl.push(...input.subarray(index));
        break;
      }
      const freshLine = startsFreshLine(input, index, token.end, this.afterCarriageReturn);
      const carriageReturn = token.end === index + 1 && input[index] === 13;
      if (carriageReturn) this.afterCarriageReturn = true;
      else if (freshLine || token.kind === 'visible' || token.kind === 'newline') this.afterCarriageReturn = false;
      if (this.lineStart) {
        if (token.kind !== 'visible') {
          chunks.push(input.subarray(index, token.end));
          if (freshLine) this.lineStart = true;
          index = token.end;
          continue;
        }
        const role = isPromptAt(input, index) ? 'currentTimestamp' : 'historyTimestamp';
        chunks.push(encoder.encode(colorText(colorForRole(role), `[${this.now().toLocaleTimeString('zh-CN', { hour12: false })}]`) + ' '));
        this.lineStart = false;
      }
      chunks.push(input.subarray(index, token.end));
      if (token.kind === 'newline' || freshLine) this.lineStart = true;
      index = token.end;
    }
    const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
  }
}
