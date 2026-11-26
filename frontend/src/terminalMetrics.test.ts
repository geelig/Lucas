import { describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { refreshTerminalMetrics } from './terminalMetrics';

describe('terminal font metrics', () => {
  it('forces fresh character metrics before fitting and repainting', () => {
    const sizes: number[] = [];
    const terminal = {
      options: { fontSize: 13 },
      clearTextureAtlas: vi.fn(),
    };
    const fit = vi.fn(() => sizes.push(terminal.options.fontSize));
    refreshTerminalMetrics(terminal as unknown as Terminal, 13, fit);
    expect(terminal.options.fontSize).toBe(13);
    expect(sizes).toEqual([13]);
    expect(terminal.clearTextureAtlas).toHaveBeenCalledOnce();
    expect(fit).toHaveBeenCalledOnce();
  });
});
