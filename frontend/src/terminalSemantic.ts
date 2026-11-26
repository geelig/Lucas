const encoder = new TextEncoder();
import { colorForRole } from './appearance';
import { colorizeSyntaxText } from './terminalSyntax';

const palette: Record<number, string> = { 91: '#f92672', 92: '#a6e22e', 93: '#e6db74', 94: '#819aff', 95: '#ae81ff', 96: '#66d9ef', 97: '#f8f8f2' };
const rgbColor = (hex: string, value: string) => {
  const rgb = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${value}\x1b[0m`;
};
const color = (code: number, value: string, role?: Parameters<typeof colorForRole>[0]) => {
  if (role) return rgbColor(colorForRole(role), value);
  const hex = palette[code] || '#f8f8f2';
  return rgbColor(hex, value);
};
const stripControls = (value: string) => value
  .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
  .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
  .replace(/\x1b[()][0-2]/g, '');
// GNU ls may append SELinux '.', ACL '+', or extended-attribute '@'.
export const listingPattern = /^(\s*)([bcdlps-][rwxstST-]{9}[.@+]?)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+((?:\d{1,2}月|\d{1,2}|[A-Za-z]{3}))\s+(\d{1,2})\s+(\d{4}|\d{1,2}:\d{2})\s+(.+)$/;

export type FileColorRole = 'fileName' | 'fileDirectory' | 'fileArchive' | 'fileExecutable' | 'fileSymlink' | 'fileDocument' | 'fileSource' | 'fileMedia';

const archivePattern = /\.(?:tar(?:\.(?:gz|bz2|xz|zst))?|tgz|zip|rar|7z|gz|bz2|xz|zst|dmg|pkg|iso)$/i;
const documentExtensions = new Set(['txt', 'md', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'json', 'yaml', 'yml', 'xml', 'conf', 'log']);
const sourceExtensions = new Set(['sh', 'bash', 'zsh', 'py', 'go', 'js', 'ts', 'tsx', 'jsx', 'java', 'c', 'h', 'cpp', 'rs', 'sql']);
const mediaExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'mp4', 'mov', 'mp3', 'wav']);

/** Classify every listing filename with the same priority in both renderers. */
export function fileColorRole(permissions: string, name: string): FileColorRole {
  if (permissions.startsWith('l')) return 'fileSymlink';
  if (permissions.startsWith('d')) return 'fileDirectory';
  const cleanName = name.trimEnd();
  if (archivePattern.test(cleanName)) return 'fileArchive';
  // Lowercase s/t also carry execute permission; uppercase S/T do not.
  if (/[xst]/.test(permissions.slice(1, 10))) return 'fileExecutable';
  const extension = cleanName.match(/\.([^.]+)$/)?.[1].toLowerCase();
  if (extension && documentExtensions.has(extension)) return 'fileDocument';
  if (extension && sourceExtensions.has(extension)) return 'fileSource';
  if (extension && mediaExtensions.has(extension)) return 'fileMedia';
  return 'fileName';
}

export function permissionRole(character: string, index: number): Parameters<typeof colorForRole>[0] {
  if (index === 0) return character === '-' ? 'permissionDash' : 'permission';
  if (index > 9 || character === '-') return 'permissionDash';
  if (character === 'r') return 'permissionRead';
  if (character === 'w') return 'permissionWrite';
  return 'permissionExecute';
}

function colorizePermissionBits(value: string): string {
  return [...value].map((character, index) => {
    const hex = colorForRole(permissionRole(character, index));
    return rgbColor(hex, character);
  }).join('');
}

export function colorizePlainLine(line: string): string {
  if (!line) return line;
  // Never drop clear/home controls: `clear` depends on them.
  if (/\x1b\[(?:[23]?J|H|f)/.test(line)) return line;
  const original = line;
  const suffix = line.endsWith('\r') ? '\r' : '';
  const core = suffix ? line.slice(0, -1) : line;
  const prefix = core.match(/^(?:\r|\x1b\[[0-9;?]*[ -\/]*[@-~])*/)?.[0] ?? '';
  // Readline carriage-return redraws must stay byte-for-byte intact. The
  // visible command is still colored safely by the buffer decorator.
  if (prefix.includes('\r')) return original;
  const content = core.slice(prefix.length);
  // Cursor controls embedded in a redraw must never be discarded. Prefix
  // controls are retained and the visible content is colored independently.
  if (/\r|\x1b/.test(content.replace(/\x1b\[[0-9;]*m/g, ''))) return original;
  const plain = stripControls(content);
  // Preserve meaningful server-selected colors, but do not let reset/white
  // sequences suppress semantic command highlighting.
  const hasServerColor = /\x1b\[[0-9;]*(?:3[1-6]|9[0-6]|38;5;(?!7\b|15\b|253\b|255\b)\d+|48;)/.test(core);
  if (hasServerColor && !listingPattern.test(plain)) return original;
  line = plain;

  const listing = line.match(listingPattern);
  if (listing) {
    const [, indent, permissions, links, owner, group, size, month, day, year, name] = listing;
    return prefix + indent
      + colorizePermissionBits(permissions) + ' ' + links + ' '
      + color(92, owner, 'owner') + ' ' + color(92, group, 'group') + ' '
      + color(95, size, 'size') + ' ' + color(93, month, 'date') + ' '
      + color(94, day, 'dateDay') + ' ' + color(95, year, 'dateYear') + ' '
      + color(97, name, fileColorRole(permissions, name)) + suffix;
  }

  const prompt = line.match(/^(\s*)(?:\[)?([\w.-]+)@([\w.-]+)([^$#]*)([$#])(\]?)(\s*)$/);
  if (prompt) {
    const [, indent, user, host, directory, symbol, bracket, trailing] = prompt;
    return prefix + indent + color(92, user, 'promptUser') + '@' + color(96, host, 'promptHost') + color(93, directory, 'promptPath') + color(93, symbol + bracket, 'promptPath') + trailing + suffix;
  }

  return prefix + colorizeSyntaxText(line) + suffix;
}

/** Streaming semantic colors for servers that emit plain, uncoloured text. */
export class SemanticTerminalStream {
  private pending = '';
  private decoder = new TextDecoder();
  constructor(private readonly enabled: () => boolean) {}

  push(data: Uint8Array): Uint8Array {
    const text = this.pending + this.decoder.decode(data, { stream: true });
    this.pending = '';
    if (!this.enabled()) return data;
    const lastNewline = text.lastIndexOf('\n');
    const complete = lastNewline >= 0 ? text.slice(0, lastNewline + 1) : '';
    this.pending = lastNewline >= 0 ? text.slice(lastNewline + 1) : text;
    if (!complete && this.pending && /[$#]\s*$/.test(this.pending)) return this.flush();
    return encoder.encode(this.colorize(complete));
  }

  flush(): Uint8Array {
    const value = this.pending;
    this.pending = '';
    return encoder.encode(this.colorize(value));
  }

  get hasPending() { return this.pending.length > 0; }

  private colorize(value: string): string {
    return value.split('\n').map((line) => colorizePlainLine(line)).join('\n');
  }
}
