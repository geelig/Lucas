import { readStored, removeStored, writeStored } from './storage';

export interface HistoryEntry {
  id: string;
  command: string;
  time: number;
  sessionName: string;
}

const STORAGE_KEY = 'history';
const HISTORY_LIMIT = 200;
const HISTORY_EVENT = 'lucas:history-changed';

function notifyHistoryChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(HISTORY_EVENT));
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === 'string'
    && typeof entry.command === 'string'
    && typeof entry.time === 'number'
    && Number.isFinite(entry.time)
    && typeof entry.sessionName === 'string';
}

export function listHistory(): HistoryEntry[] {
  try {
    const stored = readStored(STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(isHistoryEntry).slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

export function addHistory(command: string, sessionName: string): HistoryEntry[] {
  const normalizedCommand = command.trim();
  const current = listHistory();
  if (!normalizedCommand) return current;

  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    command: normalizedCommand,
    time: Date.now(),
    sessionName,
  };
  const next = [entry, ...current.filter((item) => item.command !== normalizedCommand)].slice(0, HISTORY_LIMIT);
  try {
    writeStored(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // History is best-effort; terminal input must continue when storage is unavailable.
  }
  notifyHistoryChanged();
  return next;
}

export function clearHistory(): void {
  try {
    removeStored(STORAGE_KEY);
  } catch {
    // Treat unavailable storage as an empty history.
  }
  notifyHistoryChanged();
}
