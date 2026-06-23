import { jest } from '@jest/globals';

import {
  createWorkbookVersionCommitService,
  type VersionNormalCommitCaptureFinalizeResult,
} from '../commit-service';
import { createInMemoryVersionStoreProvider } from '../provider';
import {
  DOCUMENT_SCOPE,
  createNormalCommitCaptureWithInvalidSemanticRecord,
  createNormalCommitCaptureWithoutMutationSegments,
  createNormalCommitCaptureWithoutSnapshotRoot,
  createThrowingNormalCommitCapture,
  expectFailedFinalize,
  expectInitializeSuccess,
  expectMainRefUnchanged,
  expectPublicSafeDiagnostics,
  initializeInput,
} from './commit-service-test-support';

export function registerCommitServiceNormalCaptureFailureScenarios(): void {
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
