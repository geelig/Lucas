import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Profile } from '../types';
import { ProfileDialog, privateKeyPathFromSelection } from './ProfileDialog';

const keyProfile = {
  id: 'ssh-key',
  name: '密钥连接',
  protocol: 'ssh',
  host: 'example.com',
  port: 22,
  username: 'root',
  auth: 'key',
  privateKeyPath: '/existing/id_ed25519',
} as Profile;

function renderKeyProfile() {
  return renderToStaticMarkup(<ProfileDialog
    profile={keyProfile}
    groups={[]}
    profiles={[keyProfile]}
    onClose={() => undefined}
    onSave={async () => undefined}
    onConnect={async () => undefined}
  />);
}

describe('SSH private key picker', () => {
  it('renders a picker button beside the editable private key path', () => {
    const html = renderKeyProfile();

    expect(html).toContain('value="/existing/id_ed25519"');
    expect(html).toContain('type="button"');
    expect(html).toContain('选择私钥');
  });

  it('uses the selected path and preserves the current path on cancel', () => {
    expect(privateKeyPathFromSelection('/existing/id_ed25519', '/chosen/id_rsa')).toBe('/chosen/id_rsa');
    expect(privateKeyPathFromSelection('/existing/id_ed25519', '')).toBe('/existing/id_ed25519');
  });
});
