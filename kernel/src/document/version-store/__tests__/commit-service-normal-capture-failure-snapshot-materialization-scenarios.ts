import { jest } from '@jest/globals';

import {
  createWorkbookVersionCommitService,
  type VersionNormalCommitCaptureFinalizeResult,
} from '../commit-service';
import { createInMemoryVersionStoreProvider } from '../provider';
import {
  DOCUMENT_SCOPE,
  createNormalCommitCaptureWithoutSnapshotRoot,
  expectFailedFinalize,
  expectInitializeSuccess,
  expectMainRefUnchanged,
  expectPublicSafeDiagnostics,
  initializeInput,
} from './commit-service-test-support';

export function registerCommitServiceNormalCaptureFailureSnapshotMaterializationScenarios(): void {
  it('finalizes failed normal captures when snapshot materialization fails without moving refs', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const forbiddenPayload = 'raw-snapshot-secret-materialization';
    const finalize = jest.fn((_: VersionNormalCommitCaptureFinalizeResult) => undefined);
    const captureNormalCommit = jest.fn(
      createNormalCommitCaptureWithoutSnapshotRoot('materialization-fails', finalize),
    );
    const service = createWorkbookVersionCommitService({
      provider,
      captureNormalCommit,
      snapshotRootByteSyncPort: {
        encodeDiff: async () => {
          throw new Error(forbiddenPayload);
        },
      },
    });

    const failed = await service.commit({
      expectedHead: {
        commitId: initialized.rootCommit.id,
        revision: initialized.initialHead.revision,
      },
    });

    expect(failed).toMatchObject({
      status: 'failed',
      mutationGuarantee: 'no-write-attempted',
      retryable: true,
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_PROVIDER_FAILED',
          operation: 'commitGraphWrite',
          recoverability: 'retry',
          redacted: true,
        }),
      ],
    });
    if (failed.status !== 'failed') {
      throw new Error('expected snapshot materialization failure');
    }
    expect(captureNormalCommit).toHaveBeenCalledTimes(1);
    expectFailedFinalize(finalize, failed.diagnostics);
    expectPublicSafeDiagnostics(failed.diagnostics, forbiddenPayload);
    await expectMainRefUnchanged(provider, initialized);
  });
}
