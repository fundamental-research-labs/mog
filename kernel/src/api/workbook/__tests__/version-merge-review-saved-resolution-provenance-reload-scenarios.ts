import type {
  ObjectDigest,
  VersionCommitExpectedHead,
  VersionMergeConflict,
  VersionMergeResultId,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { WorkbookVersionImpl } from '../version';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphStore,
} from '../../../document/version-store/provider';
import {
  mergePreviewArtifactRef,
  mergeResolutionSetV2ArtifactRef,
  mergeResultIdForPreviewDigest,
} from '../../../document/version-store/merge-attempt-artifacts';
import {
  TARGET_REF,
  conflictDigestObject,
  expectMergeReviewFailure,
  expectNoDiagnosticLeaks,
  objectRecord,
  resolutionFor,
} from './version-merge-review-saved-resolution-test-utils';
import { conflictRecord } from './version-merge-review-saved-resolution-helpers-conflicts';

const DOCUMENT_ID = 'w11-07-saved-resolution-provenance-reload';
const DOCUMENT_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CREATED_AT = '2026-06-24T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

type ReloadedReviewFixture = {
  readonly graph: VersionGraphStore;
  readonly version: WorkbookVersionImpl;
};

type ReloadableReviewFixture = ReloadedReviewFixture & {
  readonly preview: {
    readonly resultId: VersionMergeResultId;
    readonly resultDigest: ObjectDigest;
    readonly conflicts: readonly VersionMergeConflict[];
  };
  readonly target: VersionCommitExpectedHead;
  readonly reload: () => Promise<ReloadedReviewFixture>;
};

export function registerSavedResolutionProvenanceReloadReviewTests(): void {
  it('preserves v2 saved-resolution provenance across provider reloads', async () => {
    await withReloadableReviewFixture(
      'v1-saved-resolution-reload',
      async ({ version, preview, target, reload }) => {
        const conflict = preview.conflicts[0];
        const saved = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          resolutions: [resolutionFor(conflict, 'acceptTheirs')],
        });
        if (!saved.ok || !saved.value.resolutionSetDigest || !saved.value.resolvedAttemptDigest) {
          throw new Error('expected complete saved resolution provenance artifacts');
        }

        const reloaded = await reload();
        const reloadedResolutionSet = await reloaded.graph.getObjectRecord(
          mergeResolutionSetV2ArtifactRef(saved.value.resolutionSetDigest),
        );
        expect(reloadedResolutionSet).toMatchObject({
          preimage: {
            objectType: 'workbook.mergeResolutionSet.v2',
            dependencies: [mergePreviewArtifactRef(preview.resultDigest)],
            payload: {
              schemaVersion: 2,
              recordKind: 'mergeResolutionSet',
              resultId: preview.resultId,
              resultDigest: preview.resultDigest,
              previewArtifactDigest: preview.resultDigest,
              resolutions: [expect.objectContaining({ kind: 'acceptTheirs' })],
            },
          },
        });
        expect(reloadedResolutionSet.preimage.payload).not.toHaveProperty('targetRef');
        expect(reloadedResolutionSet.preimage.payload).not.toHaveProperty('expectedTargetHead');

        const detail = await reloaded.version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          valueRole: 'resolved',
          purpose: 'resolution',
          resolutionSetDigest: saved.value.resolutionSetDigest,
          resolvedAttemptDigest: saved.value.resolvedAttemptDigest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
        });

        expect(detail).toMatchObject({
          ok: true,
          value: {
            schemaVersion: 1,
            kind: 'resolutionPayload',
            valueRole: 'resolved',
            value: { kind: 'value', value: 'theirs' },
          },
        });
      },
    );
  });

  it('rejects reloaded resolved-attempt provenance when resultDigest drifts from the preview', async () => {
    await withReloadableReviewFixture(
      'resolved-attempt-result-drift-reload',
      async ({ graph, namespace, version, preview, target, reload }) => {
        const conflict = preview.conflicts[0];
        const saved = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          resolutions: [resolutionFor(conflict, 'acceptTheirs')],
        });
        if (!saved.ok || !saved.value.resolutionSetDigest) {
          throw new Error('expected saved resolution set digest');
        }

        const alternateConflict = conflictRecord('8');
        const alternatePreview = await objectRecord(namespace, 'workbook.mergePreview.v1', {
          schemaVersion: 1,
          recordKind: 'mergePreview',
          status: 'conflicted',
          base: target.commitId,
          ours: target.commitId,
          theirs: target.commitId,
          changes: [],
          conflicts: [alternateConflict],
        });
        const driftedResolvedAttempt = await objectRecord(
          namespace,
          'workbook.resolvedMergeAttempt.v1',
          {
            schemaVersion: 1,
            recordKind: 'resolvedMergeAttempt',
            resultDigest: alternatePreview.digest,
            resolutionSetDigest: saved.value.resolutionSetDigest,
            targetRef: TARGET_REF,
            expectedTargetHead: target,
          },
        );
        expect(await graph.putObjects([alternatePreview, driftedResolvedAttempt])).toMatchObject({
          status: 'success',
        });

        const reloaded = await reload();
        const result = await reloaded.version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          valueRole: 'resolved',
          purpose: 'resolution',
          resolutionSetDigest: saved.value.resolutionSetDigest,
          resolvedAttemptDigest: driftedResolvedAttempt.digest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
        });

        expectMergeReviewFailure(result, 'VERSION_MERGE_RESOLUTION_MISMATCH');
        expectNoDiagnosticLeaks(result, [
          conflict.conflictId,
          conflict.conflictDigest,
          saved.value.resolutionSetDigest.digest,
          driftedResolvedAttempt.digest.digest,
          preview.resultDigest.digest,
          alternatePreview.digest.digest,
        ]);
      },
    );
  });
}

