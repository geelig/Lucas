import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Profile } from '../types';
import { Welcome } from './Welcome';

describe('recent connections', () => {
  it('uses double-click to open a recent session', () => {
    const profile: Profile = { id: 'p1', name: 'Server', protocol: 'ssh', host: 'example.test', port: 22, username: 'root' };
    const html = renderToStaticMarkup(<Welcome profiles={[profile]} onNew={() => undefined} onOpen={() => undefined} />);
    expect(html).toContain('双击连接 Server');
  });
});
