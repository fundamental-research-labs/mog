import type { DocumentContext } from '../../context';
import { createProviderBackedBranchLifecycleService } from '../../document/version-store/branch-provider-service';
import { createProviderBackedCheckoutMaterializationService } from '../../document/version-store/checkout-provider-service';
import { createWorkbookVersionCommitService } from '../../document/version-store/commit-service';
import { createWorkbookVersionDiffService } from '../../document/version-store/diff-service';
import { createWorkbookVersionMergeService } from '../../document/version-store/merge-service';
import {
  createProviderBackedAgentProposalService,
  hasAgentProposalMetadataStoreProvider,
} from '../../document/version-store/proposal-provider-service';
import {
  createProviderBackedWorkbookVersionReviewService,
  hasWorkbookVersionReviewRecordStoreProvider,
} from '../../document/version-store/review-provider-service';
import { createWorkbookVersionReviewDiffService } from '../../document/version-store/review-diff-service';
import {
  createPendingRemotePromotionService,
  type PendingRemotePromotionService,
} from '../../document/version-store/pending-remote-promotion-service';
import {
  createVersionProviderWriteActivityTracker,
  isVersionProviderWriteActivityTracker,
  type VersionProviderWriteActivityTracker,
} from '../../document/version-store/provider-write-activity';
import {
  createSemanticMutationCapture,
  type SemanticMutationCaptureServices,
} from '../../document/version-store/semantic-mutation-capture';
import type { WorkbookVersioningConfig } from './types';
import {
  DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND,
  createSemanticMergeCommitCapture,
} from './version-merge-materializer';
import {
  createProviderBackedWorkbookVersionProvenanceTruthService,
} from './version-provenance-truth-service';
import type { WorkbookVersionSurfaceStatusService } from './version-surface-status-service';

type MutableVersioningContext = DocumentContext & {
  versioning?: unknown;
};

type PendingRemotePromotionServiceLike = Pick<
  PendingRemotePromotionService,
  'promotePendingRemoteSegments'
>;

