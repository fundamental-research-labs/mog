import type { VersionMergeConflict, Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { mergeResultIdForPreviewDigest } from '../../../document/version-store/merge-attempt-artifacts';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';
import {
  documentScopeForGraph,
  expectInitializeSuccess,
  initializeInput,
  objectRecord,
} from './version-merge-review-endpoints-helpers-context';
import { conflictDigestObject } from './version-merge-review-endpoints-helpers-conflicts';
import type {
  ConflictDetailSuccess,
  PersistedConflictPreview,
} from './version-merge-review-endpoints-helpers-types';
import { withVersionManifest } from './version-domain-support-test-utils';

export async function readSyntheticConflictDetail(
  graphId: string,
  conflict: VersionMergeConflict,
): Promise<ConflictDetailSuccess> {
  let detail: ConflictDetailSuccess | undefined;
  await withSyntheticConflictPreview(graphId, conflict, async ({ sourceWb, preview }) => {
    const previewConflict = preview.conflicts[0];
    const result = await sourceWb.version.getMergeConflictDetail({
      resultId: preview.resultId,
      resultDigest: preview.resultDigest,
      redactionPolicyDigest: preview.resultDigest,
      conflictId: previewConflict.conflictId,
      expectedConflictDigest: conflictDigestObject(previewConflict.conflictDigest),
      valueRole: 'ours',
      purpose: 'review',
    });
    if (!result.ok) throw new Error(`expected synthetic conflict detail: ${result.error.code}`);
    detail = result;
  });
  if (!detail) throw new Error('expected synthetic conflict detail callback to run');
  return detail;
}

export async function withSyntheticConflictPreview(
  graphId: string,
  conflict: VersionMergeConflict,
  run: (fixture: {
    readonly sourceWb: Workbook;
    readonly preview: PersistedConflictPreview;
  }) => Promise<void>,
): Promise<void> {
  const documentScope = documentScopeForGraph(graphId);
  const provider = createInMemoryVersionStoreProvider({ documentScope });
  const initialized = await provider.initializeGraph(
    await initializeInput(graphId, 'root', documentScope),
  );
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  const previewRecord = await objectRecord(namespace, 'workbook.mergePreview.v1', {
    schemaVersion: 1,
    recordKind: 'mergePreview',
    status: 'conflicted',
    base: initialized.rootCommit.id,
    ours: initialized.rootCommit.id,
    theirs: initialized.rootCommit.id,
    changes: [],
    conflicts: [conflict],
  });
  const graph = await provider.openGraph(namespace, provider.accessContext);
  const put = await graph.putObjects([previewRecord]);
  expect(put).toMatchObject({ status: 'success' });

  const sourceHandle = await DocumentFactory.create({
    documentId: documentScope.documentId,
    environment: 'headless',
    userTimezone: 'UTC',
  });
  let sourceWb: Workbook | undefined;
  try {
    sourceWb = await sourceHandle.workbook({
      versioning: withVersionManifest({ provider }),
    });
    await run({
      sourceWb,
      preview: {
        status: 'conflicted',
        base: initialized.rootCommit.id,
        ours: initialized.rootCommit.id,
        theirs: initialized.rootCommit.id,
        changes: [],
        conflicts: [conflict],
        diagnostics: [],
        mutationGuarantee: 'preview-only',
        resultId: mergeResultIdForPreviewDigest(previewRecord.digest),
        resultDigest: previewRecord.digest,
      },
    });
  } finally {
    if (sourceWb) await sourceWb.close('skipSave');
    await sourceHandle.dispose();
  }
}
