import { readStored, writeStored } from './storage';

export interface CustomAppearance {
  background: string;
  foreground: string;
  permission: string;
  permissionRead: string;
  permissionWrite: string;
  permissionExecute: string;
  permissionDash: string;
  owner: string;
  group: string;
  size: string;
  date: string;
  dateDay: string;
  dateYear: string;
  fileName: string;
  fileDirectory: string;
  fileArchive: string;
  fileExecutable: string;
  fileSymlink: string;
  fileDocument: string;
  fileSource: string;
  fileMedia: string;
  promptUser: string;
  promptHost: string;
  promptPath: string;
  currentTimestamp: string;
  historyTimestamp: string;
  command: string;
  option: string;
  error: string;
  warning: string;
  success: string;
  info: string;
  number: string;
  path: string;
  url: string;
  string: string;
  keyword: string;
  muted: string;
}

export const APPEARANCE_STORAGE_KEY = 'appearance';

export const DEFAULT_APPEARANCE: Readonly<CustomAppearance> = Object.freeze({
  background: '#1c1c1c',
  foreground: '#f8f8f2',
  // Exact roles sampled from the user's terminal color reference.
  permission: '#c76cee',
  permissionRead: '#63a0ee',
  permissionWrite: '#dda01d',
  permissionExecute: '#ff4149',
  permissionDash: '#9ee900',
  owner: '#c088ff',
  group: '#c088ff',
  size: '#c088ff',
  date: '#9ee900',
  dateDay: '#63a0ee',
  dateYear: '#c088ff',
  fileName: '#f8f8f2',
  fileDirectory: '#63a0ee',
  fileArchive: '#f92672',
  fileExecutable: '#9ee900',
  fileSymlink: '#66d9ef',
  fileDocument: '#e6db74',
  fileSource: '#dda01d',
  fileMedia: '#c088ff',
  promptUser: '#a6e22e',
  promptHost: '#66d9ef',
  promptPath: '#e6db74',
  currentTimestamp: '#f92672',
  historyTimestamp: '#f8f8f2',
  command: '#a6e22e',
  option: '#e6db74',
  error: '#f92672',
  warning: '#dda01d',
  success: '#9ee900',
  info: '#66d9ef',
  number: '#c088ff',
  path: '#63a0ee',
  url: '#66d9ef',
  string: '#e6db74',
  keyword: '#ae81ff',
  muted: '#888888',
});

export const defaultAppearance: CustomAppearance = { ...DEFAULT_APPEARANCE };

const roles = Object.keys(DEFAULT_APPEARANCE) as (keyof CustomAppearance)[];
const colorPattern = /^#[0-9a-f]{6}$/i;

export function validate(value: unknown): CustomAppearance {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const appearance = { ...DEFAULT_APPEARANCE };
  for (const role of roles) {
    const color = source[role];
    if (typeof color === 'string' && colorPattern.test(color)) appearance[role] = color.toLowerCase();
  }
  return appearance;
}

export function colorForRole(role: keyof CustomAppearance, value?: unknown): string {
  if (!roles.includes(role)) return DEFAULT_APPEARANCE.foreground;
  const input = value === undefined ? load() : value;
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const color = source[role];
  return typeof color === 'string' && colorPattern.test(color)
    ? color.toLowerCase()
    : DEFAULT_APPEARANCE[role];
}

export function load(): CustomAppearance {
  try {
    const stored = readStored(APPEARANCE_STORAGE_KEY);
    return stored ? validate(JSON.parse(stored)) : { ...DEFAULT_APPEARANCE };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function save(value: unknown): CustomAppearance {
  const appearance = validate(value);
  try {
    writeStored(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    // The validated value remains usable when storage is unavailable.
  }
  return appearance;
}

export function apply(value: unknown = load(), target?: HTMLElement): CustomAppearance {
  const appearance = validate(value);
  const root = target ?? (typeof document === 'undefined' ? undefined : document.documentElement);
  if (root) {
    root.style.setProperty('--terminal', appearance.background);
    root.style.setProperty('--bg', appearance.background);
    root.style.setProperty('--text', appearance.foreground);
    for (const role of roles) {
      const cssName = role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      root.style.setProperty(`--custom-${cssName}`, appearance[role]);
    }
  }
  return appearance;
}
