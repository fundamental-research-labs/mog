import {
  classifyLegacyProviderInboundUpdate,
  classifyLegacyRawUpdate,
  validateProviderInboundUpdateEnvelope,
  validateSyncUpdateProvenance,
} from '@mog-sdk/types-document/storage';

import { createAdmittedSyncApplyContext } from '../../../../bridges/compute/sync-apply-admission';
import { hasAppliedSyncUpdateIdentityStoreProvider } from '../../../../document/version-store/applied-sync-update-identity-store';
import { hasPendingRemoteSegmentStoreProvider } from '../../../../document/version-store/pending-remote-segment-store';
import type { VersionStoreProvider } from '../../../../document/version-store/provider';
import {
  isVersionProviderWriteActivityTracker,
  type VersionProviderWriteActivityTracker,
} from '../../../../document/version-store/provider-write-activity';
import type { SemanticMutationCaptureServices } from '../../../../document/version-store/semantic-mutation-capture';
import type { SnapshotRootByteSyncPort } from '../../../../document/version-store/snapshot-root-capture';
import { hasSyncBatchStatusStoreProvider } from '../../../../document/version-store/sync-batch-status-store';
import { WORKBOOK_VERSION_PROVENANCE_STATUS_PROJECTION } from './version-provenance-truth-service-status';
import type {
  DocumentByteSyncProvenanceAdmissionPort,
  PendingRemotePromotionServiceLike,
  ProviderBackedWorkbookVersionProvenanceTruthServiceOptions,
  WorkbookVersionProvenanceProviderCycleEvidence,
  WorkbookVersionProvenanceTruth,
  WorkbookVersionProvenanceTruthRequirement,
  WorkbookVersionProvenanceTruthRequirementStatus,
  WorkbookVersionProvenanceTruthService,
} from './version-provenance-truth-service-types';
import { isRecord } from './version-provenance-truth-service-utils';

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