export function attachWorkbookVersioning(
  ctx: DocumentContext,
  config: WorkbookVersioningConfig,
): void {
  const runtime = ctx as MutableVersioningContext;
  const existing = isRecord(runtime.versioning) ? runtime.versioning : {};
  const domainSupportManifestFields = domainSupportManifestAttachmentFields(config);
  const existingSemanticCapture = isSemanticMutationCaptureServices(
    existing.semanticMutationCapture,
  )
    ? existing.semanticMutationCapture
    : undefined;
  const semanticCapture =
    config.semanticMutationCapture ??
    existingSemanticCapture ??
    (!config.captureNormalCommit && config.provider && config.snapshotRootByteSyncPort
      ? createSemanticMutationCapture({ semanticStateReader: config.semanticStateReader })
      : undefined);
  const captureNormalCommit = config.captureNormalCommit ?? semanticCapture?.captureNormalCommit;
  const captureMergeCommit =
    config.captureMergeCommit ??
    (config.provider && config.snapshotRootByteSyncPort
      ? createSemanticMergeCommitCapture({ userTimezone: ctx.userTimezone })
      : undefined);
  const writeService =
    config.writeService ??
    (config.provider
      ? createWorkbookVersionCommitService({
          provider: config.provider,
          captureNormalCommit,
          captureMergeCommit,
          snapshotRootByteSyncPort: config.snapshotRootByteSyncPort,
        })
      : undefined);
  const providerWriteActivityTracker =
    config.providerWriteActivityTracker ??
    providerWriteActivityTrackerFrom(config.pendingRemotePromotionService) ??
    providerWriteActivityTrackerFrom(existing.pendingRemotePromotionService) ??
    (isVersionProviderWriteActivityTracker(existing.providerWriteActivityTracker)
      ? existing.providerWriteActivityTracker
      : undefined) ??
    (isVersionProviderWriteActivityTracker(existing.versionProviderWriteActivityTracker)
      ? existing.versionProviderWriteActivityTracker
      : undefined) ??
    (config.provider ? createVersionProviderWriteActivityTracker() : undefined);
  const pendingRemotePromotionService =
    config.pendingRemotePromotionService ??
    (isPendingRemotePromotionService(existing.pendingRemotePromotionService)
      ? existing.pendingRemotePromotionService
      : undefined) ??
    (config.provider
      ? createPendingRemotePromotionService({
          provider: config.provider,
          providerWriteActivityTracker,
        })
      : undefined);
  const providerBackedProvenanceTruthService = config.provider
    ? createProviderBackedWorkbookVersionProvenanceTruthService({
        provider: config.provider,
        ...(semanticCapture ? { semanticMutationCapture: semanticCapture } : {}),
        ...(config.snapshotRootByteSyncPort
          ? { snapshotRootByteSyncPort: config.snapshotRootByteSyncPort }
          : {}),
        ...(pendingRemotePromotionService ? { pendingRemotePromotionService } : {}),
        ...(providerWriteActivityTracker ? { providerWriteActivityTracker } : {}),
      })
    : undefined;
  const provenanceTruthService =
    providerBackedProvenanceTruthService ??
    config.provenanceTruthService ??
    existing.provenanceTruthService ??
    existing.provenanceAdmissionService;
  if (
    !writeService &&
    !semanticCapture &&
    !pendingRemotePromotionService &&
    !providerWriteActivityTracker &&
    !provenanceTruthService &&
    !config.reviewService &&
    !config.proposalService &&
    !config.proposalWorkspaceService &&
    !config.readLiveCollaborationStatus &&
    !config.shadowObservationSink &&
    !config.shadowObservationOptions &&
    Object.keys(domainSupportManifestFields).length === 0
  ) {
    return;
  }

  const diffService =
    existing.diffService ??
    existing.versionDiffService ??
    (config.provider ? createWorkbookVersionDiffService({ provider: config.provider }) : undefined);
  const checkoutService =
    config.provider && config.checkoutSnapshotMaterializer
      ? createProviderBackedCheckoutMaterializationService({
          provider: config.provider,
          snapshotMaterializer: config.checkoutSnapshotMaterializer,
        })
      : existing.checkoutService ??
        existing.checkoutMaterializationService ??
        (config.provider
          ? createProviderBackedCheckoutMaterializationService({ provider: config.provider })
          : undefined);
  const mergeService =
    config.mergeService ??
    existing.mergeService ??
    existing.versionMergeService ??
    (config.provider
      ? createWorkbookVersionMergeService({ provider: config.provider })
      : undefined);
  const branchService =
    existing.branchService ??
    existing.branchRefService ??
    existing.refLifecycleService ??
    (config.provider
      ? createProviderBackedBranchLifecycleService({ provider: config.provider })
      : undefined);
  const reviewService =
    config.reviewService ??
    existing.reviewService ??
    existing.versionReviewService ??
    existing.reviewMetadataStore ??
    (hasWorkbookVersionReviewRecordStoreProvider(config.provider)
      ? createProviderBackedWorkbookVersionReviewService({
          provider: config.provider,
          diffService: createWorkbookVersionReviewDiffService({ provider: config.provider }),
        })
      : undefined);
  const proposalWorkspaceService =
    config.proposalWorkspaceService ??
    existing.proposalWorkspaceLifecycleService ??
    existing.proposalWorkspaceSessionService;
  const proposalService =
    config.proposalService ??
    existing.proposalService ??
    existing.versionProposalService ??
    existing.agentProposalService ??
    (hasAgentProposalMetadataStoreProvider(config.provider)
      ? createProviderBackedAgentProposalService({
          provider: config.provider,
          ...(branchService ? { branchService } : {}),
          graphProvider: config.provider,
          ...(reviewService ? { reviewService } : {}),
          ...(proposalWorkspaceService ? { workspaceService: proposalWorkspaceService } : {}),
        })
      : undefined);
  runtime.versioning = {
    ...existing,
    ...(config.provider ? { provider: config.provider } : {}),
    ...(config.captureNormalCommit ? { captureNormalCommit: config.captureNormalCommit } : {}),
    ...(config.snapshotRootByteSyncPort
      ? { snapshotRootByteSyncPort: config.snapshotRootByteSyncPort }
      : {}),
    ...(config.semanticStateReader ? { semanticStateReader: config.semanticStateReader } : {}),
    ...(writeService
      ? {
          writeService,
          readService: existing.readService ?? writeService,
        }
      : {}),
    ...(semanticCapture
      ? {
          semanticMutationCapture: semanticCapture,
          mutationCapture: semanticCapture.mutationCapture,
          capturePendingRemoteSegment: semanticCapture.capturePendingRemoteSegment,
        }
      : {}),
    ...(captureMergeCommit
      ? {
          captureMergeCommit,
          mergeCommitMaterializer: {
            kind: config.captureMergeCommit ? 'custom' : DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND,
          },
        }
      : {}),
    ...(diffService ? { diffService } : {}),
    ...(checkoutService ? { checkoutService } : {}),
    ...(mergeService ? { mergeService } : {}),
    ...(branchService ? { branchService } : {}),
    ...(reviewService ? { reviewService, versionReviewService: reviewService } : {}),
    ...(proposalService
      ? {
          proposalService,
          versionProposalService: proposalService,
          agentProposalService: proposalService,
        }
      : {}),
    ...(proposalWorkspaceService
      ? { proposalWorkspaceLifecycleService: proposalWorkspaceService }
      : {}),
    ...(pendingRemotePromotionService
      ? {
          pendingRemotePromotionService,
          ...(typeof existing.promotePendingRemoteSegments === 'function'
            ? {}
            : {
                promotePendingRemoteSegments: () =>
                  pendingRemotePromotionService.promotePendingRemoteSegments(),
              }),
        }
      : {}),
    ...(provenanceTruthService
      ? {
          provenanceTruthService,
          provenanceAdmissionService: provenanceTruthService,
        }
      : {}),
    ...(providerWriteActivityTracker
      ? {
          providerWriteActivityTracker,
          versionProviderWriteActivityTracker: providerWriteActivityTracker,
        }
      : {}),
    ...(config.readLiveCollaborationStatus
      ? {
          readLiveCollaborationStatus: config.readLiveCollaborationStatus,
        }
      : {}),
    ...(config.shadowObservationSink
      ? { shadowObservationSink: config.shadowObservationSink }
      : {}),
    ...(config.shadowObservationOptions
      ? { shadowObservationOptions: config.shadowObservationOptions }
      : {}),
    ...domainSupportManifestFields,
  };
}

