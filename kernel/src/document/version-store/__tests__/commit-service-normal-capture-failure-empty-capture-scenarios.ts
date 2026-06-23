import { jest } from '@jest/globals';

import {
  createWorkbookVersionCommitService,
  type VersionNormalCommitCaptureFinalizeResult,
} from '../commit-service';
import { createInMemoryVersionStoreProvider } from '../provider';
import {
  DOCUMENT_SCOPE,
  createNormalCommitCaptureWithoutMutationSegments,
  expectFailedFinalize,
  expectInitializeSuccess,
  expectMainRefUnchanged,
  expectPublicSafeDiagnostics,
  initializeInput,
} from './commit-service-test-support';

export function registerCommitServiceNormalCaptureFailureEmptyCaptureScenarios(): void {
  it('finalizes empty normal captures as missing change sets without moving refs', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const forbiddenPayload = 'raw-empty-capture-secret';
    const finalize = jest.fn((_: VersionNormalCommitCaptureFinalizeResult) => undefined);
    const captureNormalCommit = jest.fn(
      createNormalCommitCaptureWithoutMutationSegments('empty-capture', finalize, forbiddenPayload),
    );
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
      retryable: false,
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_MISSING_CHANGE_SET',
          operation: 'commitGraphWrite',
          recoverability: 'repair',
          mutationGuarantee: 'no-write-attempted',
          redacted: true,
        }),
      ],
    });
    if (failed.status !== 'failed') {
      throw new Error('expected missing change set failure');
    }
    expect(captureNormalCommit).toHaveBeenCalledTimes(1);
    expectFailedFinalize(finalize, failed.diagnostics);
    expectPublicSafeDiagnostics(failed.diagnostics, forbiddenPayload);
    await expectMainRefUnchanged(provider, initialized);
  });
}