async function withReloadableReviewFixture(
  graphId: string,
  run: (
    fixture: ReloadableReviewFixture & {
      readonly namespace: ReturnType<typeof namespaceForDocumentScope>;
    },
  ) => Promise<void>,
): Promise<void> {
  const documentScope = documentScopeForGraph(graphId);
  const backend = new InMemoryVersionDocumentProviderBackend();
  const provider = createInMemoryVersionStoreProvider({
    documentScope,
    backend,
    durability: 'snapshot-test-double',
  });
  const initialized = await provider.initializeGraph(
    await initializeInput(graphId, 'root', documentScope),
  );
  expectInitializeSuccess(initialized);

  const namespace = namespaceForDocumentScope(documentScope, graphId);
  const conflict = conflictRecord('7');
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
  expect(await graph.putObjects([previewRecord])).toMatchObject({ status: 'success' });

  await run({
    graph,
    namespace,
    version: new WorkbookVersionImpl({ versioning: { provider } } as any),
    preview: {
      resultId: mergeResultIdForPreviewDigest(previewRecord.digest),
      resultDigest: previewRecord.digest,
      conflicts: [conflict],
    },
    target: {
      commitId: initialized.rootCommit.id,
      revision: initialized.initialHead.revision,
    },
    reload: async () => {
      const snapshot = await backend.exportSnapshot();
      const reloadedBackend = await InMemoryVersionDocumentProviderBackend.fromSnapshot(snapshot);
      const reloadedProvider = createInMemoryVersionStoreProvider({
        documentScope,
        backend: reloadedBackend,
        durability: 'snapshot-test-double',
      });
      return {
        graph: await reloadedProvider.openGraph(namespace, reloadedProvider.accessContext),
        version: new WorkbookVersionImpl({ versioning: { provider: reloadedProvider } } as any),
      };
    },
  });
}

async function initializeInput(
  graphId: string,
  label: string,
  documentScope: VersionDocumentScope,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [],
      }),
      author: AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

function documentScopeForGraph(graphId: string): VersionDocumentScope {
  return { documentId: `${DOCUMENT_ID}-${DOCUMENT_RUN_ID}-${graphId}` };
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}
