import {
  classifyLegacyProviderInboundUpdate,
  classifyLegacyRawUpdate,
  validateProviderInboundUpdateEnvelope,
  validateSyncUpdateProvenance,
} from '@mog-sdk/types-document/storage';
import type { WorkbookVersionDiagnostic } from '@mog-sdk/contracts/api';

import { createAdmittedSyncApplyContext } from '../../bridges/compute/sync-apply-admission';
import { hasAppliedSyncUpdateIdentityStoreProvider } from '../../document/version-store/applied-sync-update-identity-store';
import { hasPendingRemoteSegmentStoreProvider } from '../../document/version-store/pending-remote-segment-store';
import type { PendingRemotePromotionService } from '../../document/version-store/pending-remote-promotion-service';
import type { VersionStoreProvider } from '../../document/version-store/provider';
import {
  isVersionProviderWriteActivityTracker,
  type VersionProviderWriteActivityTracker,
} from '../../document/version-store/provider-write-activity';
import type { SemanticMutationCaptureServices } from '../../document/version-store/semantic-mutation-capture';
import type { SnapshotRootByteSyncPort } from '../../document/version-store/snapshot-root-capture';
import { hasSyncBatchStatusStoreProvider } from '../../document/version-store/sync-batch-status-store';
import type { DocumentByteSyncPort } from '../../document/providers/provider';

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

type PendingRemotePromotionServiceLike = Pick<
  PendingRemotePromotionService,
  'promotePendingRemoteSegments'
> &
  Partial<Pick<PendingRemotePromotionService, 'providerWriteActivityTracker'>>;

type DocumentByteSyncProvenanceAdmissionPort = Pick<
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

export function createProviderBackedWorkbookVersionProvenanceTruthService(
  options: ProviderBackedWorkbookVersionProvenanceTruthServiceOptions,
): WorkbookVersionProvenanceTruthService | undefined {
  const truth = providerBackedWorkbookVersionProvenanceTruth(options);
  if (!truth.vc09ProvenanceTruthComplete) return undefined;
  return Object.freeze({
    vc09ProvenanceTruthComplete: true,
    vc09ProvenanceTruth: truth,
    vc09ProvenanceStatusProjection: truth.statusProjection,
  });
}

export function providerBackedWorkbookVersionProvenanceTruth(
  options: ProviderBackedWorkbookVersionProvenanceTruthServiceOptions,
): WorkbookVersionProvenanceTruth {
  const provider = options.provider;
  const requirements: WorkbookVersionProvenanceTruthRequirementStatus[] = [
    requirement('provider', isVersionStoreProvider(provider)),
    requirement('providerGraphWriteCapabilities', hasRequiredGraphWriteCapabilities(provider)),
    requirement(
      'providerInboundUpdateEnvelopeValidation',
      hasProviderInboundUpdateEnvelopeValidation(options.snapshotRootByteSyncPort),
    ),
    requirement(
      'rawAndLegacySyncClassification',
      hasRawAndLegacySyncClassification(options.snapshotRootByteSyncPort),
    ),
    requirement('syncApplyAdmissionContext', typeof createAdmittedSyncApplyContext === 'function'),
    requirement('providerCycleEvidence', hasProviderCycleEvidence(options)),
    requirement(
      'appliedSyncUpdateIdentityStore',
      hasAppliedSyncUpdateIdentityStoreProvider(provider),
    ),
    requirement('syncBatchStatusStore', hasSyncBatchStatusStoreProvider(provider)),
    requirement('pendingRemoteSegmentStore', hasPendingRemoteSegmentStoreProvider(provider)),
    requirement(
      'pendingRemoteSegmentCapture',
      isSemanticMutationCaptureWithPendingRemoteSegment(options.semanticMutationCapture),
    ),
    requirement(
      'snapshotRootByteSyncPort',
      isSnapshotRootByteSyncPort(options.snapshotRootByteSyncPort),
    ),
    requirement(
      'pendingRemotePromotionService',
      isPendingRemotePromotionService(
        options.pendingRemotePromotionService,
        options.providerWriteActivityTracker,
      ),
    ),
    requirement(
      'providerWriteActivityTracker',
      isVersionProviderWriteActivityTracker(options.providerWriteActivityTracker),
    ),
  ];

  const vc09ProvenanceTruthComplete = requirements.every((item) => item.attached);
  return Object.freeze({
    schemaVersion: 1,
    source: 'provider-backed-sync-provenance',
    vc09ProvenanceTruthComplete,
    requirements: Object.freeze(requirements),
    statusProjection: WORKBOOK_VERSION_PROVENANCE_STATUS_PROJECTION,
  });
}

