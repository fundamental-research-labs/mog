import type {
  VersionApplyMergeResolution,
  VersionHead,
  VersionMergeConflict,
  Workbook,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { DocumentFactory } from '../../document/document-factory';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

const DOCUMENT_ID = 'vc07-apply-merge-persisted-artifact';
const DOCUMENT_SCOPE: VersionDocumentScope = { documentId: DOCUMENT_ID };
const CREATED_AT = '2026-06-21T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

describe('WorkbookVersion persisted merge preview artifact apply', () => {
  it('applies a review-only clean preview artifact through the production merge materializer', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-clean-artifact', 'root'));
    expectInitializeSuccess(initialized);

    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const branchHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const mergedHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let sourceWb: Workbook | undefined;
    let branchWb: Workbook | undefined;
    let mergedWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: { provider } });
      await sourceWb.activeSheet.setCell('A1', 'base');
      const baseCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: initialized.rootCommit.id,
            revision: initialized.initialHead.revision,
            symbolicHeadRevision: initialized.symbolicHead.revision,
          },
        }),
      );
      const baseHead = await expectHead(sourceWb);

      const branch = await sourceWb.version.createBranch({
        name: 'scenario/persisted-clean-artifact' as any,
        targetCommitId: baseCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

      await sourceWb.activeSheet.setCell('B1', 'ours');
      const oursCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      const oursHead = await expectHead(sourceWb);

      branchWb = await branchHandle.workbook({ versioning: { provider } });
      const checkoutBase = await branchWb.version.checkout({ kind: 'commit', id: baseCommit.id });
      if (!checkoutBase.ok) {
        throw new Error(`expected branch workbook checkout success: ${checkoutBase.error.code}`);
      }
      await branchWb.activeSheet.setCell('C1', 'theirs');
      const theirsCommit = await expectCommit(
        branchWb.version.commit({
          targetRef: 'scenario/persisted-clean-artifact' as any,
          expectedHead: {
            commitId: baseCommit.id,
            revision: branch.value.revision,
          },
        }),
      );

      const expectedTargetHead = {
        commitId: oursCommit.id,
        revision: requireRefRevision(oursHead),
      };
      const preview = await sourceWb.version.merge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
        },
        {
          mode: 'preview',
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
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
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
        },
      );
      if (!applied.ok) throw new Error(`expected persisted clean apply success: ${applied.error.code}`);
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

      mergedWb = await mergedHandle.workbook({ versioning: { provider } });
      const checkoutMerged = await mergedWb.version.checkout({
        kind: 'commit',
        id: mergeCommitId,
      });
      if (!checkoutMerged.ok) {
        throw new Error(`expected merged checkout success: ${checkoutMerged.error.code}`);
      }
      await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
      await expect(mergedWb.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 'ours' });
      await expect(mergedWb.activeSheet.getCell('C1')).resolves.toMatchObject({ value: 'theirs' });
    } finally {
      if (mergedWb) await mergedWb.close('skipSave');
      if (branchWb) await branchWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await mergedHandle.dispose();
      await branchHandle.dispose();
      await sourceHandle.dispose();
    }
  });

  it('replays a persisted conflicted review artifact without an apply intent', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-conflict-artifact', 'root'));
    expectInitializeSuccess(initialized);

    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const branchHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const mergedHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let sourceWb: Workbook | undefined;
    let branchWb: Workbook | undefined;
    let mergedWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: { provider } });
      await sourceWb.activeSheet.setCell('A1', 'base');
      const baseCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: initialized.rootCommit.id,
            revision: initialized.initialHead.revision,
            symbolicHeadRevision: initialized.symbolicHead.revision,
          },
        }),
      );
      const baseHead = await expectHead(sourceWb);

      const branch = await sourceWb.version.createBranch({
        name: 'scenario/persisted-conflict-artifact' as any,
        targetCommitId: baseCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

      await sourceWb.activeSheet.setCell('A1', 'ours');
      const oursCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      const oursHead = await expectHead(sourceWb);

      branchWb = await branchHandle.workbook({ versioning: { provider } });
      const checkoutBase = await branchWb.version.checkout({ kind: 'commit', id: baseCommit.id });
      if (!checkoutBase.ok) {
        throw new Error(`expected branch workbook checkout success: ${checkoutBase.error.code}`);
      }
      await branchWb.activeSheet.setCell('A1', 'theirs');
      const theirsCommit = await expectCommit(
        branchWb.version.commit({
          targetRef: 'scenario/persisted-conflict-artifact' as any,
          expectedHead: {
            commitId: baseCommit.id,
            revision: branch.value.revision,
          },
        }),
      );

      const expectedTargetHead = {
        commitId: oursCommit.id,
        revision: requireRefRevision(oursHead),
      };
      const preview = await sourceWb.version.merge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
        },
        {
          mode: 'preview',
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
          persistReviewRecord: true,
        },
      );
      if (!preview.ok) throw new Error(`expected persisted conflicted preview: ${preview.error.code}`);
      if (
        preview.value.status !== 'conflicted' ||
        !preview.value.resultId ||
        !preview.value.resultDigest ||
        !preview.value.previewArtifactDigest
      ) {
        throw new Error('expected conflicted preview to expose persisted artifact metadata');
      }

      const replayedPreview = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
          previewArtifactDigest: preview.value.previewArtifactDigest,
        },
        { mode: 'preview' },
      );
      if (!replayedPreview.ok) {
        throw new Error(`expected conflicted replay success: ${replayedPreview.error.code}`);
      }
      expect(replayedPreview.value).toMatchObject({
        status: 'conflicted',
        base: baseCommit.id,
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        previewArtifactDigest: preview.value.previewArtifactDigest,
        changes: preview.value.changes,
        conflicts: expect.arrayContaining([
          expect.objectContaining({
            conflictId: preview.value.conflicts[0].conflictId,
            conflictDigest: preview.value.conflicts[0].conflictDigest,
            resolutionOptions: expect.arrayContaining([
              expect.objectContaining({ kind: 'acceptOurs' }),
              expect.objectContaining({ kind: 'acceptTheirs' }),
              expect.objectContaining({ kind: 'acceptBase' }),
            ]),
          }),
        ]),
        requiredResolutionCount: preview.value.conflicts.length,
        mutationGuarantee: 'preview-only',
      });
      if (replayedPreview.value.status !== 'conflicted') {
        throw new Error('expected replayed preview to remain conflicted');
      }

      const applied = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
          previewArtifactDigest: preview.value.previewArtifactDigest,
          resolutions: [resolutionFor(replayedPreview.value.conflicts[0], 'acceptTheirs')],
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
        },
      );
      if (!applied.ok) {
        throw new Error(`expected persisted conflict apply success: ${applied.error.code}`);
      }
      expect(applied.value).toMatchObject({
        status: 'applied',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        previewArtifactDigest: preview.value.previewArtifactDigest,
        resolutionSetDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        resolvedAttemptDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        targetRef: 'refs/heads/main',
        resolutionCount: 1,
        mutationGuarantee: 'merge-commit-created',
      });

      const mergeCommitId = applied.value.commitRef.id;
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

      mergedWb = await mergedHandle.workbook({ versioning: { provider } });
      const checkoutMerged = await mergedWb.version.checkout({
        kind: 'commit',
        id: mergeCommitId,
      });
      if (!checkoutMerged.ok) {
        throw new Error(`expected merged checkout success: ${checkoutMerged.error.code}`);
      }
      await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'theirs' });

      const repeated = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
          previewArtifactDigest: preview.value.previewArtifactDigest,
          resolutions: [resolutionFor(replayedPreview.value.conflicts[0], 'acceptTheirs')],
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
        },
      );
      if (!repeated.ok) {
        throw new Error(`expected repeated persisted conflict apply success: ${repeated.error.code}`);
      }
      expect(repeated.value).toMatchObject({
        status: 'alreadyApplied',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        previewArtifactDigest: preview.value.previewArtifactDigest,
        resolutionSetDigest: applied.value.resolutionSetDigest,
        resolvedAttemptDigest: applied.value.resolvedAttemptDigest,
        targetRef: 'refs/heads/main',
        headBefore: oursCommit.id,
        headAfter: mergeCommitId,
        commitRef: {
          id: mergeCommitId,
          refName: 'refs/heads/main',
          resolvedFrom: 'refs/heads/main',
        },
        changes: [],
        resolutionCount: 0,
        mutationGuarantee: 'ref-not-mutated',
      });
    } finally {
      if (mergedWb) await mergedWb.close('skipSave');
      if (branchWb) await branchWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await mergedHandle.dispose();
      await branchHandle.dispose();
      await sourceHandle.dispose();
    }
  });
});

async function expectCommit(
  resultPromise: ReturnType<Workbook['version']['commit']>,
): Promise<WorkbookCommitSummary> {
  const result = await resultPromise;
  if (!result.ok) throw new Error(`expected commit success: ${result.error.code}`);
  return result.value;
}

async function expectHead(wb: Workbook): Promise<VersionHead> {
  const result = await wb.version.getHead();
  if (!result.ok) throw new Error(`expected getHead success: ${result.error.code}`);
  return result.value;
}

function requireRefRevision(head: VersionHead) {
  if (!head.refRevision) throw new Error('expected head to expose a ref revision');
  return head.refRevision;
}

function resolutionFor(
  conflict: VersionMergeConflict,
  kind: VersionApplyMergeResolution['kind'],
): VersionApplyMergeResolution {
  const option = conflict.resolutionOptions.find((candidate) => candidate.kind === kind);
  if (!option) throw new Error(`expected conflict to expose ${kind} resolution option`);
  return {
    conflictId: conflict.conflictId,
    expectedConflictDigest: conflict.conflictDigest,
    optionId: option.optionId,
    kind,
  };
}

async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
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

async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}
