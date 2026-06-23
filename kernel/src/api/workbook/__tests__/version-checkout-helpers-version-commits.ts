import type { CreateWorkbookCommitResult } from '../../../document/version-store/commit-store';
import { AUTHOR, NAMESPACE } from './version-checkout-helpers-version-constants';
import { objectRecord } from './version-checkout-helpers-version-objects';
import type { Stores } from './version-checkout-helpers-version-stores';

function expectCreateSuccess(
  result: CreateWorkbookCommitResult,
): asserts result is Extract<CreateWorkbookCommitResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected commit create success: ${result.diagnostics[0]?.code}`);
  }
}

export async function createCommit(stores: Stores, label: string) {
  const snapshotRootRecord = await objectRecord(stores, 'workbook.snapshotRoot.v1', {
    label,
    sheets: [],
  });
  const semanticChangeSetRecord = await objectRecord(stores, 'workbook.semanticChangeSet.v1', {
    label,
    changes: [],
  });
  const created = await stores.commitStore.createWorkbookCommit({
    documentId: NAMESPACE.documentId,
    parentCommitIds: [],
    snapshotRootRecord,
    semanticChangeSetRecord,
    mutationSegmentRecords: [],
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  });
  expectCreateSuccess(created);
  return created.commit;
}
