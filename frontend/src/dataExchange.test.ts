import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addHistory, listHistory, type HistoryEntry } from './commandHistory';
import {
  addLocalDataToExport,
  importLocalData,
  listSavedCommands,
} from './dataExchange';
import { readStored, writeStored } from './storage';
import type { SavedCommand } from './types';

const historyEntry = (id: string, command: string, time: number, sessionName = 'server'): HistoryEntry => ({
  id, command, time, sessionName,
});

const savedCommand = (id: string, name: string, command: string): SavedCommand => ({ id, name, command });

describe('Lucas local data exchange', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, String(value)); },
      removeItem: (key: string) => { values.delete(key); },
    });
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  });

  it('adds history and saved commands without changing the backend document', () => {
    const history = [historyEntry('h1', 'ls -la', 100, 'web')];
    const commands = [savedCommand('c1', 'List files', 'ls -la')];
    writeStored('history', JSON.stringify(history));
    writeStored('commands', JSON.stringify(commands));
    const backendDocument = {
      app: 'Lucas',
      format: 1,
      groups: [],
      profiles: [{ id: 'p1', host: '127.0.0.1' }],
      groupOrder: [],
    };

    const exported = addLocalDataToExport(JSON.stringify(backendDocument));

    expect(exported.endsWith('\n')).toBe(true);
    expect(exported).toContain('\n  "history": [');
    expect(JSON.parse(exported)).toEqual({ ...backendDocument, history, savedCommands: commands });
    expect(exported).toBe(JSON.stringify(JSON.parse(exported), null, 2) + '\n');
  });

  it('exports empty arrays and rejects invalid JSON documents', () => {
    expect(JSON.parse(addLocalDataToExport('{"profiles":[]}'))).toMatchObject({
      profiles: [], history: [], savedCommands: [],
    });
    expect(() => addLocalDataToExport('[]')).toThrow('导出文档必须是 JSON 对象');
    expect(() => addLocalDataToExport('{')).toThrow(SyntaxError);
  });

  it('merges history by newest time, deduplicates commands and returns imported counts', () => {
    addHistory('existing', 'local');
    writeStored('history', JSON.stringify([
      historyEntry('existing-id', 'same', 10, 'local'),
      historyEntry('old-id', 'old', 20, 'local'),
    ]));
    writeStored('commands', JSON.stringify([
      savedCommand('existing-id', 'Existing name', 'existing command'),
      savedCommand('command-id', 'Existing command', 'same command'),
    ]));
    vi.mocked(window.dispatchEvent).mockClear();

    const counts = importLocalData(JSON.stringify({
      app: 'Lucas',
      profiles: [{ id: 'p1', password: 'must-not-be-written' }],
      history: [
        historyEntry('imported-id', 'same', 30, 'backup'),
        historyEntry('older-duplicate', 'same', 5, 'older backup'),
        historyEntry('new-id', 'new', 40, 'backup'),
        historyEntry('new-id', 'same ID must not duplicate', 39, 'backup'),
      ],
      savedCommands: [
        savedCommand('existing-id', 'Must not replace', 'other command'),
        savedCommand('another-id', 'Duplicate command', 'same command'),
        savedCommand('new-command-id', 'New command', 'new command'),
      ],
    }));

    expect(counts).toEqual({ history: 2, savedCommands: 1 });
    expect(listHistory()).toEqual([
      historyEntry('new-id', 'new', 40, 'backup'),
      historyEntry('imported-id', 'same', 30, 'backup'),
      historyEntry('old-id', 'old', 20, 'local'),
    ]);
    expect(listSavedCommands()).toEqual([
      savedCommand('existing-id', 'Existing name', 'existing command'),
      savedCommand('command-id', 'Existing command', 'same command'),
      savedCommand('new-command-id', 'New command', 'new command'),
    ]);
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(window.dispatchEvent).mock.calls[0][0].type).toBe('lucas:history-changed');
    expect(readStored('profiles')).toBeNull();
  });

  it('validates imported fields and limits merged history to 200 entries', () => {
    writeStored('history', JSON.stringify([historyEntry('local', 'local', 999)]));
    writeStored('commands', JSON.stringify([
      savedCommand('valid', 'Valid', 'valid'),
      { id: 'missing-command', name: 'Invalid' },
    ]));

    const result = importLocalData(JSON.stringify({
      history: [
        ...Array.from({ length: 205 }, (_, index) => historyEntry(`h${index}`, `command-${index}`, index + 1)),
        { ...historyEntry('bad-time', 'bad', 1), time: Number.NaN },
        { ...historyEntry('bad-session', 'bad session', 1), sessionName: 1 },
        null,
      ],
      savedCommands: [
        savedCommand('', 'Missing id', 'missing id'),
        { id: 'missing-name', command: 'missing name' },
        savedCommand('new-valid', 'New valid', 'new valid'),
      ],
    }));

    expect(result).toEqual({ history: 199, savedCommands: 1 });
    expect(listHistory()).toHaveLength(200);
    expect(listHistory()[0]).toEqual(historyEntry('local', 'local', 999));
    expect(listHistory().some((entry) => entry.id === 'bad-time' || entry.id === 'bad-session')).toBe(false);
    expect(listSavedCommands()).toEqual([
      savedCommand('valid', 'Valid', 'valid'),
      savedCommand('new-valid', 'New valid', 'new valid'),
    ]);
  });

  it('does nothing for old backups without local data fields', () => {
    writeStored('history', JSON.stringify([historyEntry('h1', 'ls', 1)]));
    writeStored('commands', JSON.stringify([savedCommand('c1', 'List', 'ls')]));
    const historyBefore = readStored('history');
    const commandsBefore = readStored('commands');

    expect(importLocalData('{"app":"Lucas","groups":[],"profiles":[]}')).toEqual({
      history: 0, savedCommands: 0,
    });
    expect(readStored('history')).toBe(historyBefore);
    expect(readStored('commands')).toBe(commandsBefore);
    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });
});
