import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FileEntry, Session } from '../types';
import { FilePanel, fileTypeLabel, formatFileSize, formatFileTime } from './FilePanel';

const session: Session = { id: 'local', profileId: 'p', name: 'Local', protocol: 'local', state: 'connected' };

describe('Finder-like file table', () => {
  it('renders all requested columns in the reference order', () => {
    const html = renderToStaticMarkup(<FilePanel session={session} transfers={[]} dock="left" followCwd onToggleFollowCwd={() => undefined} onClose={() => undefined} notify={() => undefined} />);
    for (const label of ['名称', '修改时间', '类型', '大小', '权限', '所有者', '分组']) expect(html).toContain(label);
    expect(html.indexOf('名称')).toBeLessThan(html.indexOf('修改时间'));
    expect(html.indexOf('修改时间')).toBeLessThan(html.indexOf('类型'));
    expect(html.indexOf('类型')).toBeLessThan(html.indexOf('大小'));
    expect(html).not.toContain('<span>跟随目录</span>');
  });

  it('formats full timestamps, zero sizes and common file types', () => {
    expect(formatFileTime('2026-11-24T03:08:04Z')).toMatch(/^2026\/11\/24 \d{2}:\d{2}:04$/);
    expect(formatFileSize(0)).toBe('0 Bytes');
    expect(fileTypeLabel({ name: 'master.zip', path: '', size: 1, isDir: false } as FileEntry)).toBe('Zip 归档文件');
    expect(fileTypeLabel({ name: 'restart.sh', path: '', size: 1, isDir: false } as FileEntry)).toBe('Shell 脚本');
    expect(fileTypeLabel({ name: 'projects', path: '', size: 0, isDir: true } as FileEntry)).toBe('目录');
  });
});
