import { jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import {
  DEFAULT_PROVENANCE_REDACTION_POLICY,
  PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
  PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
  type ProviderAuthorityProof,
  type ProviderInboundProofField,
  type ProviderInboundUpdateEnvelope,
  type ProviderInboundUpdateEnvelopeV2,
  type SyncUpdateProvenance,
} from '@mog-sdk/types-document/storage';
import type { AdmittedSyncApplyContext } from '../../bridges/compute/sync-apply-admission';
import { RustDocument } from '../rust-document';
import { createBridgeBackedProviderDoc } from '../providers/bridge-provider-doc';
import type { Provider, ProviderDocApplyUpdateMetadata } from '../providers/provider';

interface StubBridge {
  subscribeUpdateV1(cb: (u: Uint8Array) => void): { unsubscribe: () => void };
  createEngine(snapshot?: Record<string, unknown>): Promise<unknown>;
  createEngineFromYrsState(state: Uint8Array): Promise<unknown>;
  flushUndoCapture(): Promise<unknown>;
  syncApply(u: Uint8Array, context: AdmittedSyncApplyContext): Promise<unknown>;
  recordProviderDocApplyUpdateAdmission(metadata: ProviderDocApplyUpdateMetadata): void;
  encodeDiff(sv: Uint8Array): Promise<Uint8Array>;
  currentStateVector(): Promise<Uint8Array>;
  flushPendingUpdateV1(): Promise<void>;
  admissions: ProviderDocApplyUpdateMetadata[];
  contexts: AdmittedSyncApplyContext[];
  events: string[];
}

const storageScope = {
  kind: 'scoped',
  scope: {
    tenantId: { kind: 'single-tenant' },
    workspaceId: { kind: 'no-workspace' },
    documentId: 'provider-inbound-provenance-doc',
  },
} as const;

describe('provider inbound provenance preservation', () => {
  it('keeps V2 provenance intact until RustDocument syncApply admission', async () => {
    const { doc, bridge } = await makeDocument();
    await doc.attachProvider(makeProvider('ProviderA'));
    const envelope = makeV2Envelope('v2-rust-document-1', new Uint8Array([0x10, 0x20]));

    const result = await doc.applyProviderUpdate(envelope);

    expect(result.status).toBe('applied');
    expect(result.provenance).toBe(envelope.provenance);
    expect(bridge.events).toEqual(['admission:provider-inbound-update-v2', 'syncApply']);
    expect(bridge.admissions[0]).toMatchObject({
      source: 'provider-inbound',
      envelopeVersion: 'provider-inbound-update-v2',
      updateId: envelope.updateId,
      payloadHash: envelope.payloadHash,
      validationDiagnostics: [],
    });
    expect(bridge.admissions[0]?.provenance).toBe(envelope.provenance);
    expect(bridge.contexts[0]?.provenance).toBe(envelope.provenance);
    expect(bridge.contexts[0]?.operationContext).toMatchObject({
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
      author: {
        authorId: 'subject-ref-1',
        actorKind: 'user',
        sessionId: 'remote-session-1',
      },
      collaboration: {
        sourceKind: 'providerLiveInbound',
        originKind: 'provider',
        stableOriginId: 'provider-stable-1',
        providerId: 'provider-stable-1',
        providerKind: 'test-provider',
        updateId: envelope.updateId,
        payloadHash: envelope.payloadHash,
        provenancePayloadHash: envelope.provenance.updateIdentity.provenancePayloadHash,
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
    expect(bridge.contexts[0]?.operationContext.collaboration?.sourceKind).not.toBe(
      'legacyRawUnknown',
    );
    expect(bridge.contexts[0]?.operationContext.collaboration?.sourceKind).not.toBe(
      'providerReplay',
    );

    await doc.destroy();
  });

  it('keeps V1 provider envelopes on the explicit legacy adapter path', async () => {
    const { doc, bridge } = await makeDocument();
    await doc.attachProvider(makeProvider('ProviderA'));
    const envelope = makeV1Envelope('v1-legacy-adapter-1', new Uint8Array([0x30, 0x31]));

    const result = await doc.applyProviderUpdate(envelope);

    expect(result).toMatchObject({
      status: 'applied',
      provenance: {
        sourceKind: 'providerReplay',
        replay: true,
        system: true,
        capturePolicy: 'excluded',
      },
    });
    expect(bridge.events).toEqual(['admission:provider-inbound-update-v1', 'syncApply']);
    expect(bridge.contexts[0]).toMatchObject({
      envelopeVersion: 'provider-inbound-update-v1',
      operationContext: {
        capturePolicy: 'excluded',
        writeAdmissionMode: 'captureDisabledNoHistory',
        collaboration: {
          sourceKind: 'providerReplay',
          replay: true,
          system: true,
          commitGrouping: 'excludedLifecycle',
        },
      },
    });

    await doc.destroy();
  });

  it('applies bridge-provider V2 envelopes without payload-only reclassification', async () => {
    const bridge = makeStubBridge();
    const envelope = makeV2Envelope('v2-bridge-provider-1', new Uint8Array([0x40, 0x41]));
    const doc = createBridgeBackedProviderDoc(
      bridge as unknown as Parameters<typeof createBridgeBackedProviderDoc>[0],
      'provider-inbound-provenance-doc',
    );

    await doc.applyProviderInboundUpdateEnvelopeV2(envelope);

    expect(bridge.events).toEqual(['admission:provider-inbound-update-v2', 'syncApply']);
    expect(bridge.contexts).toHaveLength(1);
    expect(bridge.contexts[0]?.envelopeVersion).toBe('provider-inbound-update-v2');
    expect(bridge.contexts[0]?.provenance).toBe(envelope.provenance);
    expect(bridge.contexts[0]?.operationContext.collaboration).toMatchObject({
      sourceKind: 'providerLiveInbound',
      updateId: envelope.updateId,
      payloadHash: envelope.payloadHash,
      commitGrouping: 'pendingRemote',
    });
    expect(bridge.contexts[0]?.operationContext.collaboration?.sourceKind).not.toBe(
      'legacyRawUnknown',
    );
  });
});

async function makeDocument(): Promise<{ doc: RustDocument; bridge: StubBridge }> {
  const bridge = makeStubBridge();
  const doc = new RustDocument({
    docId: 'provider-inbound-provenance-doc',
    computeBridge: bridge as never,
    internal: true,
    skipPersistenceLoad: true,
  });
  await doc.ready;
  return { doc, bridge };
}

function makeStubBridge(): StubBridge {
  const subscribers = new Set<(u: Uint8Array) => void>();
  const admissions: ProviderDocApplyUpdateMetadata[] = [];
  const contexts: AdmittedSyncApplyContext[] = [];
  const events: string[] = [];
  const emit = (update: Uint8Array) => {
    for (const cb of subscribers) cb(update);
  };
  return {
    subscribeUpdateV1(cb) {
      subscribers.add(cb);
      return { unsubscribe: () => subscribers.delete(cb) };
    },
    createEngine: async () => ({ recalc: { changedCells: [] } }),
    createEngineFromYrsState: async () => ({ recalc: { changedCells: [] } }),
    flushUndoCapture: async () => ({ recalc: { changedCells: [] } }),
    syncApply: jest.fn(async (update: Uint8Array, context: AdmittedSyncApplyContext) => {
      contexts.push(context);
      events.push('syncApply');
      emit(update);
      return { recalc: { changedCells: [] } };
    }),
    recordProviderDocApplyUpdateAdmission(metadata) {
      admissions.push(metadata);
      events.push(`admission:${metadata.envelopeVersion}`);
    },
    encodeDiff: async () => new Uint8Array(),
    currentStateVector: async () => new Uint8Array(),
    flushPendingUpdateV1: async () => {},
    admissions,
    contexts,
    events,
  };
}

function makeProvider(name: string): Provider {
  return {
    name,
    appendUpdate: () => {},
    attach: async () => {},
    flush: async () => {},
    checkpointFullState: async () => {},
    flushSync: () => {},
    detach: async () => {},
    stateVector: async () => new Uint8Array(),
    flushFailed: false,
  };
}

function makeV1Envelope(updateId: string, payload: Uint8Array): ProviderInboundUpdateEnvelope {
  return {
    providerRefId: 'ProviderA',
    authorityRef: 'authority-1',
    storageScope,
    decisionId: 'decision-1',
    sessionId: 'local-session-1',
    providerEpoch: '1',
    updateId,
    payloadKind: 'yrs-update-v1',
    payload,
    payloadHash: sha256Hex(payload),
    authorityProof: proof(['payloadHash', 'updateId']),
  };
}

function makeV2Envelope(updateId: string, payload: Uint8Array): ProviderInboundUpdateEnvelopeV2 {
  const v1 = makeV1Envelope(updateId, payload);
  const provenance = makeLiveProvenance(v1);
  return {
    ...v1,
    schemaVersion: 'provider-inbound-update-v2',
    provenance,
    authorityProof: proof(
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

function makeLiveProvenance(envelope: ProviderInboundUpdateEnvelope): SyncUpdateProvenance {
  return {
    schemaVersion: 'sync-update-provenance-v1',
    sourceKind: 'providerLiveInbound',
    updateIdentity: {
      originKind: 'provider',
      stableOriginId: 'provider-stable-1',
      providerId: 'provider-stable-1',
      providerKind: 'test-provider',
      providerRefId: envelope.providerRefId,
      storageScope: envelope.storageScope,
      authorityRef: envelope.authorityRef,
      epoch: envelope.providerEpoch,
      updateId: envelope.updateId,
      payloadHash: envelope.payloadHash,
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
      remoteAuthorRef: { kind: 'opaque-subject-ref', value: 'subject-ref-1' },
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
}

function proof(
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

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