export function readWorkbookVersionProvenanceStatusProjection(
  value: unknown,
): WorkbookVersionProvenanceStatusProjection | null {
  const projection = findWorkbookVersionProvenanceStatusProjection(value);
  if (!projection) return null;
  const classifications = normalizeStatusProjectionItems(projection.classifications);
  if (classifications.length === 0) return null;

  return Object.freeze({
    schemaVersion: 1,
    source: 'provider-backed-sync-provenance-status',
    redaction: 'classification-only',
    classifications: Object.freeze(classifications),
  });
}

export function projectWorkbookVersionProvenanceStatusDiagnostics(
  candidates: readonly unknown[],
): readonly WorkbookVersionDiagnostic[] {
  for (const candidate of candidates) {
    const projection = readWorkbookVersionProvenanceStatusProjection(candidate);
    if (!projection) continue;
    return Object.freeze(projection.classifications.map(provenanceStatusDiagnostic));
  }
  return [];
}

function requirement(
  requirementName: WorkbookVersionProvenanceTruthRequirement,
  attached: boolean,
): WorkbookVersionProvenanceTruthRequirementStatus {
  return Object.freeze({ requirement: requirementName, attached });
}

function isVersionStoreProvider(value: unknown): value is VersionStoreProvider {
  return (
    isRecord(value) &&
    isRecord(value.capabilities) &&
    typeof value.readGraphRegistry === 'function' &&
    typeof value.openGraph === 'function'
  );
}

function hasRequiredGraphWriteCapabilities(provider: VersionStoreProvider | undefined): boolean {
  if (!provider) return false;
  const capabilities = provider.capabilities;
  return (
    capabilities.reads.graphRegistry &&
    capabilities.reads.objects &&
    capabilities.reads.refs &&
    capabilities.reads.commits &&
    capabilities.writes.putObjects &&
    capabilities.writes.updateRefs &&
    capabilities.writes.commitGraphWrite
  );
}

function isSemanticMutationCaptureWithPendingRemoteSegment(
  value: SemanticMutationCaptureServices | undefined,
): value is SemanticMutationCaptureServices {
  return (
    isRecord(value) &&
    isRecord(value.mutationCapture) &&
    typeof value.mutationCapture.recordMutationResult === 'function' &&
    typeof value.captureNormalCommit === 'function' &&
    typeof value.capturePendingRemoteSegment === 'function' &&
    typeof value.resetNormalCaptureForCheckout === 'function'
  );
}

function isSnapshotRootByteSyncPort(
  value: SnapshotRootByteSyncPort | undefined,
): value is SnapshotRootByteSyncPort {
  return isRecord(value) && typeof value.encodeDiff === 'function';
}

function hasProviderCycleEvidence(
  options: ProviderBackedWorkbookVersionProvenanceTruthServiceOptions,
): boolean {
  return [
    options.snapshotRootByteSyncPort,
    options.semanticMutationCapture,
    options.pendingRemotePromotionService,
    options.providerWriteActivityTracker,
    options.provider,
  ].some((candidate) =>
    isWorkbookVersionProvenanceProviderCycleEvidence(providerCycleEvidenceFrom(candidate)),
  );
}

function providerCycleEvidenceFrom(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return (
    value.vc09ProviderCycleEvidence ??
    value.providerCycleEvidence ??
    value.provenanceProviderCycleEvidence ??
    value
  );
}

