import { jest } from '@jest/globals';

import {
  createInMemoryVersionStoreProvider,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import { attachWorkbookVersioning } from '../version-wiring';
import { WorkbookVersionImpl } from '../version';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
const PROVENANCE_STATUS_CODES = [
  'version.provenanceAdmission.status.blockedBatchFailure',
  'version.provenanceAdmission.status.mixedRemote',
  'version.provenanceAdmission.status.legacyRawUnknown',
  'version.provenanceAdmission.status.quarantine',
  'version.provenanceAdmission.status.disconnect',
] as const;
const PROVIDER_CYCLE_EVIDENCE = Object.freeze({
  schemaVersion: 1,
  source: 'vc09-provider-cycle-evidence',
  redaction: 'classification-only',
  providerInboundUpdateEnvelopeValidation: true,
  rawAndLegacySyncClassification: true,
  syncApplyAdmissionContext: true,
  appliedSyncUpdateIdentityStore: true,
  syncBatchStatusStore: true,
  pendingRemoteSegmentCapture: true,
  pendingRemotePromotionService: true,
  providerWriteActivityTracker: true,
  mixedRemoteProjectsAsBlocked: true,
  blockedBatchFailureProjectsAsBlocked: true,
  rawProviderMaterialIncluded: false,
  rawClientMaterialIncluded: false,
});

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    computeBridge: {},
    writeGate: {
      assertWritable: jest.fn(),
    },
    services: {
      undo: {},
    },
    floatingObjectManager: {
      dispose: jest.fn(),
    },
    ...overrides,
  } as any;
}

function createDocumentByteSyncPortStub(
  options: { readonly providerCycleEvidence?: boolean } = {},
) {
  return {
    docId: DOCUMENT_SCOPE.documentId,
    applyUpdate: jest.fn(async () => undefined),
    encodeDiff: jest.fn(async () => new Uint8Array([0x01])),
    currentStateVector: jest.fn(async () => new Uint8Array([0x02])),
    applyUpdateWithProvenance: jest.fn(async () => undefined),
    applyProviderEnvelope: jest.fn(async () => undefined),
    applyClassifiedRawUpdate: jest.fn(async () => undefined),
    ...(options.providerCycleEvidence
      ? { vc09ProviderCycleEvidence: PROVIDER_CYCLE_EVIDENCE }
      : {}),
  };
}

