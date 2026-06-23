import { jest } from '@jest/globals';

import { createWorkbookVersionCommitService } from '../commit-service';
import { createInMemoryVersionStoreProvider } from '../provider';
import {
  DOCUMENT_SCOPE,
  createThrowingNormalCommitCapture,
  expectInitializeSuccess,
  expectMainRefUnchanged,
  expectPublicSafeDiagnostics,
  initializeInput,
} from './commit-service-test-support';

export function registerCommitServiceNormalCaptureFailureThrownCaptureScenarios(): void {
  it('maps thrown normal captures to retryable public-safe failures without moving refs', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const forbiddenPayload = 'raw-normal-capture-throw-secret';
    const captureNormalCommit = jest.fn(createThrowingNormalCommitCapture(forbiddenPayload));
    const service = createWorkbookVersionCommitService({
      provider,
      captureNormalCommit,
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
          mutationGuarantee: 'no-write-attempted',
          redacted: true,
        }),
      ],
    });
    if (failed.status !== 'failed') {
      throw new Error('expected thrown capture failure');
    }
    expect(captureNormalCommit).toHaveBeenCalledTimes(1);
    expectPublicSafeDiagnostics(failed.diagnostics, forbiddenPayload);
    await expectMainRefUnchanged(provider, initialized);
  });
}
