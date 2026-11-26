export const DEFAULT_HIGH_RISK_RULES = [
  'rm', 'mv', 'dd', 'mkfs', 'fdisk', 'shutdown', 'reboot', 'halt', 'poweroff',
  'kill -9', 'pkill -9', 'killall -9', 'chmod -R /', 'chown -R /',
].join('\n');

export function findHighRiskCommand(input: string, rules = DEFAULT_HIGH_RISK_RULES): string | undefined {
  const patterns = rules.split('\n').map((rule) => rule.trim().replace(/\s+/g, ' ').toLowerCase()).filter((rule) => rule && !rule.startsWith('#'));
  for (const part of input.split(/\r\n|\r|\n|&&|\|\||;/)) {
    const command = part.trim().replace(/^(?:(?:sudo|command|builtin)\s+)+/, '').replace(/\s+/g, ' ').toLowerCase();
    if (patterns.some((rule) => command === rule || command.startsWith(`${rule} `))) return part.trim();
  }
  return undefined;
}

export function isMultiLinePaste(input: string): boolean {
  return input.length > 1 && /[\r\n]/.test(input) && input.trim().length > 0;
}
