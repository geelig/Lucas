export type Protocol = 'local' | 'ssh' | 'telnet' | 'serial' | 'ftp';
export type SessionState = 'connecting' | 'connected' | 'disconnected' | 'error' | 'closed';
export type ThemeName = 'midnight' | 'graphite' | 'daylight';

export interface Profile {
  id: string;
  name: string;
  protocol: Protocol;
  host: string;
  port: number;
  username: string;
  password?: string;
  auth?: 'password' | 'key' | 'agent' | 'interactive';
  privateKeyPath?: string;
  passphrase?: string;
  jumpProfileId?: string;
  serialPort?: string;
  baudRate?: number;
  dataBits?: number;
  stopBits?: number;
  parity?: 'none' | 'odd' | 'even';
  flowControl?: 'none' | 'hardware' | 'software';
  groupId?: string;
  description?: string;
  color?: string;
  os?: string;
  shell?: string;
  directory?: string;
  order?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Group {
  id: string;
  name: string;
  parentId?: string;
  order: number;
}

export interface Session {
  id: string;
  profileId: string;
  name: string;
  protocol: Protocol;
  state: SessionState;
  message?: string;
  recording?: boolean;
  cwd?: string;
  exitCode?: number;
  address?: string;
  openedAt?: string;
  os?: string;
  supportsFiles?: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  symlink?: boolean;
  size: number;
  modified?: string;
  permissions?: string;
  owner?: string;
  group?: string;
}

export interface Transfer {
  id: string;
  sessionId?: string;
  name: string;
  direction?: 'upload' | 'download';
  transferred: number;
  total: number;
  state: 'running' | 'done' | 'error' | 'cancelled';
  error?: string;
}

export interface Snapshot {
  profiles: Profile[];
  groups: Group[];
  groupOrder?: string[];
  sessions: Session[];
}

export interface WorkTab {
  id: string;
  sessionIds: string[];
  activeSessionId: string;
  split: 'horizontal' | 'vertical';
}

export interface Preferences {
  theme: ThemeName;
  fontFamily: string;
  fontSize: number;
  filePanelDock: 'left' | 'right' | 'bottom';
  sessionDock: 'left' | 'right';
  filePanelOpen: boolean;
  sidebarOpen: boolean;
  showTimestamps: boolean;
  terminalPalette: 'lucas' | 'windterm';
  resourcePanelOpen: boolean;
  collapseGroups: boolean;
  followCwd: boolean;
  systemIcons: boolean;
  rememberPasswords: boolean;
  zmodemEnabled: boolean;
  selectCopy: boolean;
  rightClickPaste: boolean;
  exportAskPath: boolean;
  highContrastFiles: boolean;
  pasteWarning: boolean;
  commandGuard: boolean;
  commandRules: string;
  commandPanelOpen: boolean;
  commandPanelTab: 'saved' | 'history';
  historyPanelEnabled: boolean;
  resourceDock: 'left' | 'right';
  historyDock: 'left' | 'right';
  defaultShell: string;
  defaultDirectory: string;
  defaultSSHPort: number;
  defaultUsername: string;
  paletteVersion: number;
  panelLayoutVersion: number;
  sidebarWidth: number;
  fileWidth: number;
  resourceWidth: number;
  fileBottomHeight: number;
  resourceMetrics: boolean;
  metricsInterval: number;
  semanticColors: boolean;
}

export interface SavedCommand {
  id: string;
  name: string;
  command: string;
}

export interface HostKeyRequest {
  sessionId: string;
  host: string;
  fingerprint: string;
  changed?: boolean;
}

export interface PromptRequest {
  id: string;
  sessionId?: string;
  title?: string;
  message: string;
  kind?: 'text' | 'password' | 'confirm' | 'hostkey';
  fingerprint?: string;
  changed?: boolean;
}
