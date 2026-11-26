import { appVersion } from '../version';

export function VersionBadge() {
  return <span className="app-version" title="当前 Lucas 版本">Lucas v{appVersion}</span>;
}
