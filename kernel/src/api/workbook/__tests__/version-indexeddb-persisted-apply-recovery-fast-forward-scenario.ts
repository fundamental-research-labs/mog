import { it } from '@jest/globals';

import {
  DOCUMENT_ID,
  DOCUMENT_SCOPE,
  DocumentFactory,
  createIndexedDbVersionStoreProvider,
  withVersionManifest,
  type Workbook,
} from './version-indexeddb-persisted-apply-recovery-test-utils';
import { expectRecoveredFastForwardAlreadyApplied } from './version-indexeddb-persisted-apply-recovery-fast-forward-assertions';
import { stageFastForwardIntentAfterTargetRefMove } from './version-indexeddb-persisted-apply-recovery-fast-forward-stage';

type DocumentHandle = Awaited<ReturnType<typeof DocumentFactory.create>>;

const MAIN_REF = 'refs/heads/main' as any;

export function registerFastForwardRecoveryScenario(): void {
  it('finalizes a staged fast-forward intent when the target ref was already moved before retry', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    let reopenedProvider: ReturnType<typeof createIndexedDbVersionStoreProvider> | undefined;
    let reopenedHandle: DocumentHandle | undefined;
    let reopenedWb: Workbook | undefined;

    try {
      const stage = await stageFastForwardIntentAfterTargetRefMove(provider);
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
          resultId: stage.preview.resultId,
          resultDigest: stage.preview.resultDigest,
        },
        {
          targetRef: MAIN_REF,
          expectedTargetHead: stage.expectedTargetHead,
        },
      );
      if (!recovered.ok)
        throw new Error(`expected persisted apply recovery success: ${recovered.error.code}`);

      await expectRecoveredFastForwardAlreadyApplied(reopenedProvider, recovered.value, stage);
    } finally {
      if (reopenedWb) await reopenedWb.close('skipSave');
      if (reopenedHandle) await reopenedHandle.dispose();
      if (reopenedProvider) await reopenedProvider.close('test-teardown');
      await provider.close('test-teardown');
    }
  });
}