describe('WorkbookVersion provenance status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not advertise provenance from pending remote promotion plumbing alone', async () => {
    const promotePendingRemoteSegments = jest.fn();
    const version = new WorkbookVersionImpl(
      createMockCtx({
        versioning: {
          pendingRemotePromotionService: {
            promotePendingRemoteSegments,
          },
        },
      }),
    );

    const status = await version.getStatus();

    expect(status.rolloutStage).toBe('disabled');
    expect(status.provenanceAdmission).toMatchObject({
      stage: 'unavailable',
      available: false,
    });
    expect(status.provenanceAdmission.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'version.provenanceAdmission.vc09TruthUnavailable',
        'version.provenanceAdmission.mutationAdmissionFoundationPresent',
        'version.provenancePromotion.serviceAttached',
      ]),
    );
    expect(status.provenanceAdmission.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'version.provenanceAdmission.vc09TruthUnavailable',
          data: expect.objectContaining({
            requiredSlice: 'VC-09',
            pendingRemotePromotionServiceAttached: true,
          }),
        }),
      ]),
    );
    expect(status.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['version.provenancePromotion.serviceAttached']),
    );
    expect(promotePendingRemoteSegments).not.toHaveBeenCalled();
  });

  it('advertises provenance only from an explicit complete VC09 truth signal', async () => {
    const version = new WorkbookVersionImpl(
      createMockCtx({
        versioning: {
          provenanceTruthService: {
            vc09ProvenanceTruthComplete: true,
          },
        },
      }),
    );

    const status = await version.getStatus();

    expect(status.rolloutStage).toBe('shadow-only');
    expect(status.provenanceAdmission).toMatchObject({
      stage: 'present',
      available: true,
    });
    expect(status.provenanceAdmission.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['version.provenanceAdmission.present']),
    );
  });

  it('advertises provenance from the real provider-backed VC09 truth attachment', async () => {
    const ctx = createMockCtx();
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const syncPort = createDocumentByteSyncPortStub({ providerCycleEvidence: true });

    attachWorkbookVersioning(ctx, {
      provider,
      snapshotRootByteSyncPort: syncPort,
    });

    const versioning = ctx.versioning as {
      readonly provenanceTruthService?: {
        readonly vc09ProvenanceTruthComplete?: boolean;
        readonly vc09ProvenanceTruth?: {
          readonly source?: string;
          readonly vc09ProvenanceTruthComplete?: boolean;
          readonly requirements?: readonly { readonly attached: boolean }[];
        };
        readonly vc09ProvenanceStatusProjection?: {
          readonly redaction?: string;
        };
      };
    };
    expect(versioning.provenanceTruthService).toMatchObject({
      vc09ProvenanceTruthComplete: true,
      vc09ProvenanceStatusProjection: {
        redaction: 'classification-only',
      },
      vc09ProvenanceTruth: {
        source: 'provider-backed-sync-provenance',
        vc09ProvenanceTruthComplete: true,
      },
    });
    expect(
      versioning.provenanceTruthService?.vc09ProvenanceTruth?.requirements?.every(
        (requirement) => requirement.attached,
      ),
    ).toBe(true);

    const status = await new WorkbookVersionImpl(ctx).getStatus();

    expect(status.rolloutStage).toBe('shadow-only');
    expect(status.provenanceAdmission).toMatchObject({
      stage: 'present',
      available: true,
    });
    expect(status.provenanceAdmission.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['version.provenanceAdmission.present', ...PROVENANCE_STATUS_CODES]),
    );
    for (const code of PROVENANCE_STATUS_CODES) {
      expect(status.provenanceAdmission.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code,
            data: expect.objectContaining({
              redaction: 'classification-only',
              rawProviderMaterialIncluded: false,
              rawClientMaterialIncluded: false,
              safe: false,
              complete: false,
              projectedSafety: 'unsafe',
              projectedCompleteness: 'blocked',
            }),
          }),
        ]),
      );
    }
    expect(syncPort.encodeDiff).not.toHaveBeenCalled();
    expect(syncPort.applyProviderEnvelope).not.toHaveBeenCalled();
  });

  it('does not attach complete provider-backed truth without provider-cycle evidence', async () => {
    const ctx = createMockCtx();
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const syncPort = createDocumentByteSyncPortStub();

    attachWorkbookVersioning(ctx, {
      provider,
      snapshotRootByteSyncPort: syncPort,
    });

    const versioning = ctx.versioning as {
      readonly provenanceTruthService?: unknown;
      readonly pendingRemotePromotionService?: unknown;
    };
    expect(versioning.pendingRemotePromotionService).toBeDefined();
    expect(versioning.provenanceTruthService).toBeUndefined();

    const status = await new WorkbookVersionImpl(ctx).getStatus();

    expect(status.rolloutStage).toBe('disabled');
    expect(status.provenanceAdmission).toMatchObject({
      stage: 'unavailable',
      available: false,
    });
    expect(status.provenanceAdmission.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'version.provenanceAdmission.vc09TruthUnavailable',
          data: expect.objectContaining({
            pendingRemotePromotionServiceAttached: true,
          }),
        }),
      ]),
    );
    expect(syncPort.encodeDiff).not.toHaveBeenCalled();
  });

  it('projects only redaction-safe provenance status classifications', async () => {
    const version = new WorkbookVersionImpl(
      createMockCtx({
        versioning: {
          provenanceTruthService: {
            vc09ProvenanceTruthComplete: true,
            vc09ProvenanceStatusProjection: {
              schemaVersion: 1,
              source: 'provider-backed-sync-provenance-status',
              redaction: 'classification-only',
              classifications: [
                {
                  classification: 'blockedBatchFailure',
                  safe: true,
                  complete: true,
                  providerRefId: 'provider-secret-ref',
                  payloadHash: 'raw-payload-hash',
                  updateId: 'raw-sync-update-id',
                  batchId: 'raw-sync-batch-id',
                  batchStatusId: 'raw-sync-batch-status-id',
                },
                {
                  classification: 'mixedRemote',
                  safe: true,
                  complete: true,
                  remoteSessionId: 'client-secret-session',
                  correlationId: 'client-secret-correlation',
                  stableOriginId: 'raw-stable-origin-id',
                  providerEpoch: 'raw-provider-epoch',
                  roomId: 'raw-sync-room-id',
                  sequence: 'raw-sync-sequence',
                },
                {
                  classification: 'legacyRawUnknown',
                  providerId: 'provider-secret-id',
                  orderedSubUpdatePayloadHashes: ['raw-sub-update-payload-hash'],
                },
                {
                  classification: 'quarantine',
                  quarantineRecordId: 'provider-secret-quarantine',
                },
                {
                  classification: 'disconnect',
                  clientId: 'client-secret-id',
                },
                {
                  classification: 'futureRawProviderClassification',
                  providerRefId: 'provider-secret-future',
                },
              ],
            },
          },
        },
      }),
    );

    const status = await version.getStatus();
    const diagnosticCodes = status.provenanceAdmission.diagnostics.map(
      (diagnostic) => diagnostic.code,
    );

    expect(diagnosticCodes).toEqual(
      expect.arrayContaining(['version.provenanceAdmission.present', ...PROVENANCE_STATUS_CODES]),
    );
    expect(diagnosticCodes).not.toContain(
      'version.provenanceAdmission.status.futureRawProviderClassification',
    );
    expect(status.provenanceAdmission.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'version.provenanceAdmission.status.blockedBatchFailure',
          data: expect.objectContaining({
            classification: 'blockedBatchFailure',
            commitGrouping: 'blockedBatchFailure',
            safe: false,
            complete: false,
            projectedSafety: 'unsafe',
            projectedCompleteness: 'blocked',
          }),
        }),
        expect.objectContaining({
          code: 'version.provenanceAdmission.status.mixedRemote',
          data: expect.objectContaining({
            classification: 'mixedRemote',
            commitGrouping: 'blockedMixedRemote',
            safe: false,
            complete: false,
            projectedSafety: 'unsafe',
            projectedCompleteness: 'blocked',
          }),
        }),
        expect.objectContaining({
          code: 'version.provenanceAdmission.status.legacyRawUnknown',
          data: expect.objectContaining({
            classification: 'legacyRawUnknown',
            sourceKind: 'legacyRawUnknown',
            safe: false,
            complete: false,
            projectedSafety: 'unsafe',
            projectedCompleteness: 'blocked',
          }),
        }),
        expect.objectContaining({
          code: 'version.provenanceAdmission.status.quarantine',
          data: expect.objectContaining({
            classification: 'quarantine',
            lifecycleClassification: 'quarantine',
            safe: false,
            complete: false,
            projectedSafety: 'unsafe',
            projectedCompleteness: 'blocked',
          }),
        }),
        expect.objectContaining({
          code: 'version.provenanceAdmission.status.disconnect',
          data: expect.objectContaining({
            classification: 'disconnect',
            lifecycleClassification: 'disconnect',
            safe: false,
            complete: false,
            projectedSafety: 'unsafe',
            projectedCompleteness: 'blocked',
          }),
        }),
      ]),
    );

    const publicStatusJson = JSON.stringify(status.provenanceAdmission);
    for (const rawMaterial of [
      'provider-secret-ref',
      'raw-payload-hash',
      'raw-sync-update-id',
      'raw-sync-batch-id',
      'raw-sync-batch-status-id',
      'client-secret-session',
      'client-secret-correlation',
      'raw-stable-origin-id',
      'raw-provider-epoch',
      'raw-sync-room-id',
      'raw-sync-sequence',
      'provider-secret-id',
      'raw-sub-update-payload-hash',
      'provider-secret-quarantine',
      'client-secret-id',
      'provider-secret-future',
    ]) {
      expect(publicStatusJson).not.toContain(rawMaterial);
    }
  });

  it('does not attach complete provider-backed truth with only a snapshot encoder', async () => {
    const ctx = createMockCtx();
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const encodeDiff = jest.fn(async () => new Uint8Array([0x01]));

    attachWorkbookVersioning(ctx, {
      provider,
      snapshotRootByteSyncPort: { encodeDiff },
    });

    const versioning = ctx.versioning as {
      readonly provenanceTruthService?: unknown;
      readonly pendingRemotePromotionService?: unknown;
    };
    expect(versioning.pendingRemotePromotionService).toBeDefined();
    expect(versioning.provenanceTruthService).toBeUndefined();

    const status = await new WorkbookVersionImpl(ctx).getStatus();

    expect(status.rolloutStage).toBe('disabled');
    expect(status.provenanceAdmission).toMatchObject({
      stage: 'unavailable',
      available: false,
    });
    expect(status.provenanceAdmission.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'version.provenanceAdmission.vc09TruthUnavailable',
          data: expect.objectContaining({
            pendingRemotePromotionServiceAttached: true,
          }),
        }),
      ]),
    );
    expect(encodeDiff).not.toHaveBeenCalled();
  });

  it('does not attach complete provider-backed truth without snapshot-root capture', async () => {
    const ctx = createMockCtx();
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });

    attachWorkbookVersioning(ctx, { provider });

    const versioning = ctx.versioning as {
      readonly provenanceTruthService?: unknown;
      readonly pendingRemotePromotionService?: unknown;
    };
    expect(versioning.pendingRemotePromotionService).toBeDefined();
    expect(versioning.provenanceTruthService).toBeUndefined();

    const status = await new WorkbookVersionImpl(ctx).getStatus();

    expect(status.rolloutStage).toBe('disabled');
    expect(status.provenanceAdmission).toMatchObject({
      stage: 'unavailable',
      available: false,
    });
    expect(status.provenanceAdmission.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'version.provenanceAdmission.vc09TruthUnavailable',
          data: expect.objectContaining({
            pendingRemotePromotionServiceAttached: true,
          }),
        }),
      ]),
    );
  });
});
