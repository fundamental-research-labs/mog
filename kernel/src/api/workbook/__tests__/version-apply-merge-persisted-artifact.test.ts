import type {
  VersionApplyMergeResolution,
  VersionHead,
  VersionMergeConflict,
  Workbook,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { DocumentFactory } from '../../document/document-factory';
import { withVersionManifest } from './version-domain-support-test-utils';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  idempotencyKeyForResolvedAttempt,
  intentIdForResolvedAttemptDigest,
} from '../../../document/version-store/merge-apply-intent-store';
import {
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
  mergeResolutionSetArtifactRef,
} from '../../../document/version-store/merge-attempt-artifacts';
import type { ObjectDigest } from '../../../document/version-store/object-digest';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

const DOCUMENT_ID = 'vc07-apply-merge-persisted-artifact';
const DOCUMENT_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CREATED_AT = '2026-06-21T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

describe('WorkbookVersion persisted merge preview artifact apply', () => {
  it('applies a review-only clean preview artifact through the production merge materializer', async () => {
    const graphId = 'graph-clean-artifact';
    const documentScope = documentScopeForGraph(graphId);
    const provider = createInMemoryVersionStoreProvider({ documentScope });
    const initialized = await provider.initializeGraph(
      await initializeInput(graphId, 'root', documentScope),
    );
    expectInitializeSuccess(initialized);

    const sourceHandle = await DocumentFactory.create({
      documentId: documentScope.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const branchHandle = await DocumentFactory.create({
      documentId: documentScope.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const mergedHandle = await DocumentFactory.create({
      documentId: documentScope.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let sourceWb: Workbook | undefined;
    let branchWb: Workbook | undefined;
    let mergedWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
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

      branchWb = await branchHandle.workbook({ versioning: withVersionManifest({ provider }) });
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
      if (!applied.ok)
        throw new Error(`expected persisted clean apply success: ${applied.error.code}`);
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
      const graph = await provider.openGraph(
        namespaceForDocumentScope(documentScope, graphId),
        provider.accessContext,
      );
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

      mergedWb = await mergedHandle.workbook({ versioning: withVersionManifest({ provider }) });
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
    const graphId = 'graph-conflict-artifact';
    const documentScope = documentScopeForGraph(graphId);
    const provider = createInMemoryVersionStoreProvider({ documentScope });
    const initialized = await provider.initializeGraph(
      await initializeInput(graphId, 'root', documentScope),
    );
    expectInitializeSuccess(initialized);

    const sourceHandle = await DocumentFactory.create({
      documentId: documentScope.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const branchHandle = await DocumentFactory.create({
      documentId: documentScope.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const mergedHandle = await DocumentFactory.create({
      documentId: documentScope.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let sourceWb: Workbook | undefined;
    let branchWb: Workbook | undefined;
    let mergedWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
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

      branchWb = await branchHandle.workbook({ versioning: withVersionManifest({ provider }) });
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
      if (!preview.ok)
        throw new Error(`expected persisted conflicted preview: ${preview.error.code}`);
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

      const conflict = replayedPreview.value.conflicts[0];
      const option = conflict.resolutionOptions.find(
        (candidate) => candidate.kind === 'acceptTheirs',
      );
      if (!option) throw new Error('expected acceptTheirs option');
      const payload = await sourceWb.version.putMergeResolutionPayload({
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        redactionPolicyDigest: preview.value.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        optionId: option.optionId,
        kind: option.kind,
        targetRef: 'refs/heads/main' as any,
        expectedTargetHead,
        value: option.value as any,
        purpose: 'chooseValue',
      });
      if (!payload.ok) throw new Error(`expected payload put success: ${payload.error.code}`);
      const sealedResolution = {
        ...resolutionFor(conflict, 'acceptTheirs'),
        sealedPayloadRef: payload.value,
      };

      const applied = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
          previewArtifactDigest: preview.value.previewArtifactDigest,
          resolutions: [sealedResolution],
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
      if (!applied.value.resolutionSetDigest) {
        throw new Error('expected applied merge to expose a resolution set digest');
      }
      const graph = await provider.openGraph(
        namespaceForDocumentScope(documentScope, graphId),
        provider.accessContext,
      );
      await expect(
        graph.getObjectRecord(mergeResolutionSetArtifactRef(applied.value.resolutionSetDigest)),
      ).resolves.toMatchObject({
        preimage: {
          payload: {
            resolutions: [expect.objectContaining({ sealedPayloadRef: payload.value })],
          },
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

      mergedWb = await mergedHandle.workbook({ versioning: withVersionManifest({ provider }) });
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
          resolutions: [sealedResolution],
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
        },
      );
      if (!repeated.ok) {
        throw new Error(
          `expected repeated persisted conflict apply success: ${repeated.error.code}`,
        );
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

  it('rejects a mismatched artifact resolution digest before write services', async () => {
    const graphId = 'graph-conflict-resolution-digest-mismatch';
    const documentScope = documentScopeForGraph(graphId);
    const provider = createInMemoryVersionStoreProvider({ documentScope });
    const initialized = await provider.initializeGraph(
      await initializeInput(graphId, 'root', documentScope),
    );
    expectInitializeSuccess(initialized);
    let mergeCommitCallCount = 0;
    const mergeCommit = async () => {
      mergeCommitCallCount += 1;
    };

    const sourceHandle = await DocumentFactory.create({
      documentId: documentScope.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const branchHandle = await DocumentFactory.create({
      documentId: documentScope.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let sourceWb: Workbook | undefined;
    let branchWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({
        versioning: withVersionManifest({
          provider,
          applyMergeService: { mergeCommit },
        }),
      });
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
        name: 'scenario/persisted-resolution-digest-mismatch' as any,
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

      branchWb = await branchHandle.workbook({ versioning: withVersionManifest({ provider }) });
      const checkoutBase = await branchWb.version.checkout({ kind: 'commit', id: baseCommit.id });
      if (!checkoutBase.ok) {
        throw new Error(`expected branch workbook checkout success: ${checkoutBase.error.code}`);
      }
      await branchWb.activeSheet.setCell('A1', 'theirs');
      const theirsCommit = await expectCommit(
        branchWb.version.commit({
          targetRef: 'scenario/persisted-resolution-digest-mismatch' as any,
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
      if (
        !preview.ok ||
        preview.value.status !== 'conflicted' ||
        !preview.value.resultId ||
        !preview.value.resultDigest ||
        !preview.value.previewArtifactDigest
      ) {
        throw new Error('expected persisted conflicted preview metadata');
      }

      const resolution = resolutionFor(preview.value.conflicts[0], 'acceptTheirs');
      const namespace = namespaceForDocumentScope(documentScope, graphId);
      const expectedResolutionSet = await createMergeResolutionSetArtifactRecord(namespace, [
        resolution,
      ]);

      const rejected = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
          previewArtifactDigest: preview.value.previewArtifactDigest,
          resolutionSetDigest: mutateDigest(expectedResolutionSet.digest),
          resolutions: [resolution],
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
        },
      );
      expect(rejected).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.applyMerge',
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              code: 'VERSION_MERGE_RESOLUTION_MISMATCH',
              message: 'persisted merge resolutionSetDigest does not match the resolved artifact.',
              data: expect.objectContaining({ mutationGuarantee: 'no-write-attempted' }),
            }),
          ]),
        },
      });
      expect(mergeCommitCallCount).toBe(0);

      const graph = await provider.openGraph(namespace, provider.accessContext);
      await expect(
        graph.hasObject(mergeResolutionSetArtifactRef(expectedResolutionSet.digest)),
      ).resolves.toBe(false);
    } finally {
      if (branchWb) await branchWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await branchHandle.dispose();
      await sourceHandle.dispose();
    }
  });

  it('does not recover a conflicted staged intent from parent shape without commit-bound resolved attempt identity', async () => {
    const graphId = 'graph-conflict-no-identity';
    const documentScope = documentScopeForGraph(graphId);
    const provider = createInMemoryVersionStoreProvider({ documentScope });
    const initialized = await provider.initializeGraph(
      await initializeInput(graphId, 'root', documentScope),
    );
    expectInitializeSuccess(initialized);
    const namespace = namespaceForDocumentScope(documentScope, graphId);

    const sourceHandle = await DocumentFactory.create({
      documentId: documentScope.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const branchHandle = await DocumentFactory.create({
      documentId: documentScope.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let sourceWb: Workbook | undefined;
    let branchWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
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
        name: 'scenario/persisted-conflict-no-identity' as any,
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

      branchWb = await branchHandle.workbook({ versioning: withVersionManifest({ provider }) });
      const checkoutBase = await branchWb.version.checkout({ kind: 'commit', id: baseCommit.id });
      if (!checkoutBase.ok) {
        throw new Error(`expected branch workbook checkout success: ${checkoutBase.error.code}`);
      }
      await branchWb.activeSheet.setCell('A1', 'theirs');
      const theirsCommit = await expectCommit(
        branchWb.version.commit({
          targetRef: 'scenario/persisted-conflict-no-identity' as any,
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
      if (
        !preview.ok ||
        preview.value.status !== 'conflicted' ||
        !preview.value.resultId ||
        !preview.value.resultDigest ||
        !preview.value.previewArtifactDigest
      ) {
        throw new Error('expected persisted conflicted preview metadata');
      }

      const resolution = resolutionFor(preview.value.conflicts[0], 'acceptTheirs');
      const graph = await provider.openGraph(namespace, provider.accessContext);
      const resolutionSet = await createMergeResolutionSetArtifactRecord(namespace, [resolution]);
      const resolvedAttempt = await createResolvedMergeAttemptArtifactRecord(namespace, {
        resultDigest: preview.value.resultDigest as ObjectDigest,
        resolutionSetDigest: resolutionSet.digest,
        targetRef: 'refs/heads/main' as any,
        expectedTargetHead,
      });
      expect(await graph.putObjects([resolutionSet, resolvedAttempt])).toMatchObject({
        status: 'success',
      });
      const intentStore = await provider.openMergeApplyIntentStore(namespace);
      await expect(
        intentStore.beginIntent({
          intentId: intentIdForResolvedAttemptDigest(resolvedAttempt.digest),
          idempotencyKey: idempotencyKeyForResolvedAttempt({
            resolvedAttemptDigest: resolvedAttempt.digest,
            targetRef: 'refs/heads/main' as any,
            expectedTargetHead,
          }),
          applyKind: 'mergeCommit',
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
          resultDigest: preview.value.resultDigest as ObjectDigest,
          resolutionSetDigest: resolutionSet.digest,
          resolvedAttemptDigest: resolvedAttempt.digest,
          createdAt: CREATED_AT,
        }),
      ).resolves.toMatchObject({ status: 'created', record: { state: 'staging' } });

      const unboundApply = await sourceWb.version.applyMerge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
          resolutions: [resolution],
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
        },
      );
      if (!unboundApply.ok) {
        throw new Error(`expected unbound direct apply success: ${unboundApply.error.code}`);
      }
      const mergeCommitId = unboundApply.value.commitRef.id;
      await expect(graph.readCommit(mergeCommitId)).resolves.toMatchObject({
        status: 'success',
        commit: {
          payload: {
            parentCommitIds: [oursCommit.id, theirsCommit.id],
          },
        },
      });

      const recovered = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
          previewArtifactDigest: preview.value.previewArtifactDigest,
          resolutions: [resolution],
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
        },
      );
      if (!recovered.ok) throw new Error(`expected stale replay result: ${recovered.error.code}`);
      expect(recovered.value).toMatchObject({
        status: 'staleTargetHead',
        headAfter: mergeCommitId,
        resolvedAttemptDigest: resolvedAttempt.digest,
        mutationGuarantee: 'ref-not-mutated',
      });
      await expect(
        intentStore.readByIntentId(intentIdForResolvedAttemptDigest(resolvedAttempt.digest)),
      ).resolves.toMatchObject({
        status: 'found',
        record: { state: 'staging' },
      });
    } finally {
      if (branchWb) await branchWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
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

function conflictDigestObject(conflictDigest: string): ObjectDigest {
  if (!conflictDigest.startsWith('sha256:')) {
    throw new Error(`expected sha256 conflict digest: ${conflictDigest}`);
  }
  return { algorithm: 'sha256', digest: conflictDigest.slice('sha256:'.length) };
}

function mutateDigest(digest: ObjectDigest): ObjectDigest {
  const first = digest.digest[0] === '0' ? '1' : '0';
  return {
    algorithm: digest.algorithm,
    digest: `${first}${digest.digest.slice(1)}`,
  };
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
