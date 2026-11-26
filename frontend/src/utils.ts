import type { FileEntry, Profile, Protocol } from './types';

export const protocolInfo: Record<Protocol, { label: string; description: string; color: string }> = {
  local: { label: '本地终端', description: '在这台 Mac 上打开全新 Shell', color: '#52dbc1' },
  ssh: { label: 'SSH', description: '安全远程终端与 SFTP 文件传输', color: '#70a7ff' },
  telnet: { label: 'Telnet', description: '连接交换机、路由器等网络设备', color: '#f5bc6b' },
  serial: { label: '串口', description: '连接 USB、Console 与串口设备', color: '#c4a1ff' },
  ftp: { label: 'FTP', description: '浏览、上传与下载远程文件', color: '#ff8fab' },
};

export function defaultPort(protocol: Protocol) {
  return protocol === 'ssh' ? 22 : protocol === 'telnet' ? 23 : protocol === 'ftp' ? 21 : 0;
}

export function uid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function joinPath(parent: string, name: string) {
  if (!parent || parent === '/') return `/${name}`;
  return `${parent.replace(/\/$/, '')}/${name}`;
}

export function parentPath(path: string) {
  if (!path || path === '/' || path === '~') return path;
  const parts = path.replace(/\/$/, '').split('/');
  parts.pop();
  return parts.length === 1 && parts[0] === '' ? '/' : parts.join('/') || '/';
}

export function formatBytes(value: number) {
  if (!value) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const number = value / 1024 ** index;
  return `${number >= 10 || index === 0 ? number.toFixed(0) : number.toFixed(1)} ${units[index]}`;
}

export function sortFiles(entries: FileEntry[]) {
  return [...entries].sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
}

export function decodeBase64(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function encodeBase64(value: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < value.length; offset += 32768) binary += String.fromCharCode(...value.subarray(offset, offset + 32768));
  return btoa(binary);
}

export function downloadText(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function displayAddress(profile: Profile) {
  if (profile.protocol === 'local') return '这台设备';
  if (profile.protocol === 'serial') return profile.serialPort || '串口设备';
  return `${profile.username ? `${profile.username}@` : ''}${profile.host || '尚未配置'}${profile.port ? `:${profile.port}` : ''}`;
}
