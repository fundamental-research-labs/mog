import { createYrsFullStateSnapshotRootPayload } from '../snapshot-root-capture';
import {
  createSnapshotRootReloadService,
  type SnapshotRootReloadDiagnostic,
} from '../snapshot-root-reload-service';

import { FULL_STATE_BYTES } from './snapshot-root-reload-service-test-helpers';

export function registerSnapshotRootReloadServiceFailureScenarios(): void {
  it('fails closed with structured diagnostics for legacy synthetic sheet-list roots', async () => {
    let hydrateCalls = 0;
    const service = createSnapshotRootReloadService({
      hydrator: {
        hydrateYrsFullState: async () => {
          hydrateCalls += 1;
          return {
            status: 'materialized',
            materialized: undefined,
          };
        },
      },
    });

    const result = await service.reloadSnapshotRoot({ sheets: [] });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected reload failure');
    expect(hydrateCalls).toBe(0);
    expect(result.error.code).toBe('invalidSnapshotRoot');
    expect(result.mutationGuarantee).toBe('no-current-workbook-mutation');
    expect(result.freshLifecycleMutationGuarantee).toBe('not-started');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_SNAPSHOT_ROOT_RELOAD_INVALID_ROOT',
        severity: 'error',
        path: 'snapshotRoot',
        details: expect.objectContaining({
          captureCode: 'SNAPSHOT_ROOT_INVALID_PAYLOAD',
        }),
      }),
    ]);
  });

  it('returns structured failure when the hydrator rejects materialization', async () => {
    const payload = createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES);
    const hydratorDiagnostic: SnapshotRootReloadDiagnostic = {
      code: 'VERSION_SNAPSHOT_ROOT_RELOAD_HYDRATOR_REJECTED',
      severity: 'error',
      message: 'Fresh lifecycle reported an admission failure.',
    };
    const service = createSnapshotRootReloadService({
      hydrator: {
        hydrateYrsFullState: async () => ({
          status: 'failed',
          diagnostics: [hydratorDiagnostic],
          freshLifecycleMutationGuarantee: 'no-fresh-lifecycle-mutation',
        }),
      },
    });

    const result = await service.reloadSnapshotRoot(payload);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected reload failure');
    expect(result.error.code).toBe('hydratorRejected');
    expect(result.decodedByteLength).toBe(FULL_STATE_BYTES.byteLength);
    expect(result.mutationGuarantee).toBe('no-current-workbook-mutation');
    expect(result.freshLifecycleMutationGuarantee).toBe('no-fresh-lifecycle-mutation');
    expect(result.diagnostics).toEqual([hydratorDiagnostic]);
    expect('materialized' in result).toBe(false);
  });

  it('captures thrown hydrator failures without reporting materialized success', async () => {
    const payload = createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES);
    const service = createSnapshotRootReloadService({
      hydrator: {
        hydrateYrsFullState: async () => {
          throw new Error('fresh lifecycle failed');
        },
      },
    });

    const result = await service.reloadSnapshotRoot(payload);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected reload failure');
    expect(result.error.code).toBe('hydratorFailed');
    expect(result.freshLifecycleMutationGuarantee).toBe('unknown-after-hydrator-failure');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_SNAPSHOT_ROOT_RELOAD_HYDRATOR_FAILED',
        details: { cause: 'Error' },
      }),
    ]);
    expect('materialized' in result).toBe(false);
  });
}
