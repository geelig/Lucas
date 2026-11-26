import type { CustomAppearance } from './appearance';
import { colorForRole, load } from './appearance';
import { fileColorRole, listingPattern, permissionRole } from './terminalSemantic';
import { genericSyntaxSpans } from './terminalSyntax';
import type { IBuffer, IBufferLine, IDecoration, Terminal } from '@xterm/xterm';

type Role = keyof CustomAppearance;
export interface ListingSpan { start: number; end: number; role: Role }
interface LineEntry { text: string; decorations: IDecoration[] }

export function listingSpans(text: string): ListingSpan[] {
  const prefix = text.match(/^(?:\[\d{2}:\d{2}:\d{2}\]\s+)?/)?.[0].length ?? 0;
  const match = listingPattern.exec(text.slice(prefix));
  if (!match) return [];
  const spans: ListingSpan[] = [];
  let cursor = prefix + match[1].length;
  const permissions = match[2];
  [...permissions].forEach((character, index) => spans.push({ start: cursor + index, end: cursor + index + 1, role: permissionRole(character, index) }));
  cursor += permissions.length;
  const field = (value: string, role?: Role) => {
    const start = text.indexOf(value, cursor);
    if (start < 0) return;
    if (role) spans.push({ start, end: start + value.length, role });
    cursor = start + value.length;
  };
  field(match[3]);
  field(match[4], 'owner');
  field(match[5], 'group');
  field(match[6], 'size');
  field(match[7], 'date');
  field(match[8], 'dateDay');
  field(match[9], 'dateYear');
  field(match[10], fileColorRole(match[2], match[10]));
  return spans;
}

function cellColumn(line: IBufferLine, text: string, index: number): number {
  let column = 0;
  let offset = 0;
  for (const character of text) {
    if (offset >= index) break;
    column += Math.max(1, line.getCell(column)?.getWidth() ?? 1);
    offset += character.length;
  }
  return column;
}

/** Colors parsed terminal rows without depending on the server's raw ANSI layout. */
export class TerminalBufferDecorator {
  private lines = new Map<number, LineEntry>();
  private active = new Set<IDecoration>();
  private paletteKey = '';
  constructor(private readonly terminal: Terminal, private readonly enabled: () => boolean) {}

  update() {
    if (!this.enabled() || this.terminal.buffer.active === this.terminal.buffer.alternate) {
      this.clear();
      return;
    }
    const appearance = load();
    const paletteKey = Object.values(appearance).join('|');
    if (paletteKey !== this.paletteKey) {
      this.clear();
      this.paletteKey = paletteKey;
    }
    const buffer = this.terminal.buffer.active;
    const start = Math.max(0, buffer.viewportY);
    const end = Math.min(buffer.length, start + this.terminal.rows);
    for (let row = start; row < end; row += 1) {
      const line = buffer.getLine(row);
      if (line) this.decorateLine(buffer, row, line, appearance);
    }
    while (this.lines.size > 200) {
      const oldest = this.lines.entries().next().value as [number, LineEntry] | undefined;
      if (!oldest) break;
      oldest[1].decorations.forEach((decoration) => { decoration.dispose(); this.active.delete(decoration); });
      this.lines.delete(oldest[0]);
    }
  }

  private decorateLine(buffer: IBuffer, row: number, line: IBufferLine, appearance: CustomAppearance) {
    const text = line.translateToString(true);
    const previous = this.lines.get(row);
    if (previous?.text === text) return;
    previous?.decorations.forEach((decoration) => { decoration.dispose(); this.active.delete(decoration); });
    const entry: LineEntry = { text, decorations: [] };
    this.lines.set(row, entry);
    const listings = listingSpans(text);
    for (const span of listings.length ? listings : genericSyntaxSpans(text)) {
      const marker = this.terminal.registerMarker(row - buffer.baseY - buffer.cursorY);
      if (marker.line < 0) { marker.dispose(); continue; }
      const x = cellColumn(line, text, span.start);
      const width = cellColumn(line, text, span.end) - x;
      const decoration = this.terminal.registerDecoration({ marker, x, width, foregroundColor: colorForRole(span.role, appearance), layer: 'bottom' });
      if (!decoration) { marker.dispose(); continue; }
      entry.decorations.push(decoration);
      this.active.add(decoration);
    }
  }

  clear() {
    this.active.forEach((decoration) => decoration.dispose());
    this.active.clear();
    this.lines.clear();
  }

  dispose() { this.clear(); }
}
