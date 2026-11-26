import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VersionBadge } from './VersionBadge';

describe('application version display', () => {
  it('shows the configured product version', () => {
    const html = renderToStaticMarkup(<VersionBadge />);
    expect(html).toMatch(/Lucas v\d+\.\d+\.\d+/);
  });
});
