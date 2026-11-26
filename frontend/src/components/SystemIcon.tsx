import type { CSSProperties } from 'react';
import { Cable, Folder, Network, Terminal } from 'lucide-react';
import {
  siAlmalinux,
  siAlpinelinux,
  siAndroid,
  siApple,
  siArchlinux,
  siCentos,
  siDebian,
  siDeepin,
  siElementary,
  siFedora,
  siFreebsd,
  siGentoo,
  siKalilinux,
  siLinux,
  siLinuxmint,
  siManjaro,
  siNixos,
  siOpensuse,
  siPopos,
  siRaspberrypi,
  siRedhat,
  siRockylinux,
  siSolus,
  siSuse,
  siUbuntu,
  siVoidlinux,
  siZorin,
  type SimpleIcon,
} from 'simple-icons';
import type { Protocol } from '../types';

export interface SystemIconProps {
  os?: string;
  protocol: Protocol;
  size?: number;
}

type BrandIcon = Pick<SimpleIcon, 'title' | 'path' | 'hex'>;
type OperatingSystemIcon = {
  pattern: RegExp;
  icon: BrandIcon;
  label: string;
  color?: string;
};

// simple-icons 16 no longer ships the Windows mark; keep a local, dependency-free glyph.
const windowsIcon: BrandIcon = {
  title: 'Windows',
  hex: '0078D4',
  path: 'M0 3.449 9.75 2.1v9.451H0V3.449Zm10.949-1.55L24 0v11.551H10.949V1.9ZM0 12.6h9.75v9.451L0 20.699V12.6Zm10.949 0H24V24l-13.051-1.801V12.6Z',
};

const accessibleColors: Record<string, string> = {
  // The stock CentOS blue is almost invisible on a dark terminal background.
  CentOS: '#8fa8ff',
};

const operatingSystems: OperatingSystemIcon[] = [
  { pattern: /windows|\bwin(?:32|64)?\b/, icon: windowsIcon, label: 'Windows' },
  { pattern: /mac[\s._-]*os|macintosh|os[\s._-]*x|darwin|apple/, icon: siApple, label: 'macOS', color: 'currentColor' },
  { pattern: /ubuntu/, icon: siUbuntu, label: 'Ubuntu' },
  { pattern: /debian/, icon: siDebian, label: 'Debian' },
  { pattern: /fedora/, icon: siFedora, label: 'Fedora' },
  { pattern: /arch[\s._-]*linux|\barch\b/, icon: siArchlinux, label: 'Arch Linux' },
  { pattern: /cent[\s._-]*os/, icon: siCentos, label: 'CentOS' },
  { pattern: /red[\s._-]*hat|\brhel\b/, icon: siRedhat, label: 'Red Hat' },
  { pattern: /rocky/, icon: siRockylinux, label: 'Rocky Linux' },
  { pattern: /alma/, icon: siAlmalinux, label: 'AlmaLinux' },
  { pattern: /alpine/, icon: siAlpinelinux, label: 'Alpine Linux' },
  { pattern: /open[\s._-]*suse/, icon: siOpensuse, label: 'openSUSE' },
  { pattern: /\bsuse\b|\bsles\b/, icon: siSuse, label: 'SUSE' },
  { pattern: /linux[\s._-]*mint|\bmint\b/, icon: siLinuxmint, label: 'Linux Mint' },
  { pattern: /manjaro/, icon: siManjaro, label: 'Manjaro' },
  { pattern: /pop!?[\s._-]*os/, icon: siPopos, label: 'Pop!_OS' },
  { pattern: /kali/, icon: siKalilinux, label: 'Kali Linux' },
  { pattern: /free[\s._-]*bsd/, icon: siFreebsd, label: 'FreeBSD' },
  { pattern: /android/, icon: siAndroid, label: 'Android' },
  { pattern: /deepin/, icon: siDeepin, label: 'Deepin' },
  { pattern: /elementary/, icon: siElementary, label: 'elementary OS' },
  { pattern: /gentoo/, icon: siGentoo, label: 'Gentoo' },
  { pattern: /nix[\s._-]*os/, icon: siNixos, label: 'NixOS' },
  { pattern: /rasp(?:berry|bian)/, icon: siRaspberrypi, label: 'Raspberry Pi' },
  { pattern: /zorin/, icon: siZorin, label: 'Zorin OS' },
  { pattern: /solus/, icon: siSolus, label: 'Solus' },
  { pattern: /void[\s._-]*linux/, icon: siVoidlinux, label: 'Void Linux' },
  { pattern: /linux|unix|\bamzn\b/, icon: siLinux, label: 'Linux' },
];

const fallbackIcons = {
  local: { Icon: Terminal, label: '本地终端' },
  ssh: { Icon: Network, label: 'SSH 会话' },
  telnet: { Icon: Network, label: 'Telnet 会话' },
  serial: { Icon: Cable, label: '串口会话' },
  ftp: { Icon: Folder, label: 'FTP 会话' },
} satisfies Record<Protocol, { Icon: typeof Terminal; label: string }>;

export function SystemIcon({ os, protocol, size = 20 }: SystemIconProps) {
  const normalizedOS = os?.trim().toLowerCase() || '';
  const match = operatingSystems.find(({ pattern }) => pattern.test(normalizedOS));
  const color = match?.color || (match ? accessibleColors[match.label] || `#${match.icon.hex}` : 'currentColor');
  const style = { '--system-icon-color': color } as CSSProperties;

  if (!match) {
    const { Icon, label } = fallbackIcons[protocol];
    return (
      <span
        className={`system-icon system-icon-${protocol}`}
        style={style}
        role="img"
        aria-label={label}
        title={label}
        data-system="unknown"
      >
        <Icon size={size} strokeWidth={1.8} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      className={`system-icon system-icon-${protocol}`}
      style={style}
      role="img"
      aria-label={`${match.label} 系统`}
      title={match.label}
      data-system={match.label.toLowerCase().replaceAll(' ', '-')}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={match.icon.path} />
      </svg>
    </span>
  );
}

export default SystemIcon;
