import {
  classifyLegacyProviderInboundUpdate,
  classifyLegacyRawUpdate,
  validateProviderInboundUpdateEnvelope,
  validateSyncUpdateProvenance,
} from '@mog-sdk/types-document/storage';

import { createAdmittedSyncApplyContext } from '../../bridges/compute/sync-apply-admission';
import {
  hasAppliedSyncUpdateIdentityStoreProvider,
} from '../../document/version-store/applied-sync-update-identity-store';
import {
  hasPendingRemoteSegmentStoreProvider,
} from '../../document/version-store/pending-remote-segment-store';
import type {
  PendingRemotePromotionService,
} from '../../document/version-store/pending-remote-promotion-service';
import type { VersionStoreProvider } from '../../document/version-store/provider';
import {
  isVersionProviderWriteActivityTracker,
  type VersionProviderWriteActivityTracker,
} from '../../document/version-store/provider-write-activity';
import type {
  SemanticMutationCaptureServices,
} from '../../document/version-store/semantic-mutation-capture';
import type { SnapshotRootByteSyncPort } from '../../document/version-store/snapshot-root-capture';
import {
  hasSyncBatchStatusStoreProvider,
} from '../../document/version-store/sync-batch-status-store';

export type WorkbookVersionProvenanceTruthRequirement =
  | 'provider'
  | 'providerGraphWriteCapabilities'
  | 'providerInboundUpdateEnvelopeValidation'
  | 'rawAndLegacySyncClassification'
  | 'syncApplyAdmissionContext'
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
};

export type WorkbookVersionProvenanceTruthService = {
  readonly vc09ProvenanceTruthComplete: boolean;
  readonly vc09ProvenanceTruth: WorkbookVersionProvenanceTruth;
};

type PendingRemotePromotionServiceLike = Pick<
  PendingRemotePromotionService,
  'promotePendingRemoteSegments'
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
      typeof validateProviderInboundUpdateEnvelope === 'function' &&
        typeof validateSyncUpdateProvenance === 'function',
    ),
    requirement(
      'rawAndLegacySyncClassification',
      typeof classifyLegacyProviderInboundUpdate === 'function' &&
        typeof classifyLegacyRawUpdate === 'function',
    ),
    requirement('syncApplyAdmissionContext', typeof createAdmittedSyncApplyContext === 'function'),
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
      isPendingRemotePromotionService(options.pendingRemotePromotionService),
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
  return isRecord(value) && typeof value.capturePendingRemoteSegment === 'function';
}

function isSnapshotRootByteSyncPort(
  value: SnapshotRootByteSyncPort | undefined,
): value is SnapshotRootByteSyncPort {
  return isRecord(value) && typeof value.encodeDiff === 'function';
}

function isPendingRemotePromotionService(
  value: PendingRemotePromotionServiceLike | undefined,
): value is PendingRemotePromotionServiceLike {
  return isRecord(value) && typeof value.promotePendingRemoteSegments === 'function';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
