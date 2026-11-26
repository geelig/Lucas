import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readStored, removeStored, writeStored } from './storage';

describe('Lucas storage compatibility', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, String(value)); },
      removeItem: (key: string) => { values.delete(key); },
    });
  });

  it('reads and writes the Lucas namespace', () => {
    localStorage.setItem('lucas.preferences', '{"theme":"midnight"}');
    expect(readStored('preferences')).toBe('{"theme":"midnight"}');
    writeStored('preferences', '{"theme":"graphite"}');
    expect(readStored('preferences')).toBe('{"theme":"graphite"}');
    expect(localStorage.getItem('lucas.preferences')).toBe('{"theme":"graphite"}');
    removeStored('preferences');
    expect(readStored('preferences')).toBeNull();
  });
});
