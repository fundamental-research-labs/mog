import { jest } from '@jest/globals';

import { createWorkbookVersionCommitService } from '../commit-service';
import { createInMemoryVersionStoreProvider } from '../provider';
import {
  DOCUMENT_SCOPE,
  createNormalCommitCapture,
  expectInitializeSuccess,
  expectMainRefUnchanged,
  expectPublicSafeDiagnostics,
  initializeInput,
} from './commit-service-test-support';

export function registerCommitServiceOptionValidationScenarios(): void {
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
}
