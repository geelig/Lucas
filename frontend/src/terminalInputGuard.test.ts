import { describe, expect, it } from 'vitest';
import { findHighRiskCommand, isMultiLinePaste } from './terminalInputGuard';

describe('terminal input safety', () => {
  it('blocks dangerous commands, including chained and sudo forms', () => {
    expect(findHighRiskCommand('rm -rf /tmp/example')).toContain('rm');
    expect(findHighRiskCommand('cd / && sudo mv a b')).toContain('mv');
    expect(findHighRiskCommand('echo rm && ls')).toBeUndefined();
  });

  it('distinguishes Enter from a multiline paste', () => {
    expect(isMultiLinePaste('\r')).toBe(false);
    expect(isMultiLinePaste('printf one\nprintf two\n')).toBe(true);
  });

  it('includes destructive defaults and supports editable command prefixes', () => {
    expect(findHighRiskCommand('sudo fdisk /dev/sda')).toContain('fdisk');
    expect(findHighRiskCommand('kill -9 123')).toContain('kill -9');
    const custom = 'docker rm\nsystemctl stop\n# a comment\n';
    expect(findHighRiskCommand('sudo docker rm container', custom)).toContain('docker rm');
    expect(findHighRiskCommand('ls && systemctl stop nginx', custom)).toContain('systemctl stop');
    expect(findHighRiskCommand('echo docker rm', custom)).toBeUndefined();
    expect(findHighRiskCommand('docker rm container')).toBeUndefined();
  });

  it('allows the rule list to be emptied without blocking everything', () => {
    expect(findHighRiskCommand('rm -rf /tmp/example', '')).toBeUndefined();
  });
});
