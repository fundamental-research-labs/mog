import { createHash } from 'node:crypto';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';
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
  MutationResult,
  SyncApplyMutationMetadataWire,
} from '../../bridges/compute/compute-types.gen';
import {
  createAdmittedSyncApplyContext,
  toSyncApplyOperationContextWire,
  type AdmittedSyncApplyContext,
} from '../../bridges/compute/sync-apply-admission';
import { RustDocument } from '../rust-document';
import type { Provider, ProviderDocApplyUpdateMetadata } from '../providers/provider';
import {
  appliedSyncUpdateIdentityKeyMaterialForOperationContext,
  type AppliedSyncUpdateIdentityStore,
} from '../version-store/applied-sync-update-identity-store';
import {
  VERSION_OBJECT_SCHEMA_VERSION,
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectType,
} from '../version-store/object-store';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
} from '../version-store/provider';
import { createSemanticMutationCapture } from '../version-store/semantic-mutation-capture';

type StubBridge = {
  subscribeUpdateV1(cb: (u: Uint8Array) => void): { unsubscribe: () => void };
  createEngine(): Promise<unknown>;
  createEngineFromYrsState(state: Uint8Array): Promise<unknown>;
  flushUndoCapture(): Promise<unknown>;
  syncApply(u: Uint8Array): Promise<unknown>;
  syncApplyWithMetadata(
    u: Uint8Array,
    syncApplyContext: AdmittedSyncApplyContext,
  ): Promise<{ mutationResult: MutationResult; metadata: SyncApplyMutationMetadataWire }>;
  recordProviderDocApplyUpdateAdmission(metadata: ProviderDocApplyUpdateMetadata): void;
  encodeDiff(stateVector: Uint8Array): Promise<Uint8Array>;
  currentStateVector(): Promise<Uint8Array>;
  flushPendingUpdateV1(): Promise<void>;
  readonly admissions: ProviderDocApplyUpdateMetadata[];
};

const VERSION_DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'pending-remote-sync-capture-doc',
  principalScope: 'principal-1',
};

const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'test-author-1',
  actorKind: 'user',
  displayName: 'Test Author',
};

const STORAGE_SCOPE = {
  kind: 'scoped',
  scope: {
    tenantId: { kind: 'single-tenant' },
    workspaceId: { kind: 'no-workspace' },
    documentId: VERSION_DOCUMENT_SCOPE.documentId,
  },
} as const;

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('RustDocument pending remote sync capture', () => {
  it('captures semantic pending-remote segments and links them from applied identity terminal metadata', async () => {
    const versionProvider = createInMemoryVersionStoreProvider({
      documentScope: VERSION_DOCUMENT_SCOPE,
      backend: new InMemoryVersionDocumentProviderBackend(),
      durability: 'inbound-update-test-double',
    });
    const namespace = await initializeVersionGraph(versionProvider, 'graph-pending-remote-sync');
    const identityStore = await versionProvider.openAppliedSyncUpdateIdentityStore();
    const pendingRemoteSegmentStore = await versionProvider.openPendingRemoteSegmentStore(namespace);
    const semanticMutationCapture = createSemanticMutationCapture({
      author: VERSION_AUTHOR,
      now: () => new Date('2026-06-21T00:00:00.000Z'),
    });
    const { doc, bridge } = await makeOrchestrator({ identityStore, semanticMutationCapture });
    await doc.installVersionSyncServices({
      provider: versionProvider,
      semanticMutationCapture,
    });
    await doc.attachProvider(makeProvider('ProviderA'));

    const envelope = makeEnvelope({
      payload: new Uint8Array([0x55, 0x56]),
      updateId: 'pending-remote-capture-1',
    });
    const result = await doc.applyProviderUpdate(envelope);

    expect(result.status).toBe('applied');
    expect(bridge.admissions).toHaveLength(1);
    const identityKey = await appliedIdentityKeyForAdmission(bridge.admissions[0]!);
    const identityRead = await identityStore.readByIdentityKey(identityKey);
    expect(identityRead).toMatchObject({
      status: 'found',
      record: {
        state: 'applied',
        terminal: {
          status: 'applied',
          pendingRemoteSegmentId: expect.stringMatching(
            /^pending-remote-segment:sha256:[0-9a-f]{64}$/,
          ),
          mutationSegmentDigest: {
            algorithm: 'sha256',
            digest: expect.stringMatching(/^[0-9a-f]{64}$/),
          },
        },
      },
    });
    if (identityRead.status !== 'found' || identityRead.record.terminal?.status !== 'applied') {
      throw new Error('expected applied identity terminal');
    }

    const pendingRemoteSegmentId = identityRead.record.terminal.pendingRemoteSegmentId!;
    await expect(
      pendingRemoteSegmentStore.readBySegmentId(pendingRemoteSegmentId as never),
    ).resolves.toMatchObject({
      status: 'found',
      record: {
        pendingRemoteSegmentId,
        state: 'pending',
        mutationSegmentDigest: identityRead.record.terminal.mutationSegmentDigest,
        operationContext: {
          collaboration: {
            commitGrouping: 'pendingRemote',
            updateId: envelope.updateId,
          },
        },
      },
    });

    await doc.destroy();
  });
});