export function attachWorkbookVersionSurfaceStatusService(
  ctx: DocumentContext,
  service: WorkbookVersionSurfaceStatusService,
): void {
  const runtime = ctx as MutableVersioningContext;
  const existing = isRecord(runtime.versioning) ? runtime.versioning : {};
  runtime.versioning = {
    ...existing,
    surfaceStatusService: service,
    versionSurfaceStatusService: service,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isSemanticMutationCaptureServices(
  value: unknown,
): value is SemanticMutationCaptureServices {
  return (
    isRecord(value) &&
    isRecord(value.mutationCapture) &&
    typeof value.mutationCapture.recordMutationResult === 'function' &&
    typeof value.captureNormalCommit === 'function' &&
    typeof value.capturePendingRemoteSegment === 'function'
  );
}

function isPendingRemotePromotionService(
  value: unknown,
): value is PendingRemotePromotionServiceLike {
  return isRecord(value) && typeof value.promotePendingRemoteSegments === 'function';
}

function providerWriteActivityTrackerFrom(
  value: unknown,
): VersionProviderWriteActivityTracker | undefined {
  if (!isRecord(value)) return undefined;
  return isVersionProviderWriteActivityTracker(value.providerWriteActivityTracker)
    ? value.providerWriteActivityTracker
    : undefined;
}

function domainSupportManifestAttachmentFields(
  config: WorkbookVersioningConfig,
): Readonly<Record<string, unknown>> {
  return {
    ...(config.domainSupportManifest !== undefined
      ? { domainSupportManifest: config.domainSupportManifest }
      : {}),
    ...(config.readDomainSupportManifest
      ? { readDomainSupportManifest: config.readDomainSupportManifest }
      : {}),
    ...(config.domainSupportManifestOptions
      ? { domainSupportManifestOptions: config.domainSupportManifestOptions }
      : {}),
    ...(config.requireDomainSupportManifest !== undefined
      ? { requireDomainSupportManifest: config.requireDomainSupportManifest }
      : {}),
  };
}
