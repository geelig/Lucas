import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  colorForRole,
  load,
  save,
  validate,
  type CustomAppearance,
} from './appearance';

function storageMock() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
  };
}

describe('custom appearance', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', storageMock());
    localStorage.clear();
  });

  it('saves and loads every color', () => {
    const expected: CustomAppearance = {
      ...DEFAULT_APPEARANCE,
      background: '#102030',
      permission: '#A1B2C3',
      fileName: '#fedcba',
    };
    expect(save(expected)).toEqual({ ...expected, permission: '#a1b2c3' });
    expect(load()).toEqual({ ...expected, permission: '#a1b2c3' });
    expect(JSON.parse(localStorage.getItem(`lucas.${APPEARANCE_STORAGE_KEY}`) || '{}')).toEqual(load());
  });

  it('falls back to defaults for malformed JSON and non-object values', () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, '{bad json');
    expect(load()).toEqual(DEFAULT_APPEARANCE);
    expect(validate(null)).toEqual(DEFAULT_APPEARANCE);
    expect(validate([])).toEqual(DEFAULT_APPEARANCE);
  });

  it('replaces only missing or invalid colors with defaults', () => {
    const result = validate({ background: '#010203', owner: 'red', size: '#abcd' });
    expect(result.background).toBe('#010203');
    expect(result.owner).toBe(DEFAULT_APPEARANCE.owner);
    expect(result.size).toBe(DEFAULT_APPEARANCE.size);
    expect(result.fileName).toBe(DEFAULT_APPEARANCE.fileName);
    expect(colorForRole('owner', result)).toBe(DEFAULT_APPEARANCE.owner);
    expect(colorForRole('background', { background: '#A0B0C0' })).toBe('#a0b0c0');
  });
});