function isWorkbookVersionProvenanceProviderCycleEvidence(
  value: unknown,
): value is WorkbookVersionProvenanceProviderCycleEvidence {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    value.source === 'vc09-provider-cycle-evidence' &&
    value.redaction === 'classification-only' &&
    value.providerInboundUpdateEnvelopeValidation === true &&
    value.rawAndLegacySyncClassification === true &&
    value.syncApplyAdmissionContext === true &&
    value.appliedSyncUpdateIdentityStore === true &&
    value.syncBatchStatusStore === true &&
    value.pendingRemoteSegmentCapture === true &&
    value.pendingRemotePromotionService === true &&
    value.providerWriteActivityTracker === true &&
    value.mixedRemoteProjectsAsBlocked === true &&
    value.blockedBatchFailureProjectsAsBlocked === true &&
    value.rawProviderMaterialIncluded === false &&
    value.rawClientMaterialIncluded === false
  );
}

function isPendingRemotePromotionService(
  value: PendingRemotePromotionServiceLike | undefined,
  providerWriteActivityTracker: VersionProviderWriteActivityTracker | undefined,
): value is PendingRemotePromotionServiceLike {
  return (
    isRecord(value) &&
    typeof value.promotePendingRemoteSegments === 'function' &&
    isVersionProviderWriteActivityTracker(value.providerWriteActivityTracker) &&
    value.providerWriteActivityTracker === providerWriteActivityTracker
  );
}

function hasProviderInboundUpdateEnvelopeValidation(value: unknown): boolean {
  return (
    typeof validateProviderInboundUpdateEnvelope === 'function' &&
    typeof validateSyncUpdateProvenance === 'function' &&
    isDocumentByteSyncProvenanceAdmissionPort(value)
  );
}

function hasRawAndLegacySyncClassification(value: unknown): boolean {
  return (
    typeof classifyLegacyProviderInboundUpdate === 'function' &&
    typeof classifyLegacyRawUpdate === 'function' &&
    isDocumentByteSyncProvenanceAdmissionPort(value)
  );
}

