import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LucasLogo } from './components/LucasLogo';

describe('Lucas logo', () => {
  it('renders an abstract connected mark without a letter', () => {
    const html = renderToStaticMarkup(<LucasLogo size={22} />);
    expect(html).toContain('aria-label="Lucas"');
    expect(html).toContain('M8 10h16M8 16h16M8 22h16');
    expect(html.match(/<circle/g)).toHaveLength(3);
    expect(html).toContain('#5EEAD4');
    expect(html).toContain('#60A5FA');
  });
});
