import type { Terminal } from '@xterm/xterm';

export function refreshTerminalMetrics(term: Terminal, fontSize: number, fit: () => void) {
  // Force a real cell measurement after fonts finish loading; fit() alone
  // reuses the old metrics when the terminal dimensions have not changed.
  const size = term.options.fontSize ?? fontSize;
  term.options.fontSize = size + 0.001;
  term.options.fontSize = size;
  fit();
  term.clearTextureAtlas();
}
