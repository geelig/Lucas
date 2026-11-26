import * as App from '../wailsjs/go/main/App';
import { EventsOn } from '../wailsjs/runtime/runtime';
import type { FileEntry, Group, Profile, PromptRequest, Session, Snapshot, Transfer } from './types';

type RecordValue = Record<string, any>;
const object = (value: unknown): RecordValue => (value && typeof value === 'object' ? value as RecordValue : {});
const text = (value: unknown, fallback = '') => value == null ? fallback : String(value);
const number = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const list = <T>(value: unknown, map: (item: unknown) => T): T[] => Array.isArray(value) ? value.map(map) : [];

export function normalizeProfile(value: unknown): Profile {
  const raw = object(value);
  const authValue = text(raw.auth || raw.authType, 'password');
  const auth = authValue === 'publicKey' ? 'key' : authValue === 'keyboard-interactive' ? 'interactive' : authValue;
  return {
    id: text(raw.id), name: text(raw.name, 'Untitled'), protocol: text(raw.protocol, 'ssh') as Profile['protocol'],
    host: text(raw.host), port: number(raw.port, 22), username: text(raw.username || raw.user),
    auth: auth as Profile['auth'], privateKeyPath: text(raw.privateKeyPath || raw.keyPath),
    jumpProfileId: text(raw.jumpProfileId), serialPort: text(raw.serialPort || raw.portName),
    baudRate: number(raw.baudRate || raw.baud, 9600), dataBits: number(raw.dataBits, 8),
    stopBits: number(raw.stopBits, 1), parity: text(raw.parity, 'none') as Profile['parity'],
    flowControl: text(raw.flowControl, 'none') as Profile['flowControl'], groupId: text(raw.groupId),
    description: text(raw.description), color: text(raw.color), order: number(raw.order),
    os: text(raw.os),
    shell: text(raw.shell), directory: text(raw.directory),
    createdAt: text(raw.createdAt), updatedAt: text(raw.updatedAt),
  };
}

export function normalizeGroup(value: unknown): Group {
  const raw = object(value);
  return { id: text(raw.id), name: text(raw.name, 'Group'), parentId: text(raw.parentId), order: number(raw.order) };
}

export function normalizeSession(value: unknown, profile?: Profile): Session {
  const raw = typeof value === 'string' ? { id: value } : object(value);
  const state = text(raw.state || raw.status, 'connecting') as Session['state'];
  return {
    id: text(raw.id || raw.sessionId), profileId: text(raw.profileId || raw.profileID, profile?.id),
    name: text(raw.name, profile?.name || 'Session'), protocol: text(raw.protocol, profile?.protocol || 'local') as Session['protocol'],
    state, message: text(raw.message), recording: Boolean(raw.recording), cwd: text(raw.cwd),
    exitCode: raw.exitCode == null ? undefined : number(raw.exitCode),
    address: text(raw.address), openedAt: text(raw.openedAt), os: text(raw.os), supportsFiles: Boolean(raw.supportsFiles),
  };
}

function normalizeSnapshot(value: unknown): Snapshot {
  const raw = object(value);
  const groupOrder = list(raw.groupOrder, (item) => text(item));
  return {
    profiles: list(raw.profiles, normalizeProfile),
    groups: list(raw.groups, normalizeGroup).map((group) => {
      const index = groupOrder.indexOf(group.id);
      return index >= 0 ? { ...group, order: index } : group;
    }),
    groupOrder,
    sessions: list(raw.sessions, (item) => normalizeSession(item)),
  };
}

function normalizeFile(value: unknown): FileEntry {
  const raw = object(value);
  return {
    name: text(raw.name), path: text(raw.path, text(raw.name)), isDir: Boolean(raw.isDir),
    size: number(raw.size), modified: text(raw.modified || raw.modTime), permissions: text(raw.permissions),
    symlink: Boolean(raw.symlink), owner: text(raw.owner), group: text(raw.group),
  };
}

export function normalizeTransfer(value: unknown): Transfer {
  const raw = object(value);
  const finished = raw.finished === true || raw.state === 'done';
  const state = raw.error ? 'error' : raw.state === 'cancelled' ? 'cancelled' : finished ? 'done' : 'running';
  return {
    id: text(raw.id), sessionId: text(raw.sessionId), name: text(raw.name || raw.path || raw.remote || raw.local),
    direction: text(raw.direction) as Transfer['direction'], transferred: number(raw.done ?? raw.transferred),
    total: number(raw.total), state, error: text(raw.error),
  };
}

