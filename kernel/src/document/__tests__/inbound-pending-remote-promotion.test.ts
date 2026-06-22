import { jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';
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
import type { Provider, ProviderDocApplyUpdateMetadata } from '../providers/provider';
import { RustDocument } from '../rust-document';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../version-store/provider';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../version-store/object-store';
import type { VersionObjectType } from '../version-store/object-digest';
import type { PendingRemotePromotionResult } from '../version-store/pending-remote-promotion-service';

interface StubBridge {
  subscribeUpdateV1(cb: (u: Uint8Array) => void): { unsubscribe: () => void };
  createEngine(snapshot?: Record<string, unknown>): Promise<unknown>;
  createEngineFromYrsState(state: Uint8Array): Promise<unknown>;
  flushUndoCapture(): Promise<unknown>;
  syncApply(u: Uint8Array, context?: unknown): Promise<unknown>;
  recordProviderDocApplyUpdateAdmission(metadata: ProviderDocApplyUpdateMetadata): void;
  encodeDiff(sv: Uint8Array): Promise<Uint8Array>;
  currentStateVector(): Promise<Uint8Array>;
  flushPendingUpdateV1(): Promise<void>;
  emit(update: Uint8Array): void;
}

const storageScope = {
  kind: 'scoped',
  scope: {
    tenantId: { kind: 'single-tenant' },
    workspaceId: { kind: 'no-workspace' },
    documentId: 'inbound-pending-remote-promotion-doc',
  },
} as const;

const versionDocumentScope: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'inbound-pending-remote-promotion-doc',
  principalScope: 'principal-1',
};

const INBOUND_VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

describe('RustDocument pending remote auto-promotion', () => {
  it('promotes captured pending remote segments after terminal sync bookkeeping', async () => {
    const versionProvider = createInitializedVersionProvider();
    await initializeVersionProvider(versionProvider);
    const capturePendingRemoteSegment = jest.fn(async () =>
      pendingRemoteCaptureSuccess('1'.repeat(64), '2'.repeat(64)),
    );
    const openPendingRemoteSegmentStore = jest.spyOn(
      versionProvider,
      'openPendingRemoteSegmentStore',
    );
    const doc = await makeDocument();
    await doc.installVersionSyncServices({
      provider: versionProvider,
      semanticMutationCapture: { capturePendingRemoteSegment } as never,
    });
    await doc.attachProvider(makeRecordingProvider('ProviderA'));

    const result = await doc.applyProviderUpdate(
      makeV2Envelope({
        payload: new Uint8Array([0x50, 0x51]),
        updateId: 'pending-remote-auto-promote-1',
      }),
    );

    expect(result).toMatchObject({
      status: 'applied',
      pendingRemotePromotionResult: {
        status: 'success',
        promotedSegmentIds: [],
        skipped: [],
        diagnostics: [],
      },
    });
    expect(capturePendingRemoteSegment).toHaveBeenCalledTimes(1);
    expect(openPendingRemoteSegmentStore).toHaveBeenCalledTimes(2);

    await doc.destroy();
  });

  it('does not promote when inbound provenance is not pending remote', async () => {
    const versionProvider = createInitializedVersionProvider();
    await initializeVersionProvider(versionProvider, 'graph-non-pending');
    const capturePendingRemoteSegment = jest.fn(async () =>
      pendingRemoteCaptureSuccess('3'.repeat(64), '4'.repeat(64)),
    );
    const promotePendingRemoteSegments = jest.fn(async () =>
      pendingRemotePromotionResult('success'),
    );
    const doc = await makeDocument();
    await doc.installVersionSyncServices({
      provider: versionProvider,
      semanticMutationCapture: { capturePendingRemoteSegment } as never,
      pendingRemotePromotionService: { promotePendingRemoteSegments },
    });
    await doc.attachProvider(makeRecordingProvider('ProviderA'));

    const result = await doc.applyProviderUpdate(
      makeEnvelope({
        payload: new Uint8Array([0x52, 0x53]),
        updateId: 'pending-remote-auto-promote-legacy-1',
      }),
    );

    expect(result.status).toBe('applied');
    expect(result).not.toHaveProperty('pendingRemotePromotionResult');
    expect(capturePendingRemoteSegment).not.toHaveBeenCalled();
    expect(promotePendingRemoteSegments).not.toHaveBeenCalled();

    await doc.destroy();
  });

  it('surfaces failed promotion results without rejecting the applied update', async () => {
    const versionProvider = createInitializedVersionProvider();
    await initializeVersionProvider(versionProvider, 'graph-promotion-failed');
    const capturePendingRemoteSegment = jest.fn(async () =>
      pendingRemoteCaptureSuccess('5'.repeat(64), '6'.repeat(64)),
    );
    const promotionResult = pendingRemotePromotionResult('failed');
    const promotePendingRemoteSegments = jest.fn(async () => promotionResult);
    const doc = await makeDocument();
    await doc.installVersionSyncServices({
      provider: versionProvider,
      semanticMutationCapture: { capturePendingRemoteSegment } as never,
      pendingRemotePromotionService: { promotePendingRemoteSegments },
    });
    await doc.attachProvider(makeRecordingProvider('ProviderA'));

    const result = await doc.applyProviderUpdate(
      makeV2Envelope({
        payload: new Uint8Array([0x54, 0x55]),
        updateId: 'pending-remote-auto-promote-failed-1',
      }),
    );

    expect(result).toMatchObject({
      status: 'applied',
      pendingRemotePromotionResult: promotionResult,
    });
    expect(promotePendingRemoteSegments).toHaveBeenCalledTimes(1);

    await doc.destroy();
  });
});

