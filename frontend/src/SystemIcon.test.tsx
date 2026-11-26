import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SystemIcon } from './components/SystemIcon';

describe('operating system icons', () => {
  it('keeps CentOS visible on dark backgrounds', () => {
    const html = renderToStaticMarkup(<SystemIcon os="centos" protocol="ssh" />);
    expect(html).toContain('data-system="centos"');
    expect(html).toContain('--system-icon-color:#8fa8ff');
    expect(html).not.toContain('#262577');
  });

  it('uses operating system glyphs for Linux and macOS', () => {
    expect(renderToStaticMarkup(<SystemIcon os="GNU/Linux" protocol="ssh" />)).toContain('data-system="linux"');
    expect(renderToStaticMarkup(<SystemIcon os="Darwin" protocol="local" />)).toContain('data-system="macos"');
  });
});
