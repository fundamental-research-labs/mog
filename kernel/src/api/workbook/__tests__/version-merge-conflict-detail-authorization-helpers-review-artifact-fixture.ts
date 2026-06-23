import type { VersionMergeConflict } from '@mog-sdk/contracts/api';

import { WorkbookVersionImpl } from '../version';
import { mergeResultIdForPreviewDigest } from '../../../document/version-store/merge-attempt-artifacts';
import {
  createInMemoryVersionStoreProvider,
  InMemoryVersionDocumentProviderBackend,
  namespaceForDocumentScope,
  type VersionAccessContext,
} from '../../../document/version-store/provider';
import { withVersionManifest } from './version-domain-support-test-utils';
import { basicConflict } from './version-merge-conflict-detail-authorization-helpers-conflicts';
import {
  documentScopeForGraph,
  expectInitializeSuccess,
  initializeInput,
  objectRecord,
} from './version-merge-conflict-detail-authorization-helpers-review-artifact-graph';
import type { ReviewFixture } from './version-merge-conflict-detail-authorization-helpers-review-artifact-types';

export async function withReviewArtifact(
  graphId: string,
  run: (fixture: ReviewFixture) => Promise<void>,
  options: {
    readonly accessContext?: VersionAccessContext;
    readonly conflicts?: readonly VersionMergeConflict[];
    readonly versioning?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const documentScope = documentScopeForGraph(graphId);
  const provider = createInMemoryVersionStoreProvider({
    documentScope,
    accessContext: options.accessContext,
    backend: new InMemoryVersionDocumentProviderBackend(),
  });
  const initialized = await provider.initializeGraph(
    await initializeInput(graphId, 'root', documentScope),
  );
  expectInitializeSuccess(initialized);

  const namespace = namespaceForDocumentScope(documentScope, graphId);
  const conflicts = options.conflicts ?? [basicConflict()];
  const previewRecord = await objectRecord(namespace, 'workbook.mergePreview.v1', {
    schemaVersion: 1,
    recordKind: 'mergePreview',
    status: 'conflicted',
    base: initialized.rootCommit.id,
    ours: initialized.rootCommit.id,
    theirs: initialized.rootCommit.id,
    changes: [],
    conflicts,
  });
  const graph = await provider.openGraph(namespace, provider.accessContext);
  expect(await graph.putObjects([previewRecord])).toMatchObject({ status: 'success' });

  await run({
    provider,
    version: new WorkbookVersionImpl({
      versioning: withVersionManifest({ provider, ...(options.versioning ?? {}) }),
    } as any),
    preview: {
      resultId: mergeResultIdForPreviewDigest(previewRecord.digest),
      resultDigest: previewRecord.digest,
      conflicts,
    },
    target: {
      commitId: initialized.rootCommit.id,
      revision: initialized.initialHead.revision,
    },
  });
}
