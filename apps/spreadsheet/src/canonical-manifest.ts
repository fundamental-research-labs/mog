/**
 * Spreadsheet App — Canonical Platform Manifest
 *
 * This is the canonical-format manifest for the spreadsheet app, migrated
 * from the original `manifest.ts` (which uses the legacy
 * AppManifestWithCapabilities shape from @mog-sdk/contracts).
 *
 * The canonical format is product-neutral: it uses the same AppManifest
 * interface as any other Mog app (e.g., Task Tracker). The spreadsheet's
 * extra power comes from requesting richer capabilities, not from a
 * different manifest shape.
 */

import type { AppId, AppManifest } from '@mog/shell/platform';

export const SPREADSHEET_CANONICAL_MANIFEST: AppManifest = {
  id: 'spreadsheet' as AppId,
  name: 'Spreadsheet',
  version: '1.0.0',
  description: 'Full spreadsheet app with XLSX compatibility',
  author: 'Mog',
  icon: 'spreadsheet',
  entry: { module: '@mog/app-spreadsheet', export: 'default' },
  kind: 'document-app',
  compatibility: [{ profile: 'mog.app-platform/v1', versionRange: '>=0.1.0' }],
  capabilities: ['spreadsheet:full', 'services:basic', 'checkpoints:create', 'checkpoints:restore'],
  routes: [
    { path: '/workbook/:id', label: 'Workbook' },
    { path: '/workbook/:id/sheet/:sheetId', label: 'Sheet' },
  ],
  data: { resourceKinds: ['mog.resource.workbook'] },
  contributions: [
    {
      contributionPointId: 'mog.file-handlers',
      kind: 'file-handler',
      id: 'spreadsheet-xlsx',
      label: 'XLSX Workbook (.xlsx)',
    },
    {
      contributionPointId: 'mog.file-handlers',
      kind: 'file-handler',
      id: 'spreadsheet-xls',
      label: 'XLS Workbook (.xls)',
    },
    {
      contributionPointId: 'mog.file-handlers',
      kind: 'file-handler',
      id: 'spreadsheet-csv',
      label: 'CSV (.csv)',
    },
    {
      contributionPointId: 'mog.navigation',
      kind: 'navigation',
      id: 'spreadsheet-nav',
      label: 'Spreadsheet',
      icon: 'grid',
    },
  ],
  lifecycle: { suspendable: true },
  runtimeHost: 'same-realm-first-party',
};
