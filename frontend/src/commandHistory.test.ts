import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addHistory, clearHistory, listHistory } from './commandHistory';

describe('command history panel data', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, String(value)); },
      removeItem: (key: string) => { values.delete(key); },
    });
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  });

  it('deduplicates commands and notifies the panel', () => {
    addHistory('ls', 'one');
    addHistory('pwd', 'one');
    addHistory('ls', 'two');
    expect(listHistory().map((entry) => entry.command)).toEqual(['ls', 'pwd']);
    expect(listHistory()[0].sessionName).toBe('two');
    expect(window.dispatchEvent).toHaveBeenCalledTimes(3);
  });

  it('clears stored history and notifies the panel', () => {
    addHistory('ls', 'one');
    clearHistory();
    expect(listHistory()).toEqual([]);
    expect(window.dispatchEvent).toHaveBeenCalledTimes(2);
  });
});
