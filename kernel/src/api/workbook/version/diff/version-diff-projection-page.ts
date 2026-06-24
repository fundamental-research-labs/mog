import type { WorkbookDiffPage } from '@mog-sdk/contracts/api';
import { VERSION_DIFF_PAGE_ORDER } from '@mog-sdk/contracts/versioning';
import {
  degradedDiffPage,
  mapGraphDiagnostics,
  providerErrorDiagnostic,
  publicDiagnostic,
} from './version-diff-diagnostics';
import { isRecord, toPageToken, toRevision } from './version-diff-utils';
import { mapDiffEntries } from './version-diff-projection-entries';

export function mapDiffPageResult(value: unknown): WorkbookDiffPage {
  if (!isRecord(value)) {
    return degradedDiffPage([providerErrorDiagnostic()]);
  }
  if (value.status === 'failed' || value.status === 'degraded') {
    return degradedDiffPage(mapGraphDiagnostics(value.diagnostics));
  }
  if (value.status !== 'success') {
    return degradedDiffPage([providerErrorDiagnostic()]);
  }

  const readRevision = toRevision(value.readRevision);
  const sourceItems = Array.isArray(value.items)
    ? value.items
    : Array.isArray(value.entries)
      ? value.entries
      : Array.isArray(value.changes)
        ? value.changes
        : null;
  if (!readRevision || !sourceItems) {
    return degradedDiffPage([
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'The version diff service did not return a valid public diff page.',
        {
          severity: 'error',
          recoverability: 'repair',
        },
      ),
    ]);
  }

  const { items, diagnostics } = mapDiffEntries(sourceItems);
  const resultDiagnostics = [...diagnostics];
  if (value.order !== VERSION_DIFF_PAGE_ORDER) {
    resultDiagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'The version diff service returned an unsupported diff order.',
        {
          severity: 'error',
          recoverability: 'repair',
        },
      ),
    );
  }

  const nextPageToken =
    value.nextPageToken === undefined ? undefined : toPageToken(value.nextPageToken);
  if (value.nextPageToken !== undefined && !nextPageToken) {
    resultDiagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'The version diff service returned an invalid public page token.',
        {
          severity: 'error',
          recoverability: 'repair',
        },
      ),
    );
  }
  if (Array.isArray(value.diagnostics) && value.diagnostics.length > 0) {
    resultDiagnostics.push(...mapGraphDiagnostics(value.diagnostics));
  }
  if (resultDiagnostics.length > 0) {
    return degradedDiffPage(resultDiagnostics, items, readRevision);
  }

  return {
    status: 'success',
    items,
    ...(nextPageToken ? { nextPageToken } : {}),
    readRevision,
    order: VERSION_DIFF_PAGE_ORDER,
    diagnostics: [],
  };
}
