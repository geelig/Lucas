export function readStored(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(`lucas.${key}`) ?? null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try { globalThis.localStorage?.setItem(`lucas.${key}`, value); } catch { /* Keep in-memory state when storage is unavailable. */ }
}

export function removeStored(key: string): void {
  try {
    globalThis.localStorage?.removeItem(`lucas.${key}`);
  } catch { /* Ignore unavailable storage. */ }
}
