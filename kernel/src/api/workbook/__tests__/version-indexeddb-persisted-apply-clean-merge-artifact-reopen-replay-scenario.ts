import { expect, it } from '@jest/globals';
import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  INDEXEDDB_PERSISTED_APPLY_DOCUMENT_ID as DOCUMENT_ID,
  INDEXEDDB_PERSISTED_APPLY_GRAPH_ID as GRAPH_ID,
  rootWrite,
} from './version-indexeddb-persisted-apply-test-utils';
import {
  expectCommit,
  expectHead,
  requireRefRevision,
} from './version-indexeddb-persisted-apply-test-helpers';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb-backend';

export function describeIndexedDbPersistedApplyCleanMergeArtifactReopenReplayScenario(): void {
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
}
