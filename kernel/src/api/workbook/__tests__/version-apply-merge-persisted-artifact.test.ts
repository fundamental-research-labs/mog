import { jest } from '@jest/globals';

import type { VersionCommitExpectedHead, WorkbookCommitId } from '@mog-sdk/contracts/api';

import {
  idempotencyKeyForResolvedAttempt,
  intentIdForResolvedAttemptDigest,
  type MergeApplyIntentRecord,
  type MergeApplyIntentStore,
} from '../../../document/version-store/merge-apply-intent-store';
import {
  createMergePreviewArtifactRecord,
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
  mergeResultIdForPreviewDigest,
} from '../../../document/version-store/merge-attempt-artifacts';
import { versionGraphNamespaceKey } from '../../../document/version-store/object-store';
import {
  createVersionGraphRegistry,
  namespaceForDocumentScope,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import { versionDocumentScopeKey } from '../../../document/version-store/registry';
import { applyPersistedMergeResult } from '../version/apply-merge/version-apply-merge-persisted';
import {
  PERSISTED_ARTIFACT_CREATED_AT,
  createPersistedMergeScenario,
  PERSISTED_ARTIFACT_TARGET_REF,
} from './version-apply-merge-persisted-artifact-test-utils';

describe('WorkbookVersion persisted clean merge preview artifacts', () => {
  it('applies a review-only clean preview artifact through the production merge materializer', async () => {
    const fixture = await createPersistedMergeScenario({
      graphId: 'graph-clean-artifact',
      branchName: 'scenario/persisted-clean-artifact',
      ours: [{ cell: 'B1', value: 'ours' }],
      theirs: [{ cell: 'C1', value: 'theirs' }],
    });

    try {
      const { sourceWb, provider, namespace, baseCommit, oursCommit, theirsCommit } = fixture;
      const preview = await sourceWb.version.merge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
        },
        {
          mode: 'preview',
          targetRef: PERSISTED_ARTIFACT_TARGET_REF,
          expectedTargetHead: fixture.expectedTargetHead,
          persistReviewRecord: true,
        },
      );
      if (!preview.ok) throw new Error(`expected persisted clean preview: ${preview.error.code}`);
      expect(preview.value).toMatchObject({
        status: 'clean',
        resultId: expect.stringMatching(/^merge-result:[0-9a-f]{64}$/),
        attemptPersistence: 'persisted',
        attemptKind: 'reviewOnly',
        targetRef: 'refs/heads/main',
      });
      if (
        preview.value.status !== 'clean' ||
        !preview.value.resultId ||
        !preview.value.resultDigest ||
        !preview.value.previewArtifactDigest
      ) {
        throw new Error('expected clean preview to expose persisted artifact metadata');
      }
      expect(preview.value.resultDigest).toEqual(preview.value.previewArtifactDigest);

      const replayedPreview = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
        },
        { mode: 'preview' },
      );
      if (!replayedPreview.ok) {
        throw new Error(`expected persisted preview replay success: ${replayedPreview.error.code}`);
      }
      expect(replayedPreview.value).toMatchObject({
        status: 'planned',
        base: baseCommit.id,
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        previewArtifactDigest: preview.value.previewArtifactDigest,
        changes: preview.value.changes,
        conflicts: [],
        resolutionCount: 0,
        mutationGuarantee: 'preview-only',
      });

      const applied = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
          previewArtifactDigest: preview.value.previewArtifactDigest,
        },
        {
          targetRef: PERSISTED_ARTIFACT_TARGET_REF,
          expectedTargetHead: fixture.expectedTargetHead,
        },
      );
      if (!applied.ok) {
        throw new Error(`expected persisted clean apply success: ${applied.error.code}`);
      }
      expect(applied.value).toMatchObject({
        status: 'applied',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        previewArtifactDigest: preview.value.previewArtifactDigest,
        targetRef: 'refs/heads/main',
        headBefore: oursCommit.id,
        mutationGuarantee: 'merge-commit-created',
        commitRef: {
          refName: 'refs/heads/main',
          resolvedFrom: 'refs/heads/main',
        },
      });

      const mergeCommitId = applied.value.commitRef.id;
      const graph = await provider.openGraph(namespace, provider.accessContext);
      await expect(graph.readCommit(mergeCommitId)).resolves.toMatchObject({
        status: 'success',
        commit: {
          payload: {
            resolvedMergeAttemptDigest: applied.value.resolvedAttemptDigest,
          },
        },
      });
      await expect(sourceWb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: {
          items: expect.arrayContaining([
            expect.objectContaining({
              id: mergeCommitId,
              parents: [oursCommit.id, theirsCommit.id],
            }),
          ]),
        },
      });
      const mergedWb = await fixture.openMergedWorkbook();
      const checkoutMerged = await mergedWb.version.checkout({
        kind: 'commit',
        id: mergeCommitId,
      });
      if (!checkoutMerged.ok) {
        throw new Error(`expected merged checkout success: ${checkoutMerged.error.code}`);
      }
      await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
      await expect(mergedWb.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 'ours' });
      await expect(mergedWb.activeSheet.getCell('C1')).resolves.toMatchObject({
        value: 'theirs',
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects stale target ref CAS on staged artifact recovery before writing a merge commit', async () => {
    const documentScope: VersionDocumentScope = {
      documentId: 'persisted-artifact-stale-cas-recovery',
    };
    const namespace = namespaceForDocumentScope(documentScope, 'stale-cas-recovery');
    const registry = await createVersionGraphRegistry({
      documentScope,
      graphId: namespace.graphId,
      rootCommitId: BASE,
      createdAt: PERSISTED_ARTIFACT_CREATED_AT,
    });
    const expectedTargetHead: VersionCommitExpectedHead = {
      commitId: OURS,
      revision: { kind: 'counter', value: '1' },
    };
    const preview = await createMergePreviewArtifactRecord(namespace, {
      status: 'clean',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [],
    });
    const resolutionSet = await createMergeResolutionSetArtifactRecord(namespace, []);
    const resolvedAttempt = await createResolvedMergeAttemptArtifactRecord(namespace, {
      resultDigest: preview.digest,
      resolutionSetDigest: resolutionSet.digest,
      targetRef: PERSISTED_ARTIFACT_TARGET_REF,
      expectedTargetHead,
    });
    const record: MergeApplyIntentRecord = {
      schemaVersion: 1,
      recordKind: 'mergeApplyIntent',
      intentId: intentIdForResolvedAttemptDigest(resolvedAttempt.digest),
      idempotencyKey: idempotencyKeyForResolvedAttempt({
        resolvedAttemptDigest: resolvedAttempt.digest,
        targetRef: PERSISTED_ARTIFACT_TARGET_REF,
        expectedTargetHead,
      }),
      namespaceKey: versionGraphNamespaceKey(namespace),
      documentScopeKey: versionDocumentScopeKey(documentScope),
      applyKind: 'mergeCommit',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      targetRef: PERSISTED_ARTIFACT_TARGET_REF,
      expectedTargetHead,
      resultDigest: preview.digest,
      resolutionSetDigest: resolutionSet.digest,
      resolvedAttemptDigest: resolvedAttempt.digest,
      state: 'staging',
      createdAt: PERSISTED_ARTIFACT_CREATED_AT,
      updatedAt: PERSISTED_ARTIFACT_CREATED_AT,
    };
    const store: MergeApplyIntentStore = {
      namespace,
      beginIntent: jest.fn(),
      readByIntentId: jest.fn(),
      readByIdempotencyKey: jest.fn(async () => ({
        status: 'found',
        record,
        diagnostics: [],
      })),
      readRefCasProof: jest.fn(),
      completeIntent: jest.fn(),
    };
    const putObjects = jest.fn();
    const mergeCommit = jest.fn();
    const graph = {
      namespace,
      getObjectRecord: jest.fn(async () => preview),
      putObjects,
      readRef: jest.fn(async () => ({
        status: 'success',
        ref: {
          name: PERSISTED_ARTIFACT_TARGET_REF,
          commitId: OURS,
          revision: { kind: 'counter' as const, value: '2' },
          updatedAt: PERSISTED_ARTIFACT_CREATED_AT,
        },
        diagnostics: [],
      })),
    };
    const provider = {
      accessContext: {},
      readGraphRegistry: jest.fn(async () => ({
        status: 'ok' as const,
        registry,
        diagnostics: [],
      })),
      openGraph: jest.fn(async () => graph),
      openMergeApplyIntentStore: jest.fn(async () => store),
    };

    const result = await applyPersistedMergeResult(
      {
        versioning: {
          provider,
          writeService: { mergeCommit },
        },
      } as Parameters<typeof applyPersistedMergeResult>[0],
      {
        resultId: mergeResultIdForPreviewDigest(preview.digest),
        resultDigest: preview.digest,
        previewArtifactDigest: preview.digest,
      },
      { targetRef: PERSISTED_ARTIFACT_TARGET_REF, expectedTargetHead },
    );

    expect(result).toMatchObject({
      status: 'staleTargetHead',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      targetRef: PERSISTED_ARTIFACT_TARGET_REF,
      headBefore: OURS,
      headAfter: OURS,
      mutationGuarantee: 'ref-not-mutated',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_REF_CONFLICT',
          recoverability: 'retry',
          payload: expect.objectContaining({
            operation: 'applyMerge',
            reason: 'staleTargetHead',
            expectedRevision: '1',
            actualRevision: '2',
          }),
        }),
      ],
    });
    expect(mergeCommit).not.toHaveBeenCalled();
    expect(putObjects).not.toHaveBeenCalled();
    expect(store.beginIntent).not.toHaveBeenCalled();
    expect(store.readRefCasProof).not.toHaveBeenCalled();
    expect(store.completeIntent).not.toHaveBeenCalled();
  });
});

const BASE = commitId('0');
const OURS = commitId('1');
const THEIRS = commitId('2');

function commitId(seed: string): WorkbookCommitId {
  return `commit:sha256:${seed.repeat(64)}` as WorkbookCommitId;
}
