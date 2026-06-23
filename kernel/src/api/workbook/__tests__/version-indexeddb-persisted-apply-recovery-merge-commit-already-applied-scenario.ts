import { it } from '@jest/globals';

import {
  DOCUMENT_ID,
  DocumentFactory,
  INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
  createIndexedDbVersionStoreProvider,
  withVersionManifest,
  type Workbook,
} from './version-indexeddb-persisted-apply-recovery-test-utils';
import { expectRecoveredMergeCommitAlreadyApplied } from './version-indexeddb-persisted-apply-recovery-merge-commit-assertions';
import { stageInterruptedResolvedMergeCommitIntent } from './version-indexeddb-persisted-apply-recovery-merge-commit-stage';

type DocumentHandle = Awaited<ReturnType<typeof DocumentFactory.create>>;

const MAIN_REF = 'refs/heads/main' as any;

export function registerAlreadyAppliedMergeCommitRecoveryScenario(): void {
  it('recovers a staged resolved mergeCommit intent when the target ref already points at the merge commit', async () => {
    const provider = createIndexedDbVersionStoreProvider({
      documentScope: { documentId: DOCUMENT_ID },
    });
    let reopenedHandle: DocumentHandle | undefined;
    let reopenedWb: Workbook | undefined;

    try {
      const stage = await stageInterruptedResolvedMergeCommitIntent(provider);

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
          resultId: stage.preview.resultId,
          resultDigest: stage.preview.resultDigest,
          previewArtifactDigest: stage.preview.previewArtifactDigest,
          resolutions: [stage.resolution],
        },
        {
          targetRef: MAIN_REF,
          expectedTargetHead: stage.expectedTargetHead,
        },
      );
      if (!recovered.ok) throw new Error(`expected merge intent recovery: ${recovered.error.code}`);

      await expectRecoveredMergeCommitAlreadyApplied(provider, recovered.value, stage);
    } finally {
      if (reopenedWb) await reopenedWb.close('skipSave');
      if (reopenedHandle) await reopenedHandle.dispose();
      await provider.close('test-teardown');
    }
  });
}
