import { jest } from '@jest/globals';

import {
  createWorkbookVersionCommitService,
  type VersionNormalCommitCaptureFinalizeResult,
} from '../commit-service';
import { createProviderBackedBranchLifecycleService } from '../branch-provider-service';
import { VERSION_GRAPH_MAIN_REF } from '../graph-store';
import { createInMemoryVersionStoreProvider, namespaceForDocumentScope } from '../provider';
import {
  DOCUMENT_SCOPE,
  VERSION_AUTHOR,
  createNormalCommitCapture,
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

describe('WorkbookVersionCommitService', () => {
  it('normalizes direct branch-name targetRef commits to concrete provider refs', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const branchService = createProviderBackedBranchLifecycleService({ provider });
    const branch = await branchService.createBranch({
      name: 'scenario/direct-service',
      targetCommitId: initialized.rootCommit.id,
      expectedAbsent: true,
      createdBy: VERSION_AUTHOR,
    });
    expect(branch).toMatchObject({
      ok: true,
      branch: {
        name: 'scenario/direct-service',
        ref: {
          targetCommitId: initialized.rootCommit.id,
          refVersion: { kind: 'counter', value: '0' },
        },
      },
    });
    const captureNormalCommit = jest.fn(createNormalCommitCapture('branch-child'));
    const service = createWorkbookVersionCommitService({
      provider,
      captureNormalCommit,
    });

    const committed = await service.commit({
      targetRef: 'scenario/direct-service' as any,
      expectedHead: {
        commitId: initialized.rootCommit.id,
        revision: { kind: 'counter', value: '0' },
      },
    });

    expect(captureNormalCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        currentRef: expect.objectContaining({
          name: 'refs/heads/scenario/direct-service',
          commitId: initialized.rootCommit.id,
        }),
        options: expect.objectContaining({
          targetRef: 'refs/heads/scenario/direct-service',
        }),
      }),
    );
    expect(committed).toMatchObject({
      status: 'success',
      commitRef: {
        refName: 'refs/heads/scenario/direct-service',
        resolvedFrom: 'refs/heads/scenario/direct-service',
        refRevision: { kind: 'counter', value: '1' },
      },
      main: {
        commitId: initialized.rootCommit.id,
        revision: initialized.initialHead.revision,
      },
    });
    if (committed.status !== 'success') {
      throw new Error(`expected branch commit success: ${committed.diagnostics[0]?.code}`);
    }

    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    await expect(graph.readRef('refs/heads/scenario/direct-service')).resolves.toMatchObject({
      status: 'success',
      ref: {
        name: 'refs/heads/scenario/direct-service',
        commitId: committed.commit.id,
        revision: { kind: 'counter', value: '1' },
      },
    });
    await expect(graph.readRef(VERSION_GRAPH_MAIN_REF)).resolves.toMatchObject({
      status: 'success',
      ref: {
        name: VERSION_GRAPH_MAIN_REF,
        commitId: initialized.rootCommit.id,
        revision: initialized.initialHead.revision,
      },
    });
  });

  it.each([
    ['root', 'raw-root-mode-secret'],
    ['import-root', 'raw-import-root-mode-secret'],
  ])(
    'rejects direct %s commit modes with public-safe diagnostics before capture',
    async (kind, forbiddenPayload) => {
      const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
      const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
      expectInitializeSuccess(initialized);
      const captureNormalCommit = jest.fn(createNormalCommitCapture('must-not-run'));
      const service = createWorkbookVersionCommitService({
        provider,
        captureNormalCommit,
      });

      const failed = await service.commit({
        mode: { kind, rawPayload: forbiddenPayload },
      } as any);

      expect(failed).toMatchObject({
        status: 'failed',
        mutationGuarantee: 'no-write-attempted',
        retryable: false,
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            operation: 'commitGraphWrite',
            recoverability: 'none',
            mutationGuarantee: 'no-write-attempted',
            details: { option: 'mode.kind', issue: kind },
          }),
        ],
      });
      if (failed.status !== 'failed') {
        throw new Error('expected direct root/import mode rejection');
      }
      expect(captureNormalCommit).not.toHaveBeenCalled();
      expectPublicSafeDiagnostics(failed.diagnostics, forbiddenPayload);
      await expectMainRefUnchanged(provider, initialized);
    },
  );

  it('rejects malformed direct commit modes without leaking raw mode values', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const forbiddenPayload = 'raw-unsupported-mode-secret';
    const captureNormalCommit = jest.fn(createNormalCommitCapture('must-not-run'));
    const service = createWorkbookVersionCommitService({
      provider,
      captureNormalCommit,
    });

    const failed = await service.commit({
      mode: { kind: forbiddenPayload, rawPayload: forbiddenPayload },
    } as any);

    expect(failed).toMatchObject({
      status: 'failed',
      mutationGuarantee: 'no-write-attempted',
      retryable: false,
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_INVALID_OPTIONS',
          operation: 'commitGraphWrite',
          recoverability: 'none',
          mutationGuarantee: 'no-write-attempted',
          details: { option: 'mode.kind', issue: 'unsupportedMode' },
        }),
      ],
    });
    if (failed.status !== 'failed') {
      throw new Error('expected malformed mode rejection');
    }
    expect(captureNormalCommit).not.toHaveBeenCalled();
    expectPublicSafeDiagnostics(failed.diagnostics, forbiddenPayload);
    await expectMainRefUnchanged(provider, initialized);
  });

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
});
