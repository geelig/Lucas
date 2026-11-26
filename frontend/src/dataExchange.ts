import { listHistory, type HistoryEntry } from './commandHistory';
import { readStored, writeStored } from './storage';
import type { SavedCommand } from './types';

const COMMANDS_STORAGE_KEY = 'commands';
const HISTORY_STORAGE_KEY = 'history';
const HISTORY_LIMIT = 200;
const HISTORY_EVENT = 'lucas:history-changed';

export interface LocalImportCounts {
  history: number;
  savedCommands: number;
}

type JsonDocument = Record<string, unknown>;

function parseDocument(data: string): JsonDocument {
  const parsed: unknown = JSON.parse(data);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('导出文档必须是 JSON 对象');
  }
  return parsed as JsonDocument;
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

function isSavedCommand(value: unknown): value is SavedCommand {
  if (!value || typeof value !== 'object') return false;
  const command = value as Record<string, unknown>;
  return typeof command.id === 'string' && command.id.length > 0
    && typeof command.name === 'string' && command.name.length > 0
    && typeof command.command === 'string' && command.command.length > 0;
}

export function listSavedCommands(): SavedCommand[] {
  try {
    const parsed: unknown = JSON.parse(readStored(COMMANDS_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedCommand).map(({ id, name, command }) => ({ id, name, command }));
  } catch {
    return [];
  }
}

/** Add browser-local data without changing or importing backend credentials. */
export function addLocalDataToExport(data: string): string {
  const document = parseDocument(data);
  return JSON.stringify({
    ...document,
    history: listHistory(),
    savedCommands: listSavedCommands(),
  }, null, 2) + '\n';
}

function mergeHistory(value: unknown[]): number {
  const imported = value.filter(isHistoryEntry).map(({ id, command, time, sessionName }) => ({
    id, command, time, sessionName,
  }));
  const importedEntries = new Set<HistoryEntry>(imported);
  const ids = new Set<string>();
  const commands = new Set<string>();
  const merged = [...listHistory(), ...imported]
    .sort((a, b) => b.time - a.time)
    .filter((entry) => {
      if (ids.has(entry.id) || commands.has(entry.command)) return false;
      ids.add(entry.id);
      commands.add(entry.command);
      return true;
    })
    .slice(0, HISTORY_LIMIT);
  writeStored(HISTORY_STORAGE_KEY, JSON.stringify(merged));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(HISTORY_EVENT));
  return merged.filter((entry) => importedEntries.has(entry)).length;
}

function mergeSavedCommands(value: unknown[]): number {
  const current = listSavedCommands();
  const ids = new Set(current.map((command) => command.id));
  const commands = new Set(current.map((command) => command.command));
  const added: SavedCommand[] = [];
  for (const entry of value.filter(isSavedCommand)) {
    if (ids.has(entry.id) || commands.has(entry.command)) continue;
    const command = { id: entry.id, name: entry.name, command: entry.command };
    added.push(command);
    ids.add(command.id);
    commands.add(command.command);
  }
  writeStored(COMMANDS_STORAGE_KEY, JSON.stringify([...current, ...added]));
  return added.length;
}

/** Merge optional local fields; backend profiles and groups are left untouched. */
export function importLocalData(data: string): LocalImportCounts {
  const document = parseDocument(data);
  const hasHistory = Array.isArray(document.history);
  const hasSavedCommands = Array.isArray(document.savedCommands);
  if (!hasHistory && !hasSavedCommands) return { history: 0, savedCommands: 0 };
  return {
    history: hasHistory ? mergeHistory(document.history as unknown[]) : 0,
    savedCommands: hasSavedCommands ? mergeSavedCommands(document.savedCommands as unknown[]) : 0,
  };
}
