import { jest } from '@jest/globals';
import {
  classifyLegacyRawUpdate,
  DEFAULT_PROVENANCE_REDACTION_POLICY,
  type SyncUpdateProvenance,
} from '@mog-sdk/types-document/storage';
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

function makeVerifiedProviderContext(payloadHash: string) {
  const provenance: SyncUpdateProvenance = {
    schemaVersion: 'sync-update-provenance-v1',
    sourceKind: 'providerLiveInbound',
    updateIdentity: {
      originKind: 'provider',
      stableOriginId: 'provider-stable-1',
      providerId: 'provider-stable-1',
      providerKind: 'test-provider',
      providerRefId: 'provider-ref-1',
      authorityRef: 'authority-1',
      epoch: 'epoch-1',
      updateId: 'remote-update-1',
      sequence: 7n,
      payloadHash,
      provenancePayloadHash: '2'.repeat(64),
    },
    trust: {
      status: 'verified',
      authorityRef: 'authority-1',
      proofKind: 'signed-provider-message',
      proofCoverage: [
        'sourceKind',
        'originKind',
        'stableOriginId',
        'providerId',
        'providerKind',
        'providerRefId',
        'authorityRef',
        'authorState',
        'provenanceRedactionPolicy',
        'provenancePayloadHash',
        'payloadHash',
        'updateId',
        'epoch',
        'remoteSessionId',
        'remoteAuthorRef',
      ],
      issuer: 'issuer-1',
    },
    author: {
      kind: 'singleRemote',
      remoteAuthorRef: {
        kind: 'opaque-subject-ref',
        value: 'subject-ref-1',
      },
    },
    remoteSessionId: 'remote-session-1',
    correlationId: 'correlation-1',
    causationIds: ['cause-1'],
    replay: false,
    system: false,
    capturePolicy: 'commitEligible',
    redaction: {
      ...DEFAULT_PROVENANCE_REDACTION_POLICY,
      mode: 'opaque-digest-only',
      durableAuthorIdentity: 'opaque-subject-ref',
      durableProviderIdentity: 'opaque-provider-ref',
    },
  };

  return createAdmittedSyncApplyContext({
    source: 'test',
    docId: 'test-doc',
    envelopeVersion: 'provider-inbound-update-v2',
    providerRefId: 'provider-ref-1',
    providerEpoch: 'epoch-1',
    updateId: 'remote-update-1',
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

    const syncApplyContext = makeLegacyRawContext(payloadHash);

    await core.syncApply(new Uint8Array([1]), syncApplyContext);

    expect(transport.call).toHaveBeenCalledWith('compute_apply_sync_update', {
      docId: 'test-doc',
      update: new Uint8Array([1]),
    });
    expect(syncApplyContext.operationContext).toMatchObject({
      kind: 'sync-import',
      workbookId: 'test-doc',
      capturePolicy: 'excluded',
      writeAdmissionMode: 'captureDisabledNoHistory',
      collaboration: {
        sourceKind: 'legacyRawUnknown',
        originKind: 'legacyRaw',
        payloadHash,
        trustStatus: 'legacyRaw',
        authorState: 'unknown',
        commitGrouping: 'excludedLifecycle',
      },
    });
    expect(diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'versioning.admission.missing-context' }),
    );
    expect(diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'provenance.missingContext' }),
    );
  });

  it('maps verified live provider provenance into a pending remote operation context', async () => {
    const diagnostics: MutationAdmissionDiagnostic[] = [];
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), mutationResult()]),
    };
    const core = createStartedCore(makeMockContext(diagnostics), transport);
    const payloadHash = '3'.repeat(64);
    const syncApplyContext = makeVerifiedProviderContext(payloadHash);

    await core.syncApply(new Uint8Array([3]), syncApplyContext);

    expect(syncApplyContext.operationContext).toMatchObject({
      kind: 'sync-import',
      author: {
        authorId: 'subject-ref-1',
        actorKind: 'user',
        sessionId: 'remote-session-1',
      },
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
      collaboration: {
        sourceKind: 'providerLiveInbound',
        originKind: 'provider',
        stableOriginId: 'provider-stable-1',
        updateId: 'remote-update-1',
        sequence: '7',
        payloadHash,
        trustStatus: 'verified',
        authorState: 'singleRemote',
        remoteSessionId: 'remote-session-1',
        correlationId: 'correlation-1',
        causationIds: ['cause-1'],
        replay: false,
        system: false,
        commitGrouping: 'pendingRemote',
      },
    });
    expect(diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'versioning.admission.missing-context' }),
    );
  });
});
