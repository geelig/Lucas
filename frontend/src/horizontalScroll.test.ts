import { describe, expect, it } from 'vitest';
import { horizontalThumb, scrollLeftAtThumb } from './components/HorizontalScrollbar';

const wide = { viewport: 100, content: 400, track: 300, scrollLeft: 150 };

describe('horizontal content scrolling', () => {
  it('disables the thumb and centers it when all content fits', () => {
    expect(horizontalThumb({ viewport: 100, content: 80, track: 300, scrollLeft: 0 })).toEqual({ max: 0, visible: false, thumb: 140, left: 80, travel: 160 });
  });

  it('maps the thumb proportionally and converts it back to content position', () => {
    expect(horizontalThumb(wide)).toEqual({ max: 300, visible: true, thumb: 75, left: 112.5, travel: 225 });
    expect(scrollLeftAtThumb(112.5, wide)).toBe(150);
  });

  it('keeps a usable thumb size and clamps both ends', () => {
    const input = { viewport: 100, content: 10000, track: 300, scrollLeft: 9900 };
    expect(horizontalThumb(input).thumb).toBe(36);
    expect(horizontalThumb(input).left).toBe(264);
    expect(scrollLeftAtThumb(-20, wide)).toBe(0);
    expect(scrollLeftAtThumb(999, wide)).toBe(300);
  });
});