export const backend = {
  isDesktop: () => Boolean((globalThis as any).go?.main?.App),
  async listState() { return normalizeSnapshot(await App.ListState()); },
  saveProfile: (profile: Profile) => App.SaveProfile(profile as any),
  deleteProfile: (id: string) => App.DeleteProfile(id),
  duplicateProfile: (id: string) => App.DuplicateProfile(id),
  saveGroup: (group: Group) => App.SaveGroup(group as any),
  deleteGroup: (id: string) => App.DeleteGroup(id),
  setGroupOrder: (ids: string[]) => App.SetGroupOrder(ids),
  async openSession(profile: Profile, cols = 100, rows = 30) {
    return normalizeSession(await App.OpenSession(profile.id, cols, rows), profile);
  },
  async openAdHoc(profile: Profile, save: boolean, cols = 100, rows = 30) {
    return normalizeSession(await App.OpenAdHoc(profile as any, save, cols, rows), profile);
  },
  async detectProfileOperatingSystem(profile: Profile) {
    return normalizeSession(await App.DetectProfileOperatingSystem(profile.id), profile);
  },
  write: (id: string, data: string) => App.Write(id, data),
  writeBinary: (id: string, data: string) => App.WriteBinary(id, data),
  saveBinaryFile: (name: string, data: string) => App.SaveBinaryFile(name, data),
  getOutput: (id: string) => App.GetOutput(id),
  getOutputState: (id: string) => App.GetOutputState(id),
  saveTextFile: (name: string, content: string) => App.SaveTextFile(name, content),
  resize: (id: string, cols: number, rows: number) => App.Resize(id, cols, rows),
  closeSession: (id: string) => App.CloseSession(id),
  async listFiles(id: string, path: string) {
    const result = await App.ListFiles(id, path);
    const raw = object(result);
    return { entries: list(Array.isArray(result) ? result : raw.entries, normalizeFile), path: text(raw.path, path) };
  },
  upload: (id: string, local: string, remote: string) => App.Upload(id, local, remote),
  download: (id: string, remote: string, local: string) => App.Download(id, remote, local),
  mkdir: (id: string, path: string) => App.Mkdir(id, path),
  renameFile: (id: string, oldPath: string, newPath: string) => App.RenameFile(id, oldPath, newPath),
  deleteFile: (id: string, path: string) => App.DeleteFile(id, path),
  cancelTransfer: (id: string) => App.CancelTransfer(id),
  setRecording: (id: string, enabled: boolean) => App.SetRecording(id, enabled),
  answerPrompt: (id: string, answer: string) => App.AnswerPrompt(id, answer),
  async exportData() {
    const data = await App.ExportData();
    return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  },
  importData: (data: string) => App.ImportData(data),
  exportDataTo: (path: string) => App.ExportDataTo(path),
  exportDocumentTo: (path: string, document: string) => App.ExportDocumentTo(path, document),
  pickSavePath: (name: string) => App.PickSavePath(name),
  pickFile: (title: string) => App.PickFile(title),
  clearCredentials: (id: string) => App.ClearCredentials(id),
  configDirectory: () => App.ConfigDirectory(),
  openConfigDirectory: () => App.OpenConfigDirectory(),
  setConfigDirectory: (path: string) => App.SetConfigDirectory(path),
  pickFolder: (title: string) => App.PickFolder(title),
  revealInFinder: (path: string) => App.RevealInFinder(path),
  getSessionMetrics: (id: string) => App.GetSessionMetrics(id),
  terminateProcess: (id: string, pid: number) => App.TerminateProcess(id, pid),
};

function eventData(args: unknown[]): RecordValue {
  if (args.length > 1) return { id: args[0], data: args[1] };
  return object(args[0]);
}

export function onTerminalData(callback: (id: string, base64: string, sequence: number) => void) {
  return EventsOn('lucas:data', (...args: unknown[]) => {
    const raw = eventData(args);
    callback(text(raw.id || raw.sessionId), text(raw.data), number(raw.sequence));
  });
}

export function onSessionState(callback: (session: Session) => void) {
  return EventsOn('lucas:state', (...args: unknown[]) => {
    const raw = args.length > 1 ? { id: args[0], state: args[1], message: args[2] } : args[0];
    callback(normalizeSession(raw));
  });
}

export function onTransfer(callback: (transfer: Transfer) => void) {
  return EventsOn('lucas:transfer', (value: unknown) => callback(normalizeTransfer(value)));
}

export function onPrompt(callback: (prompt: PromptRequest) => void) {
  return EventsOn('lucas:prompt', (...args: unknown[]) => {
    const raw = args.length > 1 ? { id: args[0], message: args[1], kind: args[2] } : object(args[0]);
    callback({
      id: text(raw.id), sessionId: text(raw.sessionId), title: text(raw.title),
      message: text(raw.message || raw.prompt), kind: text(raw.kind || raw.type, raw.echo === false ? 'password' : 'text') as PromptRequest['kind'],
      fingerprint: text(raw.fingerprint), changed: Boolean(raw.changed),
    });
  });
}

export function onCwd(callback: (id: string, cwd: string) => void) {
  return EventsOn('lucas:cwd', (...args: unknown[]) => {
    const raw = args.length > 1 ? { id: args[0], cwd: args[1] } : object(args[0]);
    callback(text(raw.id), text(raw.cwd));
  });
}
