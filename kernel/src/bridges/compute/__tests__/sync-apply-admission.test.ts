import { jest } from '@jest/globals';
import { createHash, webcrypto } from 'node:crypto';
import {
  classifyLegacyRawUpdate,
  DEFAULT_PROVENANCE_REDACTION_POLICY,
  type SyncUpdateProvenance,
  type SyncUpdateValidationDiagnostic,
} from '@mog-sdk/types-document/storage';
import type { BridgeTransport } from '@rust-bridge/client';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';

import { ComputeCore } from '../compute-core';
import type { MutationResult, SyncApplyMutationMetadataWire } from '../compute-types.gen';
import type { MutationAdmissionDiagnostic } from '../mutation-admission';
import {
  createNotEvaluatedSyncProvenanceApplyReport,
  createAdmittedSyncApplyContext,
  toSyncApplyOperationContextWire,
  type AdmittedSyncApplyContext,
} from '../sync-apply-admission';
import { syncApplyWithMetadataResult } from '../sync-apply-result';

(globalThis as any).window = {};
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

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

function syncMutationMetadata(
  result = mutationResult(),
  context: AdmittedSyncApplyContext = makeLegacyRawContext('0'.repeat(64)),
): SyncApplyMutationMetadataWire {
  return {
    mutationResult: result,
    provenanceReport: createNotEvaluatedSyncProvenanceApplyReport(context),
  };
}

function makeMockContext(
  diagnostics: MutationAdmissionDiagnostic[],
  recordMutationResult?: jest.Mock,
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
    ...(recordMutationResult ? { versioning: { mutationCapture: { recordMutationResult } } } : {}),
  } as unknown as IKernelContext;
}

function createStartedCore(ctx: IKernelContext, transport: BridgeTransport): ComputeCore {
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

function makeVerifiedProviderContext(
  payloadHash: string,
  validationDiagnostics: readonly SyncUpdateValidationDiagnostic[] = [],
) {
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
    validationDiagnostics,
  });
}

function forwardCompatibleValidationDiagnostic(input: {
  readonly reason: string;
  readonly subreason?: string;
  readonly field?: string;
  readonly message: string;
}): SyncUpdateValidationDiagnostic {
  return input as SyncUpdateValidationDiagnostic;
}

