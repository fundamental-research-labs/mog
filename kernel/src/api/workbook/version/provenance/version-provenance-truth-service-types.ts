import type { PendingRemotePromotionService } from '../../../../document/version-store/pending-remote-promotion-service';
import type { VersionStoreProvider } from '../../../../document/version-store/provider';
import type { VersionProviderWriteActivityTracker } from '../../../../document/version-store/provider-write-activity';
import type { SemanticMutationCaptureServices } from '../../../../document/version-store/semantic-mutation-capture';
import type { SnapshotRootByteSyncPort } from '../../../../document/version-store/snapshot-root-capture';
import type { DocumentByteSyncPort } from '../../../../document/providers/provider';

export type WorkbookVersionProvenanceTruthRequirement =
  | 'provider'
  | 'providerGraphWriteCapabilities'
  | 'providerInboundUpdateEnvelopeValidation'
  | 'rawAndLegacySyncClassification'
  | 'syncApplyAdmissionContext'
  | 'providerCycleEvidence'
  | 'appliedSyncUpdateIdentityStore'
  | 'syncBatchStatusStore'
  | 'pendingRemoteSegmentStore'
  | 'pendingRemoteSegmentCapture'
  | 'snapshotRootByteSyncPort'
  | 'pendingRemotePromotionService'
  | 'providerWriteActivityTracker';

export type WorkbookVersionProvenanceTruthRequirementStatus = {
  readonly requirement: WorkbookVersionProvenanceTruthRequirement;
  readonly attached: boolean;
};

export type WorkbookVersionProvenanceTruth = {
  readonly schemaVersion: 1;
  readonly source: 'provider-backed-sync-provenance';
  readonly vc09ProvenanceTruthComplete: boolean;
  readonly requirements: readonly WorkbookVersionProvenanceTruthRequirementStatus[];
  readonly statusProjection: WorkbookVersionProvenanceStatusProjection;
};

export type WorkbookVersionProvenanceTruthService = {
  readonly vc09ProvenanceTruthComplete: boolean;
  readonly vc09ProvenanceTruth: WorkbookVersionProvenanceTruth;
  readonly vc09ProvenanceStatusProjection: WorkbookVersionProvenanceStatusProjection;
};

export type WorkbookVersionProvenanceStatusClassification =
  | 'blockedBatchFailure'
  | 'mixedRemote'
  | 'legacyRawUnknown'
  | 'quarantine'
  | 'disconnect';

export type WorkbookVersionProvenanceStatusProjectionItem = {
  readonly classification: WorkbookVersionProvenanceStatusClassification;
  readonly publicStatusCode: `version.provenanceAdmission.status.${WorkbookVersionProvenanceStatusClassification}`;
  readonly safe: false;
  readonly complete: false;
  readonly projectedSafety: 'unsafe';
  readonly projectedCompleteness: 'blocked';
  readonly redaction: 'classification-only';
  readonly rawProviderMaterialIncluded: false;
  readonly rawClientMaterialIncluded: false;
  readonly commitGrouping?: 'blockedBatchFailure' | 'blockedMixedRemote';
  readonly sourceKind?: 'legacyRawUnknown';
  readonly lifecycleClassification?: 'quarantine' | 'disconnect';
};

export type WorkbookVersionProvenanceStatusProjection = {
  readonly schemaVersion: 1;
  readonly source: 'provider-backed-sync-provenance-status';
  readonly redaction: 'classification-only';
  readonly classifications: readonly WorkbookVersionProvenanceStatusProjectionItem[];
};

export type WorkbookVersionProvenanceProviderCycleEvidence = {
  readonly schemaVersion: 1;
  readonly source: 'vc09-provider-cycle-evidence';
  readonly redaction: 'classification-only';
  readonly providerInboundUpdateEnvelopeValidation: true;
  readonly rawAndLegacySyncClassification: true;
  readonly syncApplyAdmissionContext: true;
  readonly appliedSyncUpdateIdentityStore: true;
  readonly syncBatchStatusStore: true;
  readonly pendingRemoteSegmentCapture: true;
  readonly pendingRemotePromotionService: true;
  readonly providerWriteActivityTracker: true;
  readonly mixedRemoteProjectsAsBlocked: true;
  readonly blockedBatchFailureProjectsAsBlocked: true;
  readonly rawProviderMaterialIncluded: false;
  readonly rawClientMaterialIncluded: false;
};

export type PendingRemotePromotionServiceLike = Pick<
  PendingRemotePromotionService,
  'promotePendingRemoteSegments'
> &
  Partial<Pick<PendingRemotePromotionService, 'providerWriteActivityTracker'>>;

export type DocumentByteSyncProvenanceAdmissionPort = Pick<
  DocumentByteSyncPort,
  'applyUpdate' | 'applyUpdateWithProvenance' | 'applyProviderEnvelope' | 'applyClassifiedRawUpdate'
>;

export type ProviderBackedWorkbookVersionProvenanceTruthServiceOptions = {
  readonly provider?: VersionStoreProvider;
  readonly semanticMutationCapture?: SemanticMutationCaptureServices;
  readonly snapshotRootByteSyncPort?: SnapshotRootByteSyncPort;
  readonly pendingRemotePromotionService?: PendingRemotePromotionServiceLike;
  readonly providerWriteActivityTracker?: VersionProviderWriteActivityTracker;
};
