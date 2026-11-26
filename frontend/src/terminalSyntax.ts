import { colorForRole, type CustomAppearance } from './appearance';

export interface SyntaxSpan { start: number; end: number; role: keyof CustomAppearance }

const commands = new Set([
  'sudo', 'git', 'docker', 'docker-compose', 'podman', 'kubectl', 'helm', 'systemctl', 'service', 'journalctl',
  'ls', 'll', 'la', 'cd', 'pwd', 'cat', 'less', 'more', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'find',
  'ps', 'top', 'htop', 'free', 'df', 'du', 'mount', 'umount', 'uname', 'whoami', 'id', 'ssh', 'scp', 'sftp',
  'curl', 'wget', 'ping', 'traceroute', 'ip', 'ifconfig', 'netstat', 'ss', 'nc', 'telnet', 'chmod', 'chown',
  'chgrp', 'mkdir', 'touch', 'cp', 'mv', 'rm', 'rmdir', 'ln', 'tar', 'unzip', 'zip', 'gzip', 'gunzip',
  'xz', 'vim', 'vi', 'nano', 'sed', 'awk', 'cut', 'sort', 'uniq', 'wc', 'xargs', 'echo', 'printf',
  'export', 'set', 'unset', 'source', 'bash', 'sh', 'zsh', 'python', 'python3', 'node', 'npm', 'npx',
  'yarn', 'pnpm', 'go', 'java', 'javac', 'mvn', 'gradle', 'make', 'cmake', 'gcc', 'g++', 'cargo',
  'rustc', 'pip', 'pip3', 'ansible', 'dmesg', 'firewall-cmd', 'iptables', 'nft', 'timedatectl',
  'hostnamectl', 'localectl', 'rpm', 'yum', 'dnf', 'apt', 'apt-get', 'dpkg', 'useradd', 'userdel',
  'usermod', 'groupadd', 'passwd', 'crontab', 'kill', 'killall', 'pkill', 'pgrep', 'jobs', 'bg',
  'fg', 'nohup', 'watch', 'history', 'clear', 'exit', 'logout',
]);

const errorPattern = /(?:\bERROR\b|\bFATAL\b|\bFAIL(?:ED|URE)?\b|错误|失败|无法|拒绝|异常|超时)/gi;
const warningPattern = /(?:\bWARN(?:ING)?\b|警告|注意|不建议|过期)/gi;
const successPattern = /(?:\bSUCCESS(?:FUL)?\b|\bOK\b|\bDONE\b|\bREADY\b|成功|完成|已连接|已就绪)/gi;
const infoPattern = /(?:\bINFO\b|\bNOTICE\b|信息|提示)/gi;
const debugPattern = /(?:\bDEBUG\b|\bTRACE\b|调试)/gi;

export function genericSyntaxSpans(text: string): SyntaxSpan[] {
  const spans: SyntaxSpan[] = [];
  const claimed: SyntaxSpan[] = [];
  const add = (start: number, end: number, role: SyntaxSpan['role'], priority = 0) => {
    if (end <= start) return;
    if (claimed.some((span) => start < span.end && end > span.start)) return;
    const span = { start, end, role };
    spans.push(span);
    if (priority >= 0) claimed.push(span);
  };
  const match = (pattern: RegExp, role: SyntaxSpan['role'], group = 0) => {
    for (const found of text.matchAll(pattern)) {
      const value = group ? found[group] : found[0];
      if (!value) continue;
      const offset = group ? found[0].indexOf(value) : 0;
      add((found.index ?? 0) + offset, (found.index ?? 0) + offset + value.length, role);
    }
  };

  // Whole-line conventions used by diff, logs and command output.
  if (/^\s*\+{1}(?!\+)/.test(text)) add(0, text.length, 'success');
  if (/^\s*-{1}(?!-)/.test(text)) add(0, text.length, 'error');
  if (/^\s*@@/.test(text)) add(0, text.length, 'info');
  match(/\bhttps?:\/\/[^\s'"<>]+/g, 'url');
  match(/"[^"\r\n]+"(?=\s*:)/g, 'info');
  match(/'[^'\r\n]+'(?=\s*:)/g, 'info');
  match(/"(?:\\.|[^"\\])*"/g, 'string');
  match(/'(?:\\.|[^'\\])*'/g, 'string');
  match(/(?:\b(?:true|false|null|yes|no|on|off)\b|\b(?:if|then|else|elif|fi|for|while|until|do|done|case|esac|function|return|break|continue)\b)/gi, 'keyword');
  match(errorPattern, 'error');
  match(warningPattern, 'warning');
  match(successPattern, 'success');
  match(infoPattern, 'info');
  match(debugPattern, 'muted');

  const promptEnd = text.match(/[$#]\s+/);
  const commandStart = promptEnd ? (promptEnd.index ?? 0) + promptEnd[0].length
    : text.match(/^(?:\[\d{2}:\d{2}:\d{2}\]\s+)?\s*/)?.[0].length ?? 0;
  const firstWord = text.slice(commandStart).match(/^([A-Za-z0-9_.+/-]+)/);
  if (firstWord) {
    const value = firstWord[1].split('/').pop() || '';
    if (commands.has(value.toLowerCase())) {
      add(commandStart, commandStart + firstWord[1].length, 'command');
    }
  }
  for (const found of text.matchAll(/(?:\||&&|;|\bsudo)\s+([A-Za-z0-9_.+/-]+)/g)) {
    const value = found[1].split('/').pop() || '';
    if (!commands.has(value.toLowerCase())) continue;
    const start = (found.index ?? 0) + found[0].lastIndexOf(found[1]);
    add(start, start + found[1].length, 'command');
  }
  match(/(?<![\w.])(?:--[A-Za-z][\w-]*(?:=[^\s]+)?|-[A-Za-z][A-Za-z0-9-]*)(?![\w.])/g, 'option');
  match(/(?:~|\.{1,2})?\/(?:[\w.@%+:,=-]+\/)*[\w.@%+:,=-]*/g, 'path');
  match(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, 'info');
  match(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g, 'muted');
  match(/\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g, 'muted');
  match(/(?<![\w./+-])\d+(?:\.\d+)?(?:%|[KMGT]?B|[kmgt]b)?(?![\w./:+-])/g, 'number');

  return spans.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function colorizeSyntaxText(text: string): string {
  let output = '';
  let cursor = 0;
  for (const span of genericSyntaxSpans(text)) {
    output += text.slice(cursor, span.start);
    const hex = colorForRole(span.role);
    const rgb = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
    output += `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text.slice(span.start, span.end)}\x1b[0m`;
    cursor = span.end;
  }
  return output + text.slice(cursor);
}
