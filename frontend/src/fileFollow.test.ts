import { describe, expect, it } from 'vitest';
import { shouldFollowDirectory } from './fileFollow';

describe('file directory following', () => {
  it('loads the current directory immediately when enabled', () => {
    expect(shouldFollowDirectory({ sessionId: 'a', cwd: '/tmp', followCwd: false }, { sessionId: 'a', cwd: '/tmp', followCwd: true })).toBe(true);
  });
  it('follows later directory changes but not session switches or repeated state', () => {
    expect(shouldFollowDirectory({ sessionId: 'a', cwd: '/tmp', followCwd: true }, { sessionId: 'a', cwd: '/var', followCwd: true })).toBe(true);
    expect(shouldFollowDirectory({ sessionId: 'a', cwd: '/tmp', followCwd: true }, { sessionId: 'b', cwd: '/tmp', followCwd: true })).toBe(false);
    expect(shouldFollowDirectory({ sessionId: 'a', cwd: '/tmp', followCwd: true }, { sessionId: 'a', cwd: '/tmp', followCwd: true })).toBe(false);
  });
});