async function makeOrchestrator(options: {
  readonly identityStore: AppliedSyncUpdateIdentityStore;
  readonly semanticMutationCapture: ReturnType<typeof createSemanticMutationCapture>;
}): Promise<{ doc: RustDocument; bridge: StubBridge }> {
  const bridge = makeBridge(options.semanticMutationCapture);
  const doc = new RustDocument({
    docId: VERSION_DOCUMENT_SCOPE.documentId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    computeBridge: bridge as any,
    internal: true,
    skipPersistenceLoad: true,
    appliedSyncUpdateIdentityStore: options.identityStore,
  });
  await doc.ready;
  return { doc, bridge };
}

function makeBridge(
  semanticMutationCapture: ReturnType<typeof createSemanticMutationCapture>,
): StubBridge {
  const subscribers = new Set<(u: Uint8Array) => void>();
  const admissions: ProviderDocApplyUpdateMetadata[] = [];
  return {
    subscribeUpdateV1(cb) {
      subscribers.add(cb);
      return { unsubscribe: () => subscribers.delete(cb) };
    },
    createEngine: async () => ({ recalc: { changedCells: [] } }),
    createEngineFromYrsState: async () => ({ recalc: { changedCells: [] } }),
    flushUndoCapture: async () => ({ recalc: { changedCells: [] } }),
    syncApply: async (update) => {
      for (const subscriber of subscribers) subscriber(update);
      return { recalc: { changedCells: [] } };
    },
    syncApplyWithMetadata: async (update, syncApplyContext) => {
      const mutationResult = syncAuthoredCellMutationResult();
      semanticMutationCapture.mutationCapture.recordMutationResult({
        operation: 'compute_apply_sync_update',
        operationContext: syncApplyContext.operationContext,
        result: mutationResult,
      });
      for (const subscriber of subscribers) subscriber(update);
      return {
        mutationResult,
        metadata: {
          mutationResult,
          provenanceReport: {
            appliedContext: toSyncApplyOperationContextWire(syncApplyContext),
            pendingSegmentStatus: 'notEvaluated',
            pendingSegmentIds: [],
            batchDurabilityStatus: 'notEvaluated',
          },
        } as SyncApplyMutationMetadataWire,
      };
    },
    recordProviderDocApplyUpdateAdmission(metadata) {
      admissions.push(metadata);
    },
    encodeDiff: async () => new Uint8Array(),
    currentStateVector: async () => new Uint8Array(),
    flushPendingUpdateV1: async () => {},
    admissions,
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

function makeEnvelope(
  overrides: Partial<ProviderInboundUpdateEnvelopeV2> = {},
): ProviderInboundUpdateEnvelopeV2 {
  const {
    provenance: provenanceOverride,
    authorityProof: authorityProofOverride,
    ...baseOverrides
  } = overrides;
  const payload = overrides.payload ?? new Uint8Array([0x10, 0x20]);
  const payloadHash = overrides.payloadHash ?? sha256Hex(payload);
  const base = {
    providerRefId: 'ProviderA',
    authorityRef: 'authority-1',
    storageScope: STORAGE_SCOPE,
    decisionId: 'decision-1',
    sessionId: 'local-session-1',
    payloadKind: 'yrs-update-v1' as const,
    payload,
    payloadHash,
    updateId: 'pending-remote-capture-update-1',
    providerEpoch: '1',
    schemaVersion: 'provider-inbound-update-v2' as const,
    ...baseOverrides,
  };
  const provenance = provenanceOverride ?? liveProvenance(base);
  return {
    ...base,
    provenance,
    authorityProof:
      authorityProofOverride ??
      proof(
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

function liveProvenance(envelope: {
  readonly providerRefId: string;
  readonly authorityRef: string;
  readonly storageScope: typeof STORAGE_SCOPE;
  readonly providerEpoch: string;
  readonly updateId: string;
  readonly payloadHash: string;
}): SyncUpdateProvenance {
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
      remoteAuthorRef: { kind: 'opaque-subject-ref', value: 'subject-ref-1' },
    },
    remoteSessionId: 'remote-session-1',
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
  canonicalPayloadHash: string,
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

function syncAuthoredCellMutationResult(): MutationResult {
  return {
    recalc: {
      changedCells: [],
      projectionChanges: [],
      errors: [],
      validationAnnotations: [],
      metrics: {},
    },
    authoredCellChanges: [
      {
        cellId: 'remote-cell-1',
        sheetId: 'sheet-remote-1',
        position: { row: 0, col: 0 },
        oldValue: null,
        value: 'Remote',
        extraFlags: 0,
      },
    ],
  } as unknown as MutationResult;
}

async function initializeVersionGraph(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
  graphId: string,
): Promise<VersionGraphNamespace> {
  const namespace = namespaceForDocumentScope(VERSION_DOCUMENT_SCOPE, graphId);
  const initialized = await provider.initializeGraph({
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await versionObjectRecord(namespace, 'workbook.snapshotRoot.v1', {
        sheets: [],
      }),
      semanticChangeSetRecord: await versionObjectRecord(
        namespace,
        'workbook.semanticChangeSet.v1',
        { changes: [] },
      ),
      author: VERSION_AUTHOR,
      createdAt: '2026-06-21T00:00:00.000Z',
      completenessDiagnostics: [],
    },
  });
  expect(initialized.status).toBe('success');
  return namespace;
}

function versionObjectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
) {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: VERSION_OBJECT_SCHEMA_VERSION,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

async function appliedIdentityKeyForAdmission(
  metadata: ProviderDocApplyUpdateMetadata,
): Promise<string> {
  const { identityKey } = await appliedSyncUpdateIdentityKeyMaterialForOperationContext(
    createAdmittedSyncApplyContext(metadata).operationContext,
  );
  return identityKey;
}
