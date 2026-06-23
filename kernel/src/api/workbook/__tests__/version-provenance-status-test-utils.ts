import { jest } from '@jest/globals';

import type { VersionDocumentScope } from '../../../document/version-store/provider';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

export const PROVENANCE_STATUS_CODES = [
  'version.provenanceAdmission.status.blockedBatchFailure',
  'version.provenanceAdmission.status.mixedRemote',
  'version.provenanceAdmission.status.legacyRawUnknown',
  'version.provenanceAdmission.status.quarantine',
  'version.provenanceAdmission.status.disconnect',
] as const;

export const PROVIDER_CYCLE_EVIDENCE = Object.freeze({
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

export function createMockCtx(overrides: Record<string, unknown> = {}) {
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

export function createDocumentByteSyncPortStub(
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
