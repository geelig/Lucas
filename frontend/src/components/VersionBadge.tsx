import { appVersion } from '../version';
import { BrowserOpenURL } from '../../wailsjs/runtime/runtime';

export function VersionBadge() {
  return <button type="button" className="app-version" title="打开 Lucas GitHub 仓库" aria-label="打开 Lucas GitHub 仓库" onClick={() => void BrowserOpenURL('https://github.com/geelig/Lucas')}>Lucas v{appVersion}</button>;
}
