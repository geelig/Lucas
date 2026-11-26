import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionActivationTracker } from './sessionActivation';
import { Sidebar } from './components/Sidebar';
import { Welcome } from './components/Welcome';
import type { Profile } from './types';

const profile: Profile = { id: 'p1', name: 'Server', protocol: 'ssh', host: 'example.test', port: 22, username: 'root' };
const sidebarProps = {
  profiles: [profile], groups: [], sessions: [],
  onOpen: () => undefined, onNew: () => undefined, onEdit: () => undefined,
  onDuplicate: () => undefined, onDelete: () => undefined, onMoveProfile: () => undefined,
  onGroupNew: () => undefined, onGroupEdit: () => undefined, onGroupDelete: () => undefined,
  onGroupMove: () => undefined, collapseGroups: true, systemIcons: false,
  onDetectGroupOS: () => undefined, detectingGroup: false,
};

describe('reliable session activation', () => {
  it('selects on one click and opens only on a second click within 400 ms', () => {
    const tracker = new SessionActivationTracker();
    expect(tracker.click('p1', 1000)).toBe('select');
    expect(tracker.click('p1', 1399)).toBe('open');
    expect(tracker.click('p1', 1400)).toBe('select');
  });

  it('does not open after the click window expires', () => {
    const tracker = new SessionActivationTracker();
    expect(tracker.click('p1', 1000)).toBe('select');
    expect(tracker.click('p1', 1401)).toBe('select');
  });

  it('never combines clicks from different profiles', () => {
    const tracker = new SessionActivationTracker();
    expect(tracker.click('p1', 1000)).toBe('select');
    expect(tracker.click('p2', 1100)).toBe('select');
    expect(tracker.click('p2', 1200)).toBe('open');
  });

  it('clears a pending click when dragging begins', () => {
    const tracker = new SessionActivationTracker();
    expect(tracker.click('p1', 1000)).toBe('select');
    tracker.reset();
    expect(tracker.click('p1', 1100)).toBe('select');
  });

  it('supports explicit keyboard activation without changing click state', () => {
    const tracker = new SessionActivationTracker();
    expect(tracker.click('p1', 1000)).toBe('select');
    expect(tracker.openByKeyboard()).toBe('open');
    expect(tracker.click('p1', 1100)).toBe('open');
  });

  it('renders no native double-click handlers and allows Enter to open', () => {
    const sidebar = renderToStaticMarkup(createElement(Sidebar, sidebarProps));
    const welcome = renderToStaticMarkup(createElement(Welcome, { profiles: [profile], onNew: () => undefined, onOpen: () => undefined }));
    expect(sidebar).not.toContain('onDoubleClick');
    expect(welcome).not.toContain('onDoubleClick');
    expect(sidebar).toContain('按 Enter 连接');
    expect(welcome).toContain('按 Enter 连接');
  });

  it('makes only the session system icon a drag source', () => {
    const html = renderToStaticMarkup(createElement(Sidebar, sidebarProps));
    expect(html).toContain('class="protocol-gem profile-system-drag" draggable="true"');
    expect(html).not.toContain('class="profile-row" draggable="true"');
  });
});