describe('sync apply admission', () => {
  it('rejects raw sync mutations without admitted provenance context before transport', async () => {
    const diagnostics: MutationAdmissionDiagnostic[] = [];
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), syncMutationMetadata()]),
    };
    const core = createStartedCore(makeMockContext(diagnostics), transport);

    await expect(
      core.syncApplyAdmitted(new Uint8Array([1, 2, 3]), undefined as never),
    ).rejects.toThrow('compute_apply_sync_update: provenance.missingContext');

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
      call: jest.fn(async () => [new Uint8Array(), syncMutationMetadata()]),
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

    await expect(core.syncApplyAdmitted(new Uint8Array([1]), forged as never)).rejects.toThrow(
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

  it('keeps syncApply as an explicit legacy raw adapter with diagnostics', async () => {
    const diagnostics: MutationAdmissionDiagnostic[] = [];
    const update = new Uint8Array([9, 8, 7]);
    const payloadHash = createHash('sha256').update(update).digest('hex');
    const mutation = mutationResult();
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async (_command: string, args: { syncContext: unknown }) => [
        new Uint8Array(),
        {
          mutationResult: mutation,
          provenanceReport: {
            appliedContext: args.syncContext,
            pendingSegmentStatus: 'notEvaluated',
            pendingSegmentIds: [],
            batchDurabilityStatus: 'notEvaluated',
          },
        } satisfies SyncApplyMutationMetadataWire,
      ]),
    };
    const core = createStartedCore(makeMockContext(diagnostics), transport);

    const result = await core.syncApply(update);

    expect(result).toBe(mutation);
    expect(transport.call).toHaveBeenCalledWith('compute_apply_sync_update', {
      docId: 'test-doc',
      update,
      syncContext: expect.objectContaining({
        operationContext: expect.objectContaining({
          kind: 'sync-import',
          collaboration: expect.objectContaining({
            sourceKind: 'legacyRawUnknown',
            originKind: 'legacyRaw',
            payloadHash,
            trustStatus: 'legacyRaw',
            authorState: 'unknown',
            commitGrouping: 'excludedLifecycle',
          }),
        }),
      }),
    });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'provenance.legacyRawUnknown',
        severity: 'warning',
        command: 'compute_apply_sync_update',
      }),
    );
  });

  it('admits raw sync mutations with a branded sync provenance context', async () => {
    const diagnostics: MutationAdmissionDiagnostic[] = [];
    const payloadHash = '1'.repeat(64);
    const syncApplyContext = makeLegacyRawContext(payloadHash);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [
        new Uint8Array(),
        syncMutationMetadata(mutationResult(), syncApplyContext),
      ]),
    };
    const core = createStartedCore(makeMockContext(diagnostics), transport);

    await core.syncApplyAdmitted(new Uint8Array([1]), syncApplyContext);

    expect(transport.call).toHaveBeenCalledWith('compute_apply_sync_update', {
      docId: 'test-doc',
      update: new Uint8Array([1]),
      syncContext: toSyncApplyOperationContextWire(syncApplyContext),
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

  it('records duplicate admitted sync update diagnostics without short-circuiting apply', async () => {
    const diagnostics: MutationAdmissionDiagnostic[] = [];
    const payloadHash = '7'.repeat(64);
    const syncApplyContext = makeVerifiedProviderContext(payloadHash);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [
        new Uint8Array(),
        syncMutationMetadata(mutationResult(), syncApplyContext),
      ]),
    };
    const core = createStartedCore(makeMockContext(diagnostics), transport);

    await core.syncApplyAdmitted(new Uint8Array([7]), syncApplyContext);
    await core.syncApplyAdmitted(new Uint8Array([7]), syncApplyContext);

    expect(transport.call).toHaveBeenCalledTimes(2);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'provenance.duplicateUpdate',
        severity: 'warning',
        command: 'compute_apply_sync_update',
      }),
    );
  });

  it('returns sync apply metadata from the richer path while syncApply stays compatible', async () => {
    const diagnostics: MutationAdmissionDiagnostic[] = [];
    const mutation = mutationResult();
    const payloadHash = '4'.repeat(64);
    const syncApplyContext = makeVerifiedProviderContext(payloadHash);
    const metadata = syncMutationMetadata(mutation, syncApplyContext);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), metadata]),
    };
    const core = createStartedCore(makeMockContext(diagnostics), transport);

    const richResult = await core.syncApplyWithMetadata(new Uint8Array([4]), syncApplyContext);
    const compatResult = await core.syncApply(new Uint8Array([5]), syncApplyContext);

    expect(richResult).toEqual(syncApplyWithMetadataResult(metadata));
    expect(richResult.metadata.provenanceReport).toEqual(
      createNotEvaluatedSyncProvenanceApplyReport(syncApplyContext),
    );
    expect(compatResult).toBe(mutation);
    expect((compatResult as MutationResult & { metadata?: unknown }).metadata).toBeUndefined();
    expect(transport.call).toHaveBeenCalledTimes(2);
  });

  it('maps verified live provider provenance into a pending remote operation context', async () => {
    const diagnostics: MutationAdmissionDiagnostic[] = [];
    const payloadHash = '3'.repeat(64);
    const syncApplyContext = makeVerifiedProviderContext(payloadHash);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [
        new Uint8Array(),
        syncMutationMetadata(mutationResult(), syncApplyContext),
      ]),
    };
    const core = createStartedCore(makeMockContext(diagnostics), transport);

    await core.syncApply(new Uint8Array([3]), syncApplyContext);
    const wireContext = toSyncApplyOperationContextWire(syncApplyContext);

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
    expect(wireContext.operationContext.collaboration).toMatchObject({
      sourceKind: 'providerLiveInbound',
      originKind: 'provider',
      stableOriginId: 'provider-stable-1',
      providerId: 'provider-stable-1',
      providerKind: 'test-provider',
      authorityRef: 'authority-1',
      epoch: 'epoch-1',
      updateId: 'remote-update-1',
      sequence: '7',
      payloadHash,
      provenancePayloadHash: '2'.repeat(64),
      trustStatus: 'verified',
      authorState: 'singleRemote',
      remoteSessionId: 'remote-session-1',
      correlationId: 'correlation-1',
      causationIds: ['cause-1'],
      replay: false,
      system: false,
      commitGrouping: 'pendingRemote',
      validationDiagnosticCount: 0,
    });
    expect(() => JSON.stringify(wireContext)).not.toThrow();
    expect(JSON.stringify(wireContext)).not.toContain('7n');
    expect(diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'versioning.admission.missing-context' }),
    );
  });

  it('propagates sync validation diagnostics into apply metadata context', async () => {
    const diagnostics: MutationAdmissionDiagnostic[] = [];
    const mutation = mutationResult();
    const payloadHash = '6'.repeat(64);
    const syncApplyContext = makeVerifiedProviderContext(payloadHash, [
      {
        reason: 'missingRedactionKey',
        subreason: 'missingRedactionKey',
        field: 'author',
        message: 'Provider proof omitted the durable remote author key.',
      },
    ]);
    const metadata = syncMutationMetadata(mutation, syncApplyContext);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), metadata]),
    };
    const core = createStartedCore(makeMockContext(diagnostics), transport);

    const richResult = await core.syncApplyWithMetadata(new Uint8Array([6]), syncApplyContext);

    expect(syncApplyContext.operationContext.collaboration).toMatchObject({
      commitGrouping: 'blockedMissingRedactionKey',
      validationDiagnosticCount: 1,
    });
    expect(
      richResult.metadata.provenanceReport.appliedContext.operationContext.collaboration,
    ).toMatchObject({
      commitGrouping: 'blockedMissingRedactionKey',
      validationDiagnosticCount: 1,
    });
    expect(richResult).toEqual(syncApplyWithMetadataResult(metadata));
  });

  it('maps ordered batch validation failures before the generic mixed-author bucket', async () => {
    const diagnostics: MutationAdmissionDiagnostic[] = [];
    const mutation = mutationResult();
    const payloadHash = '8'.repeat(64);
    const baseContext = makeVerifiedProviderContext(payloadHash);
    const syncApplyContext = createAdmittedSyncApplyContext({
      source: baseContext.source,
      docId: baseContext.docId,
      envelopeVersion: baseContext.envelopeVersion,
      providerRefId: baseContext.providerRefId,
      providerEpoch: baseContext.providerEpoch,
      updateId: baseContext.updateId,
      payloadHash: baseContext.payloadHash,
      provenance: {
        ...baseContext.provenance,
        author: {
          kind: 'mixedRemote',
          participantCount: 2,
          reason: 'multipleProvenAuthors',
        },
      },
      validationDiagnostics: [
        forwardCompatibleValidationDiagnostic({
          reason: 'mixedAuthors',
          subreason: 'blockedBatchFailure',
          field: 'author',
          message:
            'Provider batch raw-batch-id:123 included private@example.com in a later sub-update.',
        }),
      ],
    });
    const metadata = syncMutationMetadata(mutation, syncApplyContext);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), metadata]),
    };
    const core = createStartedCore(makeMockContext(diagnostics), transport);

    const richResult = await core.syncApplyWithMetadata(new Uint8Array([8]), syncApplyContext);
    const collaboration =
      richResult.metadata.provenanceReport.appliedContext.operationContext.collaboration;

    expect(syncApplyContext.operationContext.collaboration).toMatchObject({
      authorState: 'mixedRemote',
      commitGrouping: 'blockedBatchFailure',
      validationDiagnosticCount: 1,
      exclusionReason: 'mixedAuthors',
      exclusionSubreason: 'blockedBatchFailure',
    });
    expect(collaboration).toMatchObject({
      authorState: 'mixedRemote',
      commitGrouping: 'blockedBatchFailure',
      validationDiagnosticCount: 1,
      exclusionReason: 'mixedAuthors',
      exclusionSubreason: 'blockedBatchFailure',
    });
    const serialized = JSON.stringify(collaboration);
    expect(serialized).not.toContain('raw-batch-id');
    expect(serialized).not.toContain('private@example.com');
  });

  it('redacts forward-compatible batch failure subreasons from the wire context', () => {
    const payloadHash = '9'.repeat(64);
    const syncApplyContext = makeVerifiedProviderContext(payloadHash, [
      forwardCompatibleValidationDiagnostic({
        reason: 'orderedSubUpdateValidationFailed',
        subreason: 'provider-batch:secret-raw-id',
        field: 'batch',
        message: 'Sub-update proof failed for provider-batch:secret-raw-id.',
      }),
    ]);
    const wireContext = toSyncApplyOperationContextWire(syncApplyContext);

    expect(wireContext.operationContext.collaboration).toMatchObject({
      commitGrouping: 'blockedBatchFailure',
      validationDiagnosticCount: 1,
      exclusionReason: 'orderedSubUpdateValidationFailed',
      exclusionSubreason: 'blockedBatchFailure',
    });
    expect(JSON.stringify(wireContext)).not.toContain('provider-batch:secret-raw-id');
  });

  it('records verified live sync mutation results for pending remote capture', async () => {
    const diagnostics: MutationAdmissionDiagnostic[] = [];
    const recordMutationResult = jest.fn();
    const mutation = {
      ...mutationResult(),
      authoredCellChanges: [
        {
          cellId: 'cell-1',
          sheetId: 'sheet-1',
          position: { row: 0, col: 0 },
          oldValue: null,
          value: 'remote',
          extraFlags: 0,
        },
      ],
    } as MutationResult;
    const payloadHash = '5'.repeat(64);
    const syncApplyContext = makeVerifiedProviderContext(payloadHash);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [
        new Uint8Array(),
        syncMutationMetadata(mutation, syncApplyContext),
      ]),
    };
    const core = createStartedCore(makeMockContext(diagnostics, recordMutationResult), transport);

    await core.syncApplyWithMetadata(new Uint8Array([5]), syncApplyContext);

    expect(recordMutationResult).toHaveBeenCalledWith({
      operation: 'compute_apply_sync_update',
      result: mutation,
      operationContext: syncApplyContext.operationContext,
    });
  });
});
