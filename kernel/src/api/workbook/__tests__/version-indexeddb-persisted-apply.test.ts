import 'fake-indexeddb/auto';

import type {
  VersionApplyMergeResolution,
  VersionHead,
  VersionMergeConflict,
  Workbook,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  INDEXEDDB_PERSISTED_APPLY_AUTHOR as AUTHOR,
  INDEXEDDB_PERSISTED_APPLY_DOCUMENT_ID as DOCUMENT_ID,
  INDEXEDDB_PERSISTED_APPLY_DOCUMENT_SCOPE as DOCUMENT_SCOPE,
  INDEXEDDB_PERSISTED_APPLY_GRAPH_ID as GRAPH_ID,
  rootWrite,
} from './version-indexeddb-persisted-apply-test-utils';
import {
  intentIdForMergeResultId,
  intentIdForResolvedAttemptDigest,
  type MergeApplyIntentStore,
} from '../../../document/version-store/merge-apply-intent-store';
import {
  createIndexedDbVersionStoreProvider,
  INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
  type IndexedDbVersionStoreProvider,
} from '../../../document/version-store/provider-indexeddb-backend';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';
import {
  namespaceForDocumentScope,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

describe('WorkbookVersion IndexedDB persisted applyMerge', () => {
  it('applies a persisted clean merge artifact after reopen and replays the finalized merge intent', async () => {
    const firstHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const branchHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let firstWb: Workbook | undefined;
    let branchWb: Workbook | undefined;
    let reopenedHandle: Awaited<ReturnType<typeof DocumentFactory.create>> | undefined;
    let reopenedWb: Workbook | undefined;
    let secondReopenedHandle: Awaited<ReturnType<typeof DocumentFactory.create>> | undefined;
    let secondReopenedWb: Workbook | undefined;
    let checkoutHandle: Awaited<ReturnType<typeof DocumentFactory.create>> | undefined;
    let checkoutWb: Workbook | undefined;

    try {
      firstWb = await firstHandle.workbook({
        versioning: withVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
            initialize: {
              graphId: GRAPH_ID,
              rootWrite: await rootWrite('clean-artifact-root'),
            },
          },
        }),
      });
      const rootHead = await expectHead(firstWb);

      await firstWb.activeSheet.setCell('A1', 'base');
      const baseCommit = await expectCommit(
        firstWb.version.commit({
          expectedHead: {
            commitId: rootHead.id,
            revision: requireRefRevision(rootHead),
          },
        }),
      );
      const baseHead = await expectHead(firstWb);

      const branch = await firstWb.version.createBranch({
        name: 'scenario/indexeddb-clean-artifact' as any,
        targetCommitId: baseCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

      await firstWb.activeSheet.setCell('B1', 'ours');
      const oursCommit = await expectCommit(
        firstWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      const oursHead = await expectHead(firstWb);

      branchWb = await branchHandle.workbook({
        versioning: withVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        }),
      });
      const checkoutBase = await branchWb.version.checkout({ kind: 'commit', id: baseCommit.id });
      if (!checkoutBase.ok) {
        throw new Error(`expected branch workbook checkout success: ${checkoutBase.error.code}`);
      }
      await branchWb.activeSheet.setCell('C1', 'theirs');
      const theirsCommit = await expectCommit(
        branchWb.version.commit({
          targetRef: 'scenario/indexeddb-clean-artifact' as any,
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
      const preview = await firstWb.version.merge(
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
        throw new Error(`expected persisted clean preview success: ${preview.error.code}`);
      expect(preview.value).toMatchObject({
        status: 'clean',
        resultId: expect.stringMatching(/^merge-result:[0-9a-f]{64}$/),
        resultDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        previewArtifactDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        attemptPersistence: 'persisted',
        attemptKind: 'reviewOnly',
      });
      if (
        preview.value.status !== 'clean' ||
        !preview.value.resultId ||
        !preview.value.resultDigest ||
        !preview.value.previewArtifactDigest
      ) {
        throw new Error('expected persisted clean preview to expose artifact metadata');
      }

      await branchWb.close('skipSave');
      branchWb = undefined;
      await branchHandle.dispose();
      await firstWb.close('skipSave');
      firstWb = undefined;
      await firstHandle.dispose();

      reopenedHandle = await DocumentFactory.create({
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      reopenedWb = await reopenedHandle.workbook({
        versioning: withVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        }),
      });

      const applied = await reopenedWb.version.applyMerge(
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
        resolvedAttemptDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        targetRef: 'refs/heads/main',
        mutationGuarantee: 'merge-commit-created',
      });
      const mergeCommitId = applied.value.commitRef.id;

      await reopenedWb.close('skipSave');
      reopenedWb = undefined;
      await reopenedHandle.dispose();

      secondReopenedHandle = await DocumentFactory.create({
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      secondReopenedWb = await secondReopenedHandle.workbook({
        versioning: withVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        }),
      });

      const repeated = await secondReopenedWb.version.applyMerge(
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
      if (!repeated.ok) {
        throw new Error(`expected persisted clean alreadyApplied success: ${repeated.error.code}`);
      }
      expect(repeated.value).toMatchObject({
        status: 'alreadyApplied',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        commitRef: {
          id: mergeCommitId,
          refName: 'refs/heads/main',
          resolvedFrom: 'refs/heads/main',
        },
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        previewArtifactDigest: preview.value.previewArtifactDigest,
        resolvedAttemptDigest: applied.value.resolvedAttemptDigest,
        targetRef: 'refs/heads/main',
        headBefore: oursCommit.id,
        headAfter: mergeCommitId,
        mutationGuarantee: 'ref-not-mutated',
      });

      checkoutHandle = await DocumentFactory.create({
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      checkoutWb = await checkoutHandle.workbook({
        versioning: withVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        }),
      });
      const checkout = await checkoutWb.version.checkout({ kind: 'commit', id: mergeCommitId });
      if (!checkout.ok)
        throw new Error(`expected checkout after persisted merge apply: ${checkout.error.code}`);
      await expect(checkoutWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
      await expect(checkoutWb.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 'ours' });
      await expect(checkoutWb.activeSheet.getCell('C1')).resolves.toMatchObject({
        value: 'theirs',
      });
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (checkoutHandle) await checkoutHandle.dispose();
      if (secondReopenedWb) await secondReopenedWb.close('skipSave');
      if (secondReopenedHandle) await secondReopenedHandle.dispose();
      if (reopenedWb) await reopenedWb.close('skipSave');
      if (reopenedHandle) await reopenedHandle.dispose();
      if (branchWb) await branchWb.close('skipSave');
      await branchHandle.dispose();
      if (firstWb) await firstWb.close('skipSave');
      await firstHandle.dispose();
    }
  });

  it('recovers a staged resolved mergeCommit intent when the target ref already points at the merge commit', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, GRAPH_ID);
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    expectInitializeSuccess(
      await provider.initializeGraph({
        expectedRegistryRevision: null,
        graphId: GRAPH_ID,
        rootWrite: await rootWrite('merge-recovery-root'),
      }),
    );
    const failingProvider = failFirstIntentCompletion(provider);
    const firstHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const branchHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let firstWb: Workbook | undefined;
    let branchWb: Workbook | undefined;
    let reopenedHandle: Awaited<ReturnType<typeof DocumentFactory.create>> | undefined;
    let reopenedWb: Workbook | undefined;

    try {
      firstWb = await firstHandle.workbook({
        versioning: withVersionManifest({ provider: failingProvider }),
      });
      const rootHead = await expectHead(firstWb);

      await firstWb.activeSheet.setCell('A1', 'base');
      const baseCommit = await expectCommit(
        firstWb.version.commit({
          expectedHead: {
            commitId: rootHead.id,
            revision: requireRefRevision(rootHead),
          },
        }),
      );
      const baseHead = await expectHead(firstWb);

      const branch = await firstWb.version.createBranch({
        name: 'scenario/indexeddb-merge-recovery' as any,
        targetCommitId: baseCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

      await firstWb.activeSheet.setCell('A1', 'ours');
      const oursCommit = await expectCommit(
        firstWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      const oursHead = await expectHead(firstWb);

      branchWb = await branchHandle.workbook({
        versioning: withVersionManifest({ provider: failingProvider }),
      });
      const checkoutBase = await branchWb.version.checkout({ kind: 'commit', id: baseCommit.id });
      if (!checkoutBase.ok) {
        throw new Error(`expected branch workbook checkout success: ${checkoutBase.error.code}`);
      }
      await branchWb.activeSheet.setCell('A1', 'theirs');
      const theirsCommit = await expectCommit(
        branchWb.version.commit({
          targetRef: 'scenario/indexeddb-merge-recovery' as any,
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
      const preview = await firstWb.version.merge(
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
        throw new Error(`expected persisted conflicted preview success: ${preview.error.code}`);
      if (
        preview.value.status !== 'conflicted' ||
        !preview.value.resultId ||
        !preview.value.resultDigest ||
        !preview.value.previewArtifactDigest
      ) {
        throw new Error('expected persisted conflicted review artifact metadata');
      }

      const resolution = resolutionFor(preview.value.conflicts[0], 'acceptTheirs');
      const interrupted = await firstWb.version.applyMerge(
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
      expect(interrupted).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.applyMerge',
        },
      });
      const graph = await provider.openGraph(namespace, provider.accessContext);
      const currentRef = await graph.readRef('refs/heads/main' as any);
      expect(currentRef).toMatchObject({ status: 'success' });
      if (currentRef.status !== 'success' || !('commitId' in currentRef.ref)) {
        throw new Error('expected main ref to point at interrupted merge commit');
      }
      const mergeCommitId = currentRef.ref.commitId;
      const interruptedCommit = await graph.readCommit(mergeCommitId);
      expect(interruptedCommit).toMatchObject({
        status: 'success',
        commit: {
          payload: {
            parentCommitIds: [oursCommit.id, theirsCommit.id],
            resolvedMergeAttemptDigest: {
              algorithm: 'sha256',
              digest: expect.stringMatching(/^[0-9a-f]{64}$/),
            },
          },
        },
      });
      if (interruptedCommit.status !== 'success') {
        throw new Error(
          `expected interrupted merge commit read: ${interruptedCommit.diagnostics[0]?.code}`,
        );
      }
      const resolvedAttemptDigest = interruptedCommit.commit.payload.resolvedMergeAttemptDigest;
      if (!resolvedAttemptDigest) throw new Error('expected merge commit attempt digest');

      await branchWb.close('skipSave');
      branchWb = undefined;
      await branchHandle.dispose();
      await firstWb.close('skipSave');
      firstWb = undefined;
      await firstHandle.dispose();

      reopenedHandle = await DocumentFactory.create({
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      reopenedWb = await reopenedHandle.workbook({
        versioning: withVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        }),
      });

      const recovered = await reopenedWb.version.applyMerge(
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
      if (!recovered.ok) throw new Error(`expected merge intent recovery: ${recovered.error.code}`);
      expect(recovered.value).toMatchObject({
        status: 'alreadyApplied',
        commitRef: {
          id: mergeCommitId,
          refName: 'refs/heads/main',
          resolvedFrom: 'refs/heads/main',
        },
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        previewArtifactDigest: preview.value.previewArtifactDigest,
        resolvedAttemptDigest,
        targetRef: 'refs/heads/main',
        headBefore: oursCommit.id,
        headAfter: mergeCommitId,
        mutationGuarantee: 'ref-not-mutated',
      });
      const finalizedStore = await provider.openMergeApplyIntentStore(namespace);
      await expect(
        finalizedStore.readByIntentId(intentIdForResolvedAttemptDigest(resolvedAttemptDigest)),
      ).resolves.toMatchObject({
        status: 'found',
        record: {
          state: 'finalized',
          terminal: {
            status: 'applied',
            headBefore: oursCommit.id,
            headAfter: mergeCommitId,
            commitId: mergeCommitId,
            refCasProof: expect.objectContaining({ schemaVersion: 1, applyKind: 'mergeCommit' }),
          },
        },
      });
    } finally {
      if (reopenedWb) await reopenedWb.close('skipSave');
      if (reopenedHandle) await reopenedHandle.dispose();
      if (branchWb) await branchWb.close('skipSave');
      await branchHandle.dispose();
      if (firstWb) await firstWb.close('skipSave');
      await provider.close('test-teardown');
      await firstHandle.dispose();
    }
  });

  it('applies a persisted fast-forward result after provider-selection reopen', async () => {
    const firstHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let firstWb: Workbook | undefined;
    let reopenedHandle: Awaited<ReturnType<typeof DocumentFactory.create>> | undefined;
    let reopenedWb: Workbook | undefined;
    let checkoutHandle: Awaited<ReturnType<typeof DocumentFactory.create>> | undefined;
    let checkoutWb: Workbook | undefined;

    try {
      firstWb = await firstHandle.workbook({
        versioning: withVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
            initialize: {
              graphId: GRAPH_ID,
              rootWrite: await rootWrite('root'),
            },
          },
        }),
      });
      const rootHead = await expectHead(firstWb);

      await firstWb.activeSheet.setCell('A1', 'base');
      const baseCommit = await expectCommit(
        firstWb.version.commit({
          expectedHead: {
            commitId: rootHead.id,
            revision: requireRefRevision(rootHead),
          },
        }),
      );
      const baseHead = await expectHead(firstWb);

      await firstWb.activeSheet.setCell('B1', 'ours');
      const oursCommit = await expectCommit(
        firstWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      const oursHead = await expectHead(firstWb);

      const branch = await firstWb.version.createBranch({
        name: 'scenario/indexeddb-persisted-incoming' as any,
        targetCommitId: oursCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

      await firstWb.activeSheet.setCell('C1', 'theirs');
      const theirsCommit = await expectCommit(
        firstWb.version.commit({
          targetRef: 'scenario/indexeddb-persisted-incoming' as any,
          expectedHead: {
            commitId: oursCommit.id,
            revision: branch.value.revision,
          },
        }),
      );

      const expectedTargetHead = {
        commitId: oursCommit.id,
        revision: requireRefRevision(oursHead),
      };
      const preview = await firstWb.version.merge(
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
        throw new Error(`expected persisted merge preview success: ${preview.error.code}`);
      expect(preview.value).toMatchObject({
        status: 'fastForward',
        resultId: expect.stringMatching(/^merge-result:[0-9a-f]{64}$/),
        resultDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        attemptPersistence: 'persisted',
        attemptKind: 'applyable',
      });
      if (
        preview.value.status !== 'fastForward' ||
        !preview.value.resultId ||
        !preview.value.resultDigest
      ) {
        throw new Error('expected persisted fast-forward preview to expose result id and digest');
      }

      await firstWb.close('skipSave');
      firstWb = undefined;
      await firstHandle.dispose();

      reopenedHandle = await DocumentFactory.create({
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      reopenedWb = await reopenedHandle.workbook({
        versioning: withVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        }),
      });

      const applied = await reopenedWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
        },
      );
      if (!applied.ok)
        throw new Error(`expected persisted apply success after reopen: ${applied.error.code}`);
      expect(applied.value).toMatchObject({
        status: 'fastForwarded',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        commitRef: {
          id: theirsCommit.id,
          refName: 'refs/heads/main',
          resolvedFrom: 'refs/heads/main',
        },
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        targetRef: 'refs/heads/main',
        headBefore: oursCommit.id,
        headAfter: theirsCommit.id,
        mutationGuarantee: 'ref-fast-forwarded',
      });

      checkoutHandle = await DocumentFactory.create({
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      checkoutWb = await checkoutHandle.workbook({
        versioning: withVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        }),
      });
      const checkout = await checkoutWb.version.checkout({ kind: 'commit', id: theirsCommit.id });
      if (!checkout.ok)
        throw new Error(`expected checkout after persisted apply: ${checkout.error.code}`);
      await expect(checkoutWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
      await expect(checkoutWb.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 'ours' });
      await expect(checkoutWb.activeSheet.getCell('C1')).resolves.toMatchObject({
        value: 'theirs',
      });
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (checkoutHandle) await checkoutHandle.dispose();
      if (reopenedWb) await reopenedWb.close('skipSave');
      if (reopenedHandle) await reopenedHandle.dispose();
      if (firstWb) await firstWb.close('skipSave');
      await firstHandle.dispose();
    }
  });

  it('finalizes a staged fast-forward intent when the target ref was already moved before retry', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, GRAPH_ID);
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    expectInitializeSuccess(
      await provider.initializeGraph({
        expectedRegistryRevision: null,
        graphId: GRAPH_ID,
        rootWrite: await rootWrite('recovery-root'),
      }),
    );

    const firstHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let firstWb: Workbook | undefined;
    let reopenedProvider: ReturnType<typeof createIndexedDbVersionStoreProvider> | undefined;
    let reopenedHandle: Awaited<ReturnType<typeof DocumentFactory.create>> | undefined;
    let reopenedWb: Workbook | undefined;

    try {
      firstWb = await firstHandle.workbook({ versioning: withVersionManifest({ provider }) });
      const rootHead = await expectHead(firstWb);

      await firstWb.activeSheet.setCell('A1', 'base');
      const baseCommit = await expectCommit(
        firstWb.version.commit({
          expectedHead: {
            commitId: rootHead.id,
            revision: requireRefRevision(rootHead),
          },
        }),
      );
      const baseHead = await expectHead(firstWb);

      await firstWb.activeSheet.setCell('B1', 'ours');
      const oursCommit = await expectCommit(
        firstWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      const oursHead = await expectHead(firstWb);

      const branch = await firstWb.version.createBranch({
        name: 'scenario/indexeddb-recovery-incoming' as any,
        targetCommitId: oursCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

      await firstWb.activeSheet.setCell('C1', 'theirs');
      const theirsCommit = await expectCommit(
        firstWb.version.commit({
          targetRef: 'scenario/indexeddb-recovery-incoming' as any,
          expectedHead: {
            commitId: oursCommit.id,
            revision: branch.value.revision,
          },
        }),
      );

      const expectedTargetHead = {
        commitId: oursCommit.id,
        revision: requireRefRevision(oursHead),
      };
      const preview = await firstWb.version.merge(
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
        throw new Error(`expected persisted merge preview success: ${preview.error.code}`);
      if (
        preview.value.status !== 'fastForward' ||
        !preview.value.resultId ||
        !preview.value.resultDigest
      ) {
        throw new Error('expected persisted fast-forward preview to expose result id and digest');
      }

      const intentId = intentIdForMergeResultId(preview.value.resultId);
      if (!intentId) throw new Error('expected resultId to map to an intent id');
      const intentStore = await provider.openMergeApplyIntentStore(namespace);
      const stagedIntent = await intentStore.readByIntentId(intentId);
      expect(stagedIntent).toMatchObject({
        status: 'found',
        record: { state: 'staging' },
      });
      if (stagedIntent.status !== 'found') throw new Error('expected staged intent to be readable');
      expect(stagedIntent.record.terminal).toBeUndefined();

      const graph = await provider.openGraph(namespace, provider.accessContext);
      const simulatedRefMove = await graph.fastForwardRef({
        targetRef: 'refs/heads/main' as any,
        expectedHeadCommitId: oursCommit.id,
        expectedTargetRefVersion: expectedTargetHead.revision,
        nextCommitId: theirsCommit.id,
        updatedBy: AUTHOR,
      });
      expect(simulatedRefMove).toMatchObject({
        status: 'success',
        commit: { id: theirsCommit.id },
        ref: { name: 'refs/heads/main' },
      });

      await firstWb.close('skipSave');
      firstWb = undefined;
      await firstHandle.dispose();
      await provider.close('test-teardown');

      reopenedProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
      reopenedHandle = await DocumentFactory.create({
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      reopenedWb = await reopenedHandle.workbook({
        versioning: withVersionManifest({ provider: reopenedProvider }),
      });

      const recovered = await reopenedWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
        },
      );
      if (!recovered.ok)
        throw new Error(`expected persisted apply recovery success: ${recovered.error.code}`);
      expect(recovered.value).toMatchObject({
        status: 'alreadyApplied',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        commitRef: {
          id: theirsCommit.id,
          refName: 'refs/heads/main',
          resolvedFrom: 'refs/heads/main',
        },
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        targetRef: 'refs/heads/main',
        headBefore: oursCommit.id,
        headAfter: theirsCommit.id,
        changes: [],
        resolutionCount: 0,
        mutationGuarantee: 'ref-not-mutated',
      });

      const finalizedStore = await reopenedProvider.openMergeApplyIntentStore(namespace);
      await expect(finalizedStore.readByIntentId(intentId)).resolves.toMatchObject({
        status: 'found',
        record: {
          state: 'finalized',
          terminal: {
            status: 'fastForwarded',
            headBefore: oursCommit.id,
            headAfter: theirsCommit.id,
            commitId: theirsCommit.id,
          },
        },
      });
    } finally {
      if (reopenedWb) await reopenedWb.close('skipSave');
      if (reopenedHandle) await reopenedHandle.dispose();
      if (reopenedProvider) await reopenedProvider.close('test-teardown');
      if (firstWb) await firstWb.close('skipSave');
      await provider.close('test-teardown');
      await firstHandle.dispose();
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

function failFirstIntentCompletion(
  provider: IndexedDbVersionStoreProvider,
): IndexedDbVersionStoreProvider {
  let shouldFailCompletion = true;
  const openStore = provider.openMergeApplyIntentStore.bind(provider);
  provider.openMergeApplyIntentStore = async (namespace) => {
    const store = await openStore(namespace);
    return {
      namespace: store.namespace,
      beginIntent: store.beginIntent.bind(store),
      readByIntentId: store.readByIntentId.bind(store),
      readByIdempotencyKey: store.readByIdempotencyKey.bind(store),
      completeIntent: async (input) => {
        if (!shouldFailCompletion) return store.completeIntent(input);
        shouldFailCompletion = false;
        return {
          status: 'failed',
          record: null,
          diagnostics: [
            {
              code: 'VERSION_PROVIDER_FAILED',
              message: 'Injected merge intent completion failure.',
              recoverability: 'retry',
            },
          ],
        };
      },
    } satisfies MergeApplyIntentStore;
  };
  return provider;
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}
