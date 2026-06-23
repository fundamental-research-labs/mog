import { jest } from '@jest/globals';

import {
  createWorkbookVersionCommitService,
  type VersionNormalCommitCaptureFinalizeResult,
} from '../commit-service';
import { createInMemoryVersionStoreProvider } from '../provider';
import {
  DOCUMENT_SCOPE,
  createNormalCommitCaptureWithInvalidSemanticRecord,
  expectFailedFinalize,
  expectInitializeSuccess,
  expectMainRefUnchanged,
  expectPublicSafeDiagnostics,
  initializeInput,
} from './commit-service-test-support';

export function registerCommitServiceNormalCaptureFailureGraphWriteScenarios(): void {
  it('finalizes failed normal captures when graph commit creation fails without moving refs', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const forbiddenPayload = 'raw-capture-secret-graph-write';
    const finalize = jest.fn((_: VersionNormalCommitCaptureFinalizeResult) => undefined);
    const captureNormalCommit = jest.fn(
      createNormalCommitCaptureWithInvalidSemanticRecord(
        'graph-write-fails',
        finalize,
        forbiddenPayload,
      ),
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
      mutationGuarantee: 'ref-not-mutated',
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_MISSING_DEPENDENCY',
          operation: 'commitGraphWrite',
          recoverability: 'repair',
          redacted: true,
        }),
      ],
    });
    if (failed.status !== 'failed') {
      throw new Error('expected commit creation failure');
    }
    expect(captureNormalCommit).toHaveBeenCalledTimes(1);
    expectFailedFinalize(finalize, failed.diagnostics);
    expectPublicSafeDiagnostics(failed.diagnostics, forbiddenPayload);
    await expectMainRefUnchanged(provider, initialized);
  });
}
