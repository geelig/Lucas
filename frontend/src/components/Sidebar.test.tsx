import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Profile } from '../types';
import { profileRowClass, Sidebar } from './Sidebar';

const profile: Profile = { id: 'p1', name: 'Server', protocol: 'ssh', host: 'example.test', port: 22, username: 'root' };

describe('session activation', () => {
  it('tells users to double-click to connect', () => {
    const html = renderToStaticMarkup(<Sidebar
      profiles={[profile]} groups={[]} sessions={[]}
      onOpen={() => undefined} onNew={() => undefined} onEdit={() => undefined}
      onDuplicate={() => undefined} onDelete={() => undefined} onMoveProfile={() => undefined}
      onGroupNew={() => undefined} onGroupEdit={() => undefined} onGroupDelete={() => undefined}
      onGroupMove={() => undefined} collapseGroups systemIcons={false}
      onDetectGroupOS={() => undefined} detectingGroup={false}
    />);
    expect(html).toContain('单击定位，双击连接 Server；右键编辑');
    expect(html).not.toContain('title="连接到 Server；右键编辑"');
  });

  it('separates single-click selection from the connected session', () => {
    expect(profileRowClass(false, true)).toContain('selected');
    expect(profileRowClass(false, true)).not.toContain('current');
    expect(profileRowClass(true, false)).toContain('current');
    expect(profileRowClass(true, false)).not.toContain('selected');
  });
});
