import type { VersionGraphNamespace } from '../object-store';
import {
  createWorkbookSnapshotRootRecord,
  createYrsFullStateSnapshotRootPayload,
  decodeYrsFullStateSnapshotRootPayload,
} from '../snapshot-root-capture';
import {
  createSnapshotRootReloadService,
  type SnapshotRootFreshLifecycleHydrationInput,
  type SnapshotRootReloadDiagnostic,
} from '../snapshot-root-reload-service';

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

const FULL_STATE_BYTES = new Uint8Array([0, 7, 14, 21, 28, 35]);

describe('SnapshotRootReloadService', () => {
  it('validates and decodes a workbook snapshot-root record before hydrating a fresh lifecycle', async () => {
    const payload = createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES);
    const record = await createWorkbookSnapshotRootRecord(NAMESPACE, payload);
    const hydrationInputs: SnapshotRootFreshLifecycleHydrationInput[] = [];
    const service = createSnapshotRootReloadService<{ readonly documentId: string }>({
      hydrator: {
        hydrateYrsFullState: async (input) => {
          hydrationInputs.push(input);
          return {
            status: 'materialized',
            materialized: { documentId: 'fresh-document' },
          };
        },
      },
    });

    const result = await service.reloadSnapshotRoot(record);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected reload success: ${result.error.code}`);
    expect(result.materialization).toBe('fresh-lifecycle');
    expect(result.materialized).toEqual({ documentId: 'fresh-document' });
    expect(result.decodedByteLength).toBe(FULL_STATE_BYTES.byteLength);
    expect(result.mutationGuarantee).toBe('no-current-workbook-mutation');
    expect(result.freshLifecycleMutationGuarantee).toBe('fresh-lifecycle-materialized');
    expect(hydrationInputs).toHaveLength(1);
    expect(hydrationInputs[0]).toMatchObject({
      byteLength: FULL_STATE_BYTES.byteLength,
      source: 'record',
      objectDigest: record.digest,
    });
    expect(hydrationInputs[0].objectDigest).not.toBe(record.digest);
    expect(Array.from(hydrationInputs[0].yrsFullStateBytes)).toEqual([...FULL_STATE_BYTES]);
  });

  it('does not let the hydrator mutate the original snapshot-root payload bytes', async () => {
    const payload = createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES);
    const observedBytes: number[][] = [];
    const service = createSnapshotRootReloadService({
      hydrator: {
        hydrateYrsFullState: async (input) => {
          observedBytes.push([...input.yrsFullStateBytes]);
          input.yrsFullStateBytes.fill(255);
          return {
            status: 'materialized',
            materialized: undefined,
          };
        },
      },
    });

    const first = await service.reloadSnapshotRoot(payload);
    const second = await service.reloadSnapshotRoot(payload);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(observedBytes).toEqual([[...FULL_STATE_BYTES], [...FULL_STATE_BYTES]]);
    expect(Array.from(decodeYrsFullStateSnapshotRootPayload(payload))).toEqual([
      ...FULL_STATE_BYTES,
    ]);
  });

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
});
