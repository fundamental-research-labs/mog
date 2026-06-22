import { jest } from '@jest/globals';
import { classifyLegacyRawUpdate } from '@mog-sdk/types-document/storage';
import type { BridgeTransport } from '@rust-bridge/client';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';

import { ComputeCore } from '../compute-core';
import type { MutationResult } from '../compute-types.gen';
import type { MutationAdmissionDiagnostic } from '../mutation-admission';
import { createAdmittedSyncApplyContext } from '../sync-apply-admission';

(globalThis as any).window = {};

function mutationResult(): MutationResult {
  return {
    recalc: {
      changedCells: [],
      projectionChanges: [],
      errors: [],
      validationAnnotations: [],
      metrics: {},
    },
  } as MutationResult;
}

function makeMockContext(
  diagnostics: MutationAdmissionDiagnostic[],
): IKernelContext {
  return {
    eventBus: { emit: jest.fn(), on: jest.fn(() => () => {}), off: jest.fn() },
    setPendingUndoDescription: jest.fn(),
    getPendingUndoDescription: jest.fn(() => null),
    clearPendingUndoDescription: jest.fn(),
    destroy: jest.fn(),
    versioningAdmissionDiagnostics: {
      record: (diagnostic: MutationAdmissionDiagnostic) => diagnostics.push(diagnostic),
    },
  } as unknown as IKernelContext;
}

function createStartedCore(
  ctx: IKernelContext,
  transport: BridgeTransport,
): ComputeCore {
  const core = new ComputeCore(ctx, 'test-doc', transport);
  (core as any)._phase = 'STARTED';
  (core as any).engineCreated = true;
  return core;
}

function makeLegacyRawContext(payloadHash: string) {
  const provenance = classifyLegacyRawUpdate({
    payloadHash,
    updateId: `test-sync:${payloadHash}`,
  });
  return createAdmittedSyncApplyContext({
    source: 'test',
    docId: 'test-doc',
    envelopeVersion: 'classified-raw',
    updateId: provenance.updateIdentity.updateId,
    payloadHash,
    provenance,
  });
}

describe('sync apply admission', () => {
  it('rejects raw sync mutations without admitted provenance context before transport', async () => {
    const diagnostics: MutationAdmissionDiagnostic[] = [];
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), mutationResult()]),
    };
    const core = createStartedCore(makeMockContext(diagnostics), transport);

    await expect(core.syncApply(new Uint8Array([1, 2, 3]), undefined as never)).rejects.toThrow(
      'compute_apply_sync_update: provenance.missingContext',
    );

    expect(transport.call).not.toHaveBeenCalled();
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'provenance.missingContext',
        severity: 'error',
        command: 'compute_apply_sync_update',
      }),
    );
  });

  it('rejects forged sync admission context objects before transport', async () => {
    const diagnostics: MutationAdmissionDiagnostic[] = [];
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), mutationResult()]),
    };
    const core = createStartedCore(makeMockContext(diagnostics), transport);
    const forged = {
      source: 'forged',
      docId: 'test-doc',
      envelopeVersion: 'classified-raw',
      payloadHash: '0'.repeat(64),
      provenance: classifyLegacyRawUpdate({ payloadHash: '0'.repeat(64) }),
      validationDiagnostics: [],
    };

    await expect(core.syncApply(new Uint8Array([1]), forged as never)).rejects.toThrow(
      'compute_apply_sync_update: provenance.invalidContext',
    );

    expect(transport.call).not.toHaveBeenCalled();
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'provenance.invalidContext',
        severity: 'error',
        command: 'compute_apply_sync_update',
      }),
    );
  });

  it('admits raw sync mutations with a branded sync provenance context', async () => {
    const diagnostics: MutationAdmissionDiagnostic[] = [];
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), mutationResult()]),
    };
    const core = createStartedCore(makeMockContext(diagnostics), transport);
    const payloadHash = '1'.repeat(64);

    await core.syncApply(new Uint8Array([1]), makeLegacyRawContext(payloadHash));

    expect(transport.call).toHaveBeenCalledWith('compute_apply_sync_update', {
      docId: 'test-doc',
      update: new Uint8Array([1]),
    });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'versioning.admission.missing-context',
        severity: 'warning',
        command: 'compute_apply_sync_update',
      }),
    );
    expect(diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'provenance.missingContext' }),
    );
  });
});

