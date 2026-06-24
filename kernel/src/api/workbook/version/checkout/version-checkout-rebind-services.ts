import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { VersionSemanticStateReaderPort } from '../../../../document/version-store/semantic-state-reader';
import { isVersioningRecord } from './version-checkout-rebind-utils';

const CHECKOUT_REBIND_DERIVED_SERVICE_KEYS = [
  'writeService',
  'readService',
  'commitService',
  'publicService',
  'checkoutService',
  'checkoutMaterializationService',
  'materializationService',
  'versionCheckoutService',
  'publicCheckoutService',
  'mergeService',
  'versionMergeService',
  'diffService',
  'versionDiffService',
  'branchService',
  'branchRefService',
  'refLifecycleService',
  'versionRefService',
  'publicRefService',
  'refService',
  'revertService',
  'versionRevertService',
  'reviewService',
  'versionReviewService',
  'reviewMetadataStore',
  'proposalService',
  'versionProposalService',
  'agentProposalService',
  'proposalWorkspaceService',
  'proposalWorkspaceLifecycleService',
  'proposalWorkspaceSessionService',
  'proposalMetadataStore',
  'proposalStore',
  'pendingRemotePromotionService',
  'promotePendingRemoteSegments',
  'provenanceTruthService',
  'provenanceAdmissionService',
  'provenanceStatusService',
] as const;

const CHECKOUT_REBIND_MUTABLE_LIFECYCLE_KEYS = [
  'surfaceStatusService',
  'versionSurfaceStatusService',
  'statusService',
  'dirtyStatusService',
  'providerWriteActivityTracker',
  'versionProviderWriteActivityTracker',
  'providerWriteActivity',
  'versionProviderWriteActivity',
  'mutationCapture',
  'capturePendingRemoteSegment',
  'mergeCommitMaterializer',
  'storageProvider',
] as const;

export function resetSemanticMutationCaptureAfterCheckout(
  versioning: Record<string, unknown>,
  semanticStateReader: VersionSemanticStateReaderPort,
  operationContext: VersionOperationContext | undefined,
): void {
  const semanticCapture = versioning.semanticMutationCapture;
  if (!isVersioningRecord(semanticCapture)) return;
  const reset = semanticCapture.resetNormalCaptureForCheckout;
  if (typeof reset !== 'function') return;
  const resetInput: Record<string, unknown> = { semanticStateReader };
  if (operationContext) resetInput.operationContext = operationContext;
  reset.call(semanticCapture, resetInput);
}

export function deleteAttachedVersionServices(config: Record<string, unknown>): void {
  for (const key of CHECKOUT_REBIND_DERIVED_SERVICE_KEYS) {
    delete config[key];
  }
  for (const key of CHECKOUT_REBIND_MUTABLE_LIFECYCLE_KEYS) {
    delete config[key];
  }
}
