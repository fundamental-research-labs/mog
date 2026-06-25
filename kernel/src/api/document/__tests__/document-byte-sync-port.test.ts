import { jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { _createDocumentHandleInternal } from '../document-factory';
import type { ISpreadsheetKernelContext } from '@mog-sdk/contracts/kernel';
import type { SheetId } from '@mog-sdk/contracts/core';
import {
  DEFAULT_PROVENANCE_REDACTION_POLICY,
  PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
  PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
  type ProviderAuthorityProof,
  type ProviderInboundProofField,
  type ProviderInboundUpdateEnvelopeV2,
  type SyncUpdateProvenance,
} from '@mog-sdk/types-document/storage';
import type {
  ClassifiedRawSyncUpdateProvenance,
  SyncUpdateAdmissionMetadata,
} from '../../../document/providers/provider';

function createBridge(label: number) {
  const admissions: SyncUpdateAdmissionMetadata[] = [];
  const events: string[] = [];
  return {
    admissions,
    events,
    recordProviderDocApplyUpdateAdmission: jest.fn((metadata: SyncUpdateAdmissionMetadata) => {
      admissions.push(metadata);
      events.push(`admission:${metadata.envelopeVersion}`);
    }),
    syncApply: jest.fn(async () => {
      events.push('syncApply');
      return { recalc: { changedCells: [] } };
    }),
    encodeDiff: jest.fn(async () => new Uint8Array([label, 2])),
    currentStateVector: jest.fn(async () => new Uint8Array([label])),
  };
}

function createHandleFixture() {
  let bridge = createBridge(1);
  const lifecycle = {
    initialSheetId: 'sheet-1' as SheetId,
    get computeBridge() {
      return bridge;
    },
    setComputeBridge(next: typeof bridge) {
      bridge = next;
    },
    dispose: jest.fn(async () => undefined),
  };
  const context = {
    eventBus: {},
    services: {},
  } as ISpreadsheetKernelContext;

  const handle = _createDocumentHandleInternal('doc-byte-sync', lifecycle as never, context);

  return { handle, lifecycle, bridge };
}

const storageScope = {
  kind: 'scoped',
  scope: {
    tenantId: { kind: 'single-tenant' },
    workspaceId: { kind: 'no-workspace' },
    documentId: 'doc-byte-sync',
  },
} as const;

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function makeProof(
  coveredFields: readonly ProviderInboundProofField[],
  canonicalPayloadHash = 'c'.repeat(64),
): ProviderAuthorityProof {
  return {
    kind: 'signed-provider-message',
    issuer: 'issuer-1',
    algorithm: 'ed25519',
    issuedAt: 1,
    coveredFields,
    canonicalPayloadHash,
    proofBytesOrRef: 'proof-ref-1',
  };
}

function makeLiveProvenance(
  payload: Uint8Array,
  overrides: Partial<SyncUpdateProvenance> = {},
): SyncUpdateProvenance {
  return {
    schemaVersion: 'sync-update-provenance-v1',
    sourceKind: 'providerLiveInbound',
    updateIdentity: {
      originKind: 'provider',
      stableOriginId: 'provider-stable-1',
      providerId: 'provider-stable-1',
      providerKind: 'test-provider',
      providerRefId: 'ProviderA',
      storageScope,
      authorityRef: 'authority-1',
      epoch: '1',
      updateId: 'live-update-1',
      payloadHash: sha256Hex(payload),
      provenancePayloadHash: 'c'.repeat(64),
    },
    trust: {
      status: 'verified',
      authorityRef: 'authority-1',
      proofKind: 'signed-provider-message',
      proofCoverage: [
        ...PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
        ...PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
        'providerId',
        'providerKind',
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
    ...overrides,
  };
}

function makeProviderEnvelope(
  payload = new Uint8Array([0x10, 0x20]),
): ProviderInboundUpdateEnvelopeV2 {
  const baseProvenance = makeLiveProvenance(payload);
  const provenance = makeLiveProvenance(payload, {
    updateIdentity: {
      ...baseProvenance.updateIdentity,
      updateId: 'provider-update-1',
    },
  });
  return {
    providerRefId: 'ProviderA',
    authorityRef: 'authority-1',
    storageScope,
    decisionId: 'decision-1',
    sessionId: 'local-session-1',
    providerEpoch: '1',
    updateId: 'provider-update-1',
    payloadKind: 'yrs-update-v1',
    payload,
    payloadHash: sha256Hex(payload),
    schemaVersion: 'provider-inbound-update-v2',
    provenance,
    authorityProof: makeProof(
      [
        ...PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
        ...PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
        'providerId',
        'providerKind',
      ],
      provenance.updateIdentity.provenancePayloadHash ?? 'c'.repeat(64),
    ),
  };
}

function makeClassifiedRawProvenance(payload: Uint8Array): ClassifiedRawSyncUpdateProvenance {
  return {
    schemaVersion: 'sync-update-provenance-v1',
    sourceKind: 'collaborationMixedRemote',
    updateIdentity: {
      originKind: 'room',
      roomId: 'room-1',
      updateId: 'mixed-update-1',
      payloadHash: sha256Hex(payload),
    },
    trust: { status: 'unverified' },
    author: {
      kind: 'mixedRemote',
      participantCount: 2,
      reason: 'aggregateWithoutBoundaries',
    },
    replay: false,
    system: false,
    capturePolicy: 'excluded',
    redaction: DEFAULT_PROVENANCE_REDACTION_POLICY,
    exclusionDiagnostic: {
      reason: 'mixedAuthors',
      message: 'Coordinator diff aggregates multiple remote authors.',
    },
  };
}

function makeProviderReplayProvenance(payload: Uint8Array): ClassifiedRawSyncUpdateProvenance {
  return {
    schemaVersion: 'sync-update-provenance-v1',
    sourceKind: 'providerReplay',
    updateIdentity: {
      originKind: 'provider',
      providerRefId: 'ProviderA',
      updateId: 'provider-replay-1',
      payloadHash: sha256Hex(payload),
    },
    trust: { status: 'trustedLocalSystem' },
    author: { kind: 'unknown', reason: 'providerReplay' },
    replay: true,
    system: true,
    capturePolicy: 'excluded',
    redaction: DEFAULT_PROVENANCE_REDACTION_POLICY,
    exclusionDiagnostic: {
      reason: 'providerReplay',
      message: 'Provider replay is admitted as classified system replay.',
    },
  };
}

function makeHydrationProvenance(payload: Uint8Array): ClassifiedRawSyncUpdateProvenance {
  return {
    schemaVersion: 'sync-update-provenance-v1',
    sourceKind: 'collaborationHydration',
    updateIdentity: {
      originKind: 'room',
      roomId: 'room-1',
      updateId: 'hydration-1',
      payloadHash: sha256Hex(payload),
    },
    trust: { status: 'trustedLocalSystem' },
    author: { kind: 'system', systemRef: 'collaboration-hydration' },
    replay: true,
    system: true,
    capturePolicy: 'excluded',
    redaction: DEFAULT_PROVENANCE_REDACTION_POLICY,
    exclusionDiagnostic: {
      reason: 'hydration',
      message: 'Collaboration hydration is admitted as classified system replay.',
    },
  };
}

interface RawFallbackAdmissionPayload {
  readonly bin: 'document-byte-sync-port.raw-fallback-rejected';
  readonly sourceKind: 'legacyRawUnknown';
  readonly byteMaterial: 'omitted';
}

interface RawFallbackAdmissionDiagnostic {
  readonly code: 'provenance.missingContext';
  readonly reason: 'missingClassification';
  readonly subreason: 'rawUnclassified';
  readonly retryable: true;
  readonly retryStrategy: 'retry-with-classified-provenance';
  readonly methodName: 'DocumentHandle.syncPort.applyUpdate';
  readonly message: 'raw sync bytes require classified provenance';
  readonly payload: RawFallbackAdmissionPayload;
}

type RawFallbackAdmissionError = Error & {
  readonly code: 'provenance.missingContext';
  readonly reason: 'missingClassification';
  readonly subreason: 'rawUnclassified';
  readonly retryable: true;
  readonly retryStrategy: 'retry-with-classified-provenance';
  readonly bin: RawFallbackAdmissionPayload['bin'];
  readonly sourceKind: RawFallbackAdmissionPayload['sourceKind'];
  readonly payload: RawFallbackAdmissionPayload;
  readonly diagnostic: RawFallbackAdmissionDiagnostic;
  readonly diagnostics: readonly RawFallbackAdmissionDiagnostic[];
};

async function rejectRawApplyUpdate(
  port: { applyUpdate(update: Uint8Array): Promise<unknown> },
  update: Uint8Array,
): Promise<RawFallbackAdmissionError> {
  return port.applyUpdate(update).then(
    () => {
      throw new Error('expected raw applyUpdate rejection');
    },
    (err: unknown) => err as RawFallbackAdmissionError,
  );
}

describe('DocumentHandle.createSyncPort', () => {
  it('returns one stable document byte-sync port', () => {
    const { handle } = createHandleFixture();

    const first = handle.createSyncPort();
    const second = handle.createSyncPort();

    expect(first).toBe(second);
    expect(first.docId).toBe('doc-byte-sync');
  });

  it('delegates through the current lifecycle bridge lazily', async () => {
    const { handle, lifecycle, bridge } = createHandleFixture();
    const port = handle.createSyncPort();

    await expect(port.currentStateVector()).resolves.toEqual(new Uint8Array([1]));
    await expect(port.encodeDiff(new Uint8Array([9]))).resolves.toEqual(new Uint8Array([1, 2]));
    expect(bridge.currentStateVector).toHaveBeenCalledTimes(1);
    expect(bridge.encodeDiff).toHaveBeenCalledWith(new Uint8Array([9]));

    const recoveredBridge = createBridge(3);
    lifecycle.setComputeBridge(recoveredBridge);

    await expect(port.currentStateVector()).resolves.toEqual(new Uint8Array([3]));
    expect(recoveredBridge.currentStateVector).toHaveBeenCalledTimes(1);
  });

  it('fails closed for raw applyUpdate without classified provenance before syncApply', async () => {
    const { handle, bridge } = createHandleFixture();
    const port = handle.createSyncPort();

    const error = await port.applyUpdate(new Uint8Array([7])).then(
      () => null,
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'DocumentByteSyncAdmissionError',
      code: 'provenance.missingContext',
      reason: 'missingClassification',
      subreason: 'rawUnclassified',
      diagnostic: {
        code: 'provenance.missingContext',
        reason: 'missingClassification',
        subreason: 'rawUnclassified',
        methodName: 'DocumentHandle.syncPort.applyUpdate',
        message: 'raw sync bytes require classified provenance',
      },
      diagnostics: [
        {
          code: 'provenance.missingContext',
          reason: 'missingClassification',
          subreason: 'rawUnclassified',
        },
      ],
    });
    expect((error as Error).message).toContain(
      'DocumentHandle.syncPort.applyUpdate: raw sync bytes require classified provenance',
    );
    expect((error as Error).message).toContain('subreason=rawUnclassified');
    expect((error as Error).message).toContain('retryable=true');
    expect((error as Error).message).toContain('bin=document-byte-sync-port.raw-fallback-rejected');
    expect((error as Error).message).toContain('sourceKind=legacyRawUnknown');

    expect(bridge.recordProviderDocApplyUpdateAdmission).not.toHaveBeenCalled();
    expect(bridge.syncApply).not.toHaveBeenCalled();
    expect(bridge.events).toEqual([]);
  });

  it('rejects raw fallback with retryable stable diagnostics and no raw bytes', async () => {
    const { handle, bridge } = createHandleFixture();
    const port = handle.createSyncPort();
    const rawUpdate = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const otherRawUpdate = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);
    const payload: RawFallbackAdmissionPayload = {
      bin: 'document-byte-sync-port.raw-fallback-rejected',
      sourceKind: 'legacyRawUnknown',
      byteMaterial: 'omitted',
    };

    const error = await rejectRawApplyUpdate(port, rawUpdate);
    const otherError = await rejectRawApplyUpdate(port, otherRawUpdate);

    expect(error).toMatchObject({
      name: 'DocumentByteSyncAdmissionError',
      code: 'provenance.missingContext',
      reason: 'missingClassification',
      subreason: 'rawUnclassified',
      retryable: true,
      retryStrategy: 'retry-with-classified-provenance',
      bin: payload.bin,
      sourceKind: payload.sourceKind,
      payload,
      diagnostic: {
        code: 'provenance.missingContext',
        reason: 'missingClassification',
        subreason: 'rawUnclassified',
        retryable: true,
        retryStrategy: 'retry-with-classified-provenance',
        methodName: 'DocumentHandle.syncPort.applyUpdate',
        message: 'raw sync bytes require classified provenance',
        payload,
      },
    });
    expect(error.diagnostics).toEqual([error.diagnostic]);
    expect(otherError.diagnostic).toEqual(error.diagnostic);

    const diagnosticsJson = JSON.stringify(error.diagnostics);
    expect(diagnosticsJson).toContain('"bin":"document-byte-sync-port.raw-fallback-rejected"');
    expect(diagnosticsJson).toContain('"sourceKind":"legacyRawUnknown"');
    expect(diagnosticsJson).not.toContain('rawBytes');
    expect(diagnosticsJson).not.toContain('payloadHash');
    expect(diagnosticsJson).not.toContain('deadbeef');
    expect(diagnosticsJson).not.toContain('222');
    expect(diagnosticsJson).not.toContain('173');
    expect(diagnosticsJson).not.toContain('190');
    expect(diagnosticsJson).not.toContain('239');

    expect(bridge.recordProviderDocApplyUpdateAdmission).not.toHaveBeenCalled();
    expect(bridge.syncApply).not.toHaveBeenCalled();
    expect(bridge.events).toEqual([]);
  });

  it('applies verified provenance after recording admission metadata', async () => {
    const { handle, bridge } = createHandleFixture();
    const port = handle.createSyncPort();
    const update = new Uint8Array([1, 2, 3]);
    const provenance = makeLiveProvenance(update);

    await expect(port.applyUpdateWithProvenance(update, provenance)).resolves.toBeUndefined();

    expect(bridge.events).toEqual(['admission:provenance-only', 'syncApply']);
    expect(bridge.admissions).toHaveLength(1);
    expect(bridge.admissions[0]).toMatchObject({
      source: 'document-sync-port',
      docId: 'doc-byte-sync',
      envelopeVersion: 'provenance-only',
      updateId: 'live-update-1',
      payloadHash: sha256Hex(update),
      provenance,
      validationDiagnostics: [],
    });
    expect(bridge.syncApply).toHaveBeenCalledWith(update, expect.any(Object));
  });

  it('applies provider V2 envelopes through the provenance-aware port path', async () => {
    const { handle, bridge } = createHandleFixture();
    const port = handle.createSyncPort();
    const envelope = makeProviderEnvelope();

    await expect(port.applyProviderEnvelope(envelope)).resolves.toBeUndefined();

    expect(bridge.events).toEqual(['admission:provider-inbound-update-v2', 'syncApply']);
    expect(bridge.admissions[0]).toMatchObject({
      source: 'document-sync-port',
      envelopeVersion: 'provider-inbound-update-v2',
      providerRefId: 'ProviderA',
      providerEpoch: '1',
      updateId: 'provider-update-1',
      payloadHash: envelope.payloadHash,
      provenance: envelope.provenance,
      validationDiagnostics: [],
    });
    expect(bridge.syncApply).toHaveBeenCalledWith(envelope.payload, expect.any(Object));
  });

  it('applies classified raw updates without allowing remote authorship claims', async () => {
    const { handle, bridge } = createHandleFixture();
    const port = handle.createSyncPort();
    const update = new Uint8Array([4, 5, 6]);
    const provenance = makeClassifiedRawProvenance(update);

    await expect(port.applyClassifiedRawUpdate(update, provenance)).resolves.toBeUndefined();

    expect(bridge.events).toEqual(['admission:classified-raw', 'syncApply']);
    expect(bridge.admissions[0]).toMatchObject({
      source: 'document-sync-port',
      envelopeVersion: 'classified-raw',
      updateId: 'mixed-update-1',
      payloadHash: sha256Hex(update),
      provenance,
      validationDiagnostics: [],
    });
  });

  it('applies replay and hydration only through explicitly classified raw provenance', async () => {
    const providerReplayUpdate = new Uint8Array([0x31, 0x32]);
    const hydrationUpdate = new Uint8Array([0x41, 0x42]);
    const cases: readonly {
      readonly update: Uint8Array;
      readonly provenance: ClassifiedRawSyncUpdateProvenance;
    }[] = [
      {
        update: providerReplayUpdate,
        provenance: makeProviderReplayProvenance(providerReplayUpdate),
      },
      {
        update: hydrationUpdate,
        provenance: makeHydrationProvenance(hydrationUpdate),
      },
    ];

    for (const { update, provenance } of cases) {
      const { handle, bridge } = createHandleFixture();
      const port = handle.createSyncPort();

      await expect(port.applyClassifiedRawUpdate(update, provenance)).resolves.toBeUndefined();

      expect(bridge.events).toEqual(['admission:classified-raw', 'syncApply']);
      expect(bridge.admissions[0]).toMatchObject({
        source: 'document-sync-port',
        envelopeVersion: 'classified-raw',
        updateId: provenance.updateIdentity.updateId,
        payloadHash: sha256Hex(update),
        provenance,
        validationDiagnostics: [],
      });
    }
  });

  it('rejects live-authored provenance on the classified raw path before syncApply', async () => {
    const { handle, bridge } = createHandleFixture();
    const port = handle.createSyncPort();
    const update = new Uint8Array([8, 8, 8]);
    const provenance = makeLiveProvenance(update) as unknown as ClassifiedRawSyncUpdateProvenance;

    await expect(port.applyClassifiedRawUpdate(update, provenance)).rejects.toThrow(
      'DocumentHandle.syncPort.applyClassifiedRawUpdate: classified raw sync updates cannot be commit eligible or live-authored',
    );

    expect(bridge.recordProviderDocApplyUpdateAdmission).not.toHaveBeenCalled();
    expect(bridge.syncApply).not.toHaveBeenCalled();
  });

  it('rejects invalid provenance before syncApply', async () => {
    const { handle, bridge } = createHandleFixture();
    const port = handle.createSyncPort();
    const update = new Uint8Array([7, 8, 9]);
    const provenance = makeLiveProvenance(update, {
      updateIdentity: {
        ...makeLiveProvenance(update).updateIdentity,
        payloadHash: '0'.repeat(64),
      },
    });

    await expect(port.applyUpdateWithProvenance(update, provenance)).rejects.toThrow(
      'DocumentHandle.syncPort.applyUpdateWithProvenance: provenance validation failed',
    );
    expect(bridge.recordProviderDocApplyUpdateAdmission).not.toHaveBeenCalled();
    expect(bridge.syncApply).not.toHaveBeenCalled();
  });

  it('guards creation and use after handle disposal', async () => {
    const { handle } = createHandleFixture();
    const port = handle.createSyncPort();

    await handle.dispose();

    expect(() => handle.createSyncPort()).toThrow(
      'DocumentHandle.createSyncPort: handle is disposed',
    );
    await expect(port.applyUpdate(new Uint8Array([1]))).rejects.toThrow(
      'DocumentHandle.syncPort.applyUpdate: handle is disposed',
    );
    expect(() => port.encodeDiff(new Uint8Array([1]))).toThrow(
      'DocumentHandle.syncPort.encodeDiff: handle is disposed',
    );
    expect(() => port.currentStateVector()).toThrow(
      'DocumentHandle.syncPort.currentStateVector: handle is disposed',
    );
  });
});
