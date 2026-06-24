import type {
  VersionDiagnostic,
  VersionSurfaceStatus,
  WorkbookVersionStatus,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import { hasAttachedVersionCheckoutService } from '../../version-checkout';
import { readPersistedActiveCheckoutMaterialization } from '../active-checkout/version-active-checkout-persistence';
import { restoreAttachedActiveCheckoutMaterialization } from '../active-checkout/version-active-checkout-restore';
import { hasAttachedVersionWriteService } from '../commit/version-commit';
import {
  getVersionHostCapabilityDecisions,
  getVersionControlGateStatus,
} from '../merge/version-merge-capability';
import { hasAttachedVersionMergeService } from '../../version-merge';
import { hasAttachedPendingRemotePromotionService } from '../pending/remote';
import { hasAttachedVersionRefLifecycleService } from '../refs/version-refs';
import {
  getAttachedVersionSurfaceStatusService,
  getSurfaceVersionHostCapabilityDecisions,
  hasAttachedVersionApplyMergeService,
  hasAttachedVersionDiffService,
  hasAttachedVersionRefAdminService,
  redactedVersionSurfaceCurrentStatus,
  redactVersionSurfaceDirtyStatus,
  readVersionSurfaceCheckoutSession,
  readVersionSurfaceDirtyStatus,
  readVersionSurfaceStorageStatus,
  shouldRedactVersionSurfaceCurrentStatus,
  shouldRedactVersionSurfaceDirtyStatus,
} from './version-surface-status-service';
import {
  deriveVersionSurfaceCapabilityBlocks,
  getVersionSurfaceOperationFeatureGates,
  type VersionSurfaceCapabilityAvailability,
} from './version-surface-status-derivation';
import {
  getAttachedVersionReadService,
  getAttachedVersionServices,
  getDocumentId,
  hasAnyVersionAttachment,
} from './version-surface-status-attachments';
import { getAttachedVersionRevertService } from '../revert/version-revert-provider';
import {
  buildVersionSurfaceCapabilityStates,
  determineVersionSurfaceStage,
} from './version-surface-status-capability-states';
import {
  defaultVersionSurfaceCurrentStatus,
  readVersionSurfaceCurrentStatus,
} from './version-surface-status-read-current';
import { surfaceDiagnostic } from './version-surface-status-utils';
import {
  hasAttachedVersionReviewReadService,
  hasAttachedVersionReviewWriteService,
} from '../review/version-review-service-discovery';
import * as proposalServiceDiscovery from '../proposals/version-proposal-service-discovery';

export async function getWorkbookVersionSurfaceStatus(
  ctx: DocumentContext,
  workbookStatus?: WorkbookVersionStatus,
): Promise<VersionSurfaceStatus> {
  const services = getAttachedVersionServices(ctx);
  const surfaceStatusService = getAttachedVersionSurfaceStatusService(services);
  const featureGate = getVersionControlGateStatus(ctx);
  const hostCapabilityDecisions = getSurfaceVersionHostCapabilityDecisions(
    ctx,
    getVersionHostCapabilityDecisions(ctx),
  );
  const operationFeatureGates = getVersionSurfaceOperationFeatureGates(ctx);
  const diagnostics: VersionDiagnostic[] = [];

  if (!featureGate.discovered) {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.featureGateDefaultEnabled',
        'info',
        'No document-scoped versionControl feature gate is attached; kernel status defaults it to enabled.',
        'featureGate',
      ),
    );
  } else if (!featureGate.enabled) {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.featureGateDisabled',
        'warning',
        'The versionControl feature gate is disabled for this workbook.',
        'featureGate',
      ),
    );
  } else if (featureGate.mergeDiscovered && !featureGate.mergeEnabled) {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.mergeCapabilityDisabled',
        'warning',
        'The versionControl.merge feature gate is disabled for this workbook.',
        'featureGate',
      ),
    );
  }
  if (featureGate.mergeKillSwitchActive) {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.mergeKillSwitchActive',
        'warning',
        'The versionControl.merge runtime kill switch is active.',
        'featureGate',
      ),
    );
  }
  if (!featureGate.editingEnabled) {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.editingDisabled',
        'info',
        'Workbook editing is disabled by host feature gates; version read surfaces remain available.',
        'featureGate',
      ),
    );
  }
  if (operationFeatureGates.checkoutDiscovered && !operationFeatureGates.checkoutEnabled) {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.checkoutCapabilityDisabled',
        'warning',
        'The versionControl.checkout feature gate is disabled for this workbook.',
        'featureGate',
      ),
    );
  }
  if (operationFeatureGates.revertDiscovered && !operationFeatureGates.revertEnabled) {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.revertCapabilityDisabled',
        'warning',
        'The versionControl.revert feature gate is disabled for this workbook.',
        'featureGate',
      ),
    );
  }

  const redactCurrentStatus = shouldRedactVersionSurfaceCurrentStatus(hostCapabilityDecisions);
  const redactDirtyStatus = shouldRedactVersionSurfaceDirtyStatus(hostCapabilityDecisions);
  const readService =
    featureGate.enabled && !redactCurrentStatus ? getAttachedVersionReadService(services) : null;
  const storage = readVersionSurfaceStorageStatus({
    services,
    hasVersionAttachment: Boolean(services && hasAnyVersionAttachment(services)),
  });
  const availability: VersionSurfaceCapabilityAvailability = {
    read: Boolean(readService),
    diff: hasAttachedVersionDiffService(services),
    commit: Boolean(workbookStatus?.commitApi.available || hasAttachedVersionWriteService(ctx)),
    branch: hasAttachedVersionRefLifecycleService(ctx),
    checkout: Boolean(workbookStatus?.checkout.available || hasAttachedVersionCheckoutService(ctx)),
    reviewRead: hasAttachedVersionReviewReadService(services),
    reviewWrite: hasAttachedVersionReviewWriteService(services),
    proposal: proposalServiceDiscovery.hasAttachedVersionProposalWorkflowService(services),
    mergePreview: Boolean(workbookStatus?.merge.available || hasAttachedVersionMergeService(ctx)),
    mergeApply:
      Boolean(workbookStatus?.merge.available || hasAttachedVersionMergeService(ctx)) &&
      hasAttachedVersionApplyMergeService(services),
    refAdmin: hasAttachedVersionRefAdminService(services),
    revert: Boolean(getAttachedVersionRevertService(ctx)),
    provenance: Boolean(workbookStatus?.provenanceAdmission.available),
    remotePromote: Boolean(
      workbookStatus?.provenanceAdmission.available &&
      hasAttachedPendingRemotePromotionService(ctx),
    ),
  };

  diagnostics.push(...storage.diagnostics);
  const capabilityBlocks =
    featureGate.enabled && storage.ready
      ? await deriveVersionSurfaceCapabilityBlocks({ ctx, services, availability })
      : {};
  let activeCheckoutSession = redactCurrentStatus
    ? null
    : await readVersionSurfaceCheckoutSession(surfaceStatusService, diagnostics);
  let current = featureGate.enabled
    ? redactCurrentStatus
      ? redactedVersionSurfaceCurrentStatus()
      : await readVersionSurfaceCurrentStatus(readService, diagnostics, activeCheckoutSession)
    : defaultVersionSurfaceCurrentStatus();
  if (featureGate.enabled && !redactCurrentStatus && !activeCheckoutSession) {
    const restorableSession = await readPersistedActiveCheckoutMaterialization(ctx);
    activeCheckoutSession = restorableSession
      ? await restoreAttachedActiveCheckoutMaterialization({
          ctx,
          surfaceStatusService,
          session: restorableSession,
        })
      : null;
    if (activeCheckoutSession) {
      current = await readVersionSurfaceCurrentStatus(
        readService,
        diagnostics,
        activeCheckoutSession,
      );
    }
  }
  const rawDirty = await readVersionSurfaceDirtyStatus(surfaceStatusService, diagnostics);
  const dirty = redactDirtyStatus ? redactVersionSurfaceDirtyStatus(rawDirty) : rawDirty;
  diagnostics.push(...dirty.diagnostics);
  const capabilities = buildVersionSurfaceCapabilityStates(
    featureGate,
    storage.ready,
    availability,
    hostCapabilityDecisions,
    operationFeatureGates,
    capabilityBlocks,
    diagnostics,
  );

  return {
    schemaVersion: 1,
    documentId: getDocumentId(ctx, services),
    stage: determineVersionSurfaceStage(featureGate, capabilities),
    featureGateEnabled: featureGate.enabled,
    storage,
    current,
    dirty,
    capabilities,
    diagnostics,
  };
}