function makeStubBridge(): StubBridge {
  const subscribers = new Set<(u: Uint8Array) => void>();
  const emit = (update: Uint8Array) => {
    for (const cb of subscribers) cb(update);
  };
  return {
    subscribeUpdateV1(cb) {
      subscribers.add(cb);
      return {
        unsubscribe: () => {
          subscribers.delete(cb);
        },
      };
    },
    createEngine: async () => ({ recalc: { changedCells: [] } }),
    createEngineFromYrsState: async () => ({ recalc: { changedCells: [] } }),
    flushUndoCapture: async () => ({ recalc: { changedCells: [] } }),
    syncApply: async (u: Uint8Array) => {
      emit(u);
      return { recalc: { changedCells: [] } };
    },
    recordProviderDocApplyUpdateAdmission() {},
    encodeDiff: async () => new Uint8Array(),
    currentStateVector: async () => new Uint8Array(),
    flushPendingUpdateV1: async () => {},
    emit,
  };
}

async function makeDocument(): Promise<RustDocument> {
  const doc = new RustDocument({
    docId: versionDocumentScope.documentId,
    computeBridge: makeStubBridge() as never,
    internal: true,
    skipPersistenceLoad: true,
  });
  await doc.ready;
  return doc;
}

function createInitializedVersionProvider(): ReturnType<typeof createInMemoryVersionStoreProvider> {
  return createInMemoryVersionStoreProvider({
    documentScope: versionDocumentScope,
    backend: new InMemoryVersionDocumentProviderBackend(),
    durability: 'inbound-update-test-double',
  });
}

function makeRecordingProvider(name: string): Provider {
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

function makeEnvelope(
  overrides: Partial<ProviderInboundUpdateEnvelope> = {},
): ProviderInboundUpdateEnvelope {
  const payload = overrides.payload ?? new Uint8Array([0x01, 0x02, 0x03]);
  return {
    providerRefId: 'ProviderA',
    authorityRef: 'authority-1',
    storageScope,
    decisionId: 'decision-1',
    sessionId: 'local-session-1',
    payloadKind: 'yrs-update-v1',
    payload,
    payloadHash: sha256Hex(payload),
    updateId: `update-${Math.random().toString(36).slice(2)}`,
    providerEpoch: '1',
    authorityProof: proof(['payloadHash', 'updateId']),
    ...overrides,
  };
}

function makeV2Envelope(
  overrides: Partial<ProviderInboundUpdateEnvelopeV2> = {},
): ProviderInboundUpdateEnvelopeV2 {
  const v1 = makeEnvelope(overrides);
  const provenance = overrides.provenance ?? makeLiveProvenance(v1);
  const provenancePayloadHash = provenance.updateIdentity.provenancePayloadHash ?? 'c'.repeat(64);
  return {
    ...v1,
    schemaVersion: 'provider-inbound-update-v2',
    provenance,
    authorityProof:
      overrides.authorityProof ??
      proof(
        [
          ...PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
          ...PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
          'providerId',
          'providerKind',
        ],
        provenancePayloadHash,
      ),
  };
}

function makeLiveProvenance(
  envelope: ProviderInboundUpdateEnvelope,
  overrides: Partial<SyncUpdateProvenance> = {},
): SyncUpdateProvenance {
  const provenancePayloadHash = 'c'.repeat(64);
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
      provenancePayloadHash,
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

async function initializeVersionProvider(
  provider: {
    initializeGraph(input: VersionGraphInitializeInput): Promise<VersionGraphInitializeResult>;
  },
  graphId = 'graph-1',
): Promise<VersionGraphNamespace> {
  const initialized = await provider.initializeGraph(await initializeInput(graphId));
  expect(initialized.status).toBe('success');
  if (initialized.status !== 'success') {
    throw new Error(`expected initialize success: ${initialized.diagnostics[0]?.code}`);
  }
  return namespaceForDocumentScope(versionDocumentScope, graphId);
}

async function initializeInput(graphId: string): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(versionDocumentScope, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(
        'workbook.snapshotRoot.v1',
        { label: 'root', sheets: [] },
        namespace,
      ),
      semanticChangeSetRecord: await objectRecord(
        'workbook.semanticChangeSet.v1',
        { label: 'root', changes: [] },
        namespace,
      ),
      author: INBOUND_VERSION_AUTHOR,
      createdAt: '2026-06-20T00:00:00.000Z',
      completenessDiagnostics: [],
    },
  };
}

async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  namespace: VersionGraphNamespace,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

function pendingRemoteCaptureSuccess(segmentHex: string, mutationHex: string): unknown {
  return {
    status: 'success',
    reservationStatus: 'created',
    record: {
      pendingRemoteSegmentId: `pending-remote-segment:sha256:${segmentHex}`,
      mutationSegmentDigest: { algorithm: 'sha256', digest: mutationHex },
    },
    capturedRecordSequences: [1],
    diagnostics: [],
  };
}

function pendingRemotePromotionResult(
  status: PendingRemotePromotionResult['status'],
): PendingRemotePromotionResult {
  return {
    status,
    promotedSegmentIds:
      status === 'success' ? [`pending-remote-segment:sha256:${'1'.repeat(64)}`] : [],
    commitIds: status === 'success' ? [`commit:sha256:${'2'.repeat(64)}` as never] : [],
    skipped: [],
    diagnostics:
      status === 'success'
        ? []
        : [
            {
              code: 'VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED',
              severity: 'error',
              message: 'Promotion failed.',
              reason: 'graph-write-failed',
            },
          ],
  };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