function isDocumentByteSyncProvenanceAdmissionPort(
  value: unknown,
): value is DocumentByteSyncProvenanceAdmissionPort {
  return (
    isRecord(value) &&
    typeof value.applyUpdate === 'function' &&
    typeof value.applyUpdateWithProvenance === 'function' &&
    typeof value.applyProviderEnvelope === 'function' &&
    typeof value.applyClassifiedRawUpdate === 'function'
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

const WORKBOOK_VERSION_PROVENANCE_STATUS_PROJECTION = Object.freeze({
  schemaVersion: 1,
  source: 'provider-backed-sync-provenance-status',
  redaction: 'classification-only',
  classifications: Object.freeze([
    statusProjectionItem('blockedBatchFailure', {
      commitGrouping: 'blockedBatchFailure',
    }),
    statusProjectionItem('mixedRemote', {
      commitGrouping: 'blockedMixedRemote',
    }),
    statusProjectionItem('legacyRawUnknown', {
      sourceKind: 'legacyRawUnknown',
    }),
    statusProjectionItem('quarantine', {
      lifecycleClassification: 'quarantine',
    }),
    statusProjectionItem('disconnect', {
      lifecycleClassification: 'disconnect',
    }),
  ]),
}) satisfies WorkbookVersionProvenanceStatusProjection;

const WORKBOOK_VERSION_PROVENANCE_STATUS_PROJECTION_BY_CLASSIFICATION = new Map(
  WORKBOOK_VERSION_PROVENANCE_STATUS_PROJECTION.classifications.map((item) => [
    item.classification,
    item,
  ]),
);

function statusProjectionItem(
  classification: WorkbookVersionProvenanceStatusClassification,
  projection: Pick<
    WorkbookVersionProvenanceStatusProjectionItem,
    'commitGrouping' | 'sourceKind' | 'lifecycleClassification'
  >,
): WorkbookVersionProvenanceStatusProjectionItem {
  return Object.freeze({
    classification,
    publicStatusCode: `version.provenanceAdmission.status.${classification}`,
    safe: false,
    complete: false,
    projectedSafety: 'unsafe',
    projectedCompleteness: 'blocked',
    redaction: 'classification-only',
    rawProviderMaterialIncluded: false,
    rawClientMaterialIncluded: false,
    ...projection,
  });
}

function findWorkbookVersionProvenanceStatusProjection(
  value: unknown,
): WorkbookVersionProvenanceStatusProjection | null {
  if (isWorkbookVersionProvenanceStatusProjection(value)) return value;
  if (!isRecord(value)) return null;

  for (const candidate of [
    value.vc09ProvenanceStatusProjection,
    value.provenanceStatusProjection,
    value.statusProjection,
  ]) {
    if (isWorkbookVersionProvenanceStatusProjection(candidate)) return candidate;
  }

  for (const candidate of [value.vc09ProvenanceTruth, value.provenanceAdmissionTruth]) {
    if (!isRecord(candidate)) continue;
    if (isWorkbookVersionProvenanceStatusProjection(candidate.statusProjection)) {
      return candidate.statusProjection;
    }
  }

  return null;
}

function isWorkbookVersionProvenanceStatusProjection(
  value: unknown,
): value is WorkbookVersionProvenanceStatusProjection {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    value.redaction === 'classification-only' &&
    Array.isArray(value.classifications)
  );
}

function normalizeStatusProjectionItem(
  value: unknown,
): WorkbookVersionProvenanceStatusProjectionItem | null {
  if (!isRecord(value) || typeof value.classification !== 'string') return null;
  return (
    WORKBOOK_VERSION_PROVENANCE_STATUS_PROJECTION_BY_CLASSIFICATION.get(
      value.classification as WorkbookVersionProvenanceStatusClassification,
    ) ?? null
  );
}

function normalizeStatusProjectionItems(
  values: readonly unknown[],
): readonly WorkbookVersionProvenanceStatusProjectionItem[] {
  const seen = new Set<WorkbookVersionProvenanceStatusClassification>();
  const normalized: WorkbookVersionProvenanceStatusProjectionItem[] = [];
  for (const value of values) {
    const item = normalizeStatusProjectionItem(value);
    if (!item || seen.has(item.classification)) continue;
    seen.add(item.classification);
    normalized.push(item);
  }
  return normalized;
}

function provenanceStatusDiagnostic(
  item: WorkbookVersionProvenanceStatusProjectionItem,
): WorkbookVersionDiagnostic {
  return Object.freeze({
    code: item.publicStatusCode,
    severity: 'warning',
    message: provenanceStatusDiagnosticMessage(item.classification),
    dependency: 'version-service',
    data: provenanceStatusDiagnosticData(item),
  });
}

function provenanceStatusDiagnosticMessage(
  classification: WorkbookVersionProvenanceStatusClassification,
): string {
  switch (classification) {
    case 'blockedBatchFailure':
      return 'VC-09 provenance status projects sync batch failures as a blocked batch-failure classification.';
    case 'mixedRemote':
      return 'VC-09 provenance status projects aggregate remote authorship as a mixed remote classification.';
    case 'legacyRawUnknown':
      return 'VC-09 provenance status projects unclassified raw sync bytes as legacy raw unknown.';
    case 'quarantine':
      return 'VC-09 provenance status projects provider quarantine decisions without exposing provider material.';
    case 'disconnect':
      return 'VC-09 provenance status projects provider disconnect decisions without exposing client material.';
  }
}

function provenanceStatusDiagnosticData(
  item: WorkbookVersionProvenanceStatusProjectionItem,
): NonNullable<WorkbookVersionDiagnostic['data']> {
  return {
    requiredSlice: 'VC-09',
    classification: item.classification,
    safe: item.safe,
    complete: item.complete,
    projectedSafety: item.projectedSafety,
    projectedCompleteness: item.projectedCompleteness,
    redaction: item.redaction,
    rawProviderMaterialIncluded: item.rawProviderMaterialIncluded,
    rawClientMaterialIncluded: item.rawClientMaterialIncluded,
    ...(item.commitGrouping ? { commitGrouping: item.commitGrouping } : {}),
    ...(item.sourceKind ? { sourceKind: item.sourceKind } : {}),
    ...(item.lifecycleClassification
      ? { lifecycleClassification: item.lifecycleClassification }
      : {}),
  };
}
