import type {
  VersionCapability,
  VersionCapabilityDependency,
  VersionCapabilityState,
  VersionDiagnostic,
  VersionSurfaceStage,
} from '@mog-sdk/contracts/api';

import type { VersionControlGateStatus } from '../merge/version-merge-capability';
import {
  isSurfaceHostCapabilityDenied,
  remotePromoteSurfaceCapabilityState,
  SURFACE_VERSION_CAPABILITY_KEYS,
} from './version-surface-status-capabilities';
import type {
  VersionSurfaceCapabilityAvailability,
  VersionSurfaceCapabilityBlock,
  VersionSurfaceCapabilityBlocks,
  VersionSurfaceOperationFeatureGates,
} from './version-surface-status-derivation';
import type {
  SurfaceCapabilityStates,
  SurfaceHostCapabilityDecisions,
  SurfaceVersionCapability,
} from './version-surface-status-service-types';
import { surfaceDiagnostic } from './version-surface-status-utils';

export function buildVersionSurfaceCapabilityStates(
  featureGate: VersionControlGateStatus,
  storageReady: boolean,
  availability: VersionSurfaceCapabilityAvailability,
  hostCapabilityDecisions: SurfaceHostCapabilityDecisions,
  operationFeatureGates: VersionSurfaceOperationFeatureGates,
  capabilityBlocks: VersionSurfaceCapabilityBlocks,
  diagnostics: VersionDiagnostic[],
): SurfaceCapabilityStates {
  const disabledByGate = (capability: SurfaceVersionCapability): VersionCapabilityState =>
    disabledCapability(
      diagnostics,
      capability,
      'featureGate',
      'The versionControl feature gate is disabled.',
      false,
      'version.surfaceStatus.featureGateDisabled',
    );

  if (!featureGate.enabled) {
    return Object.fromEntries(
      SURFACE_VERSION_CAPABILITY_KEYS.map((capability) => [capability, disabledByGate(capability)]),
    ) as SurfaceCapabilityStates;
  }

  const disabledByEditingGate = (capability: SurfaceVersionCapability): VersionCapabilityState =>
    disabledCapability(
      diagnostics,
      capability,
      'featureGate',
      'Workbook editing is disabled by host feature gates.',
      false,
      'version.surfaceStatus.editingDisabled',
    );
  const hostDenied = (capability: SurfaceVersionCapability): boolean =>
    isSurfaceHostCapabilityDenied(hostCapabilityDecisions, capability);
  const disabledByHostCapability = (capability: SurfaceVersionCapability): VersionCapabilityState =>
    disabledCapability(
      diagnostics,
      capability,
      'hostCapability',
      hostCapabilityDeniedReason(capability),
      false,
      'version.surfaceStatus.hostCapabilityDenied',
    );
  const disabledByOperationFeatureGate = (
    capability: Extract<SurfaceVersionCapability, 'version:checkout' | 'version:revert'>,
  ): VersionCapabilityState =>
    disabledCapability(
      diagnostics,
      capability,
      'featureGate',
      capability === 'version:checkout'
        ? 'The versionControl.checkout feature gate is disabled.'
        : 'The versionControl.revert feature gate is disabled.',
      false,
      capability === 'version:checkout'
        ? 'version.surfaceStatus.checkoutCapabilityDisabled'
        : 'version.surfaceStatus.revertCapabilityDisabled',
    );
  const disabledByCapabilityBlock = (
    capability: SurfaceVersionCapability,
    block: VersionSurfaceCapabilityBlock,
  ): VersionCapabilityState => {
    if (block.diagnostics) diagnostics.push(...block.diagnostics);
    return disabledCapability(
      diagnostics,
      capability,
      block.dependency,
      block.reason,
      block.retryable,
      block.code,
    );
  };
  const operationFeatureGateDisabled = (capability: SurfaceVersionCapability): boolean =>
    (capability === 'version:checkout' && !operationFeatureGates.checkoutEnabled) ||
    (capability === 'version:revert' && !operationFeatureGates.revertEnabled);
  const availableCapability = (
    capability: SurfaceVersionCapability,
    available: boolean,
    dependency: VersionCapabilityDependency,
    reason: string,
    retryable: boolean,
    code: VersionDiagnostic['code'],
  ): VersionCapabilityState => {
    if (capability === 'version:checkout' && operationFeatureGateDisabled(capability)) {
      return disabledByOperationFeatureGate(capability);
    }
    if (capability === 'version:revert' && operationFeatureGateDisabled(capability)) {
      return disabledByOperationFeatureGate(capability);
    }
    if (hostDenied(capability)) return disabledByHostCapability(capability);
    const block = capabilityBlocks[capability];
    if (block) return disabledByCapabilityBlock(capability, block);
    return available
      ? enabledCapability()
      : disabledCapability(diagnostics, capability, dependency, reason, retryable, code);
  };
  const mutableCapability = (
    capability: SurfaceVersionCapability,
    available: boolean,
    dependency: VersionCapabilityDependency,
    reason: string,
    retryable: boolean,
    code: VersionDiagnostic['code'],
  ): VersionCapabilityState =>
    !featureGate.editingEnabled
      ? disabledByEditingGate(capability)
      : availableCapability(capability, available, dependency, reason, retryable, code);

  const mergeCapability = (
    capability: Extract<VersionCapability, 'version:mergePreview' | 'version:mergeApply'>,
    available: boolean,
    reason: string,
    code: VersionDiagnostic['code'],
  ): VersionCapabilityState => {
    if (!featureGate.mergeEnabled) {
      return disabledCapability(
        diagnostics,
        capability,
        'featureGate',
        'The versionControl.merge feature gate is disabled.',
        false,
        'version.surfaceStatus.mergeCapabilityDisabled',
      );
    }
    if (featureGate.mergeKillSwitchActive) {
      return disabledCapability(
        diagnostics,
        capability,
        'featureGate',
        'The versionControl.merge runtime kill switch is active.',
        false,
        'version.surfaceStatus.mergeKillSwitchActive',
      );
    }
    return capability === 'version:mergeApply'
      ? mutableCapability(capability, available, 'VC-07', reason, true, code)
      : availableCapability(capability, available, 'VC-07', reason, true, code);
  };

  const storageDisabled = (capability: SurfaceVersionCapability): VersionCapabilityState =>
    disabledCapability(
      diagnostics,
      capability,
      'storage',
      'Version storage is not ready for this workbook.',
      true,
      'version.surfaceStatus.storageUnavailable',
    );
  const storageOrHostDisabled = (capability: SurfaceVersionCapability): VersionCapabilityState =>
    hostDenied(capability) ? disabledByHostCapability(capability) : storageDisabled(capability);
  const deferredOrHostDisabled = (
    capability: SurfaceVersionCapability,
    dependency: VersionCapabilityDependency,
    reason: string,
    code: VersionDiagnostic['code'],
  ): VersionCapabilityState =>
    hostDenied(capability)
      ? disabledByHostCapability(capability)
      : disabledCapability(diagnostics, capability, dependency, reason, false, code);
  const remotePromoteCapability = (): VersionCapabilityState =>
    remotePromoteSurfaceCapabilityState({
      diagnostics,
      editingEnabled: featureGate.editingEnabled,
      hostCapabilityDecisions,
      provenanceAvailable: availability.provenance,
      remotePromoteAvailable: availability.remotePromote,
    });
  if (!storageReady) {
    return {
      'version:read': storageOrHostDisabled('version:read'),
      'version:diff': storageOrHostDisabled('version:diff'),
      'version:commit': storageOrHostDisabled('version:commit'),
      'version:branch': storageOrHostDisabled('version:branch'),
      'version:checkout': storageOrHostDisabled('version:checkout'),
      'version:reviewRead': storageOrHostDisabled('version:reviewRead'),
      'version:reviewWrite': storageOrHostDisabled('version:reviewWrite'),
      'version:proposal': deferredOrHostDisabled(
        'version:proposal',
        'VC-05',
        'Agent proposal workflows require branch-scoped materialization plumbing from a later slice.',
        'version.surfaceStatus.proposalUnavailable',
      ),
      'version:mergePreview': storageOrHostDisabled('version:mergePreview'),
      'version:mergeApply': storageOrHostDisabled('version:mergeApply'),
      'version:refAdmin': storageOrHostDisabled('version:refAdmin'),
      'version:revert': storageOrHostDisabled('version:revert'),
      'version:provenance': deferredOrHostDisabled(
        'version:provenance',
        'VC-09',
        'Complete VC-09 provenance truth is not attached; broad mutation admission and pending remote promotion plumbing are insufficient.',
        'version.surfaceStatus.provenanceUnavailable',
      ),
      'version:remotePromote': deferredOrHostDisabled(
        'version:remotePromote',
        'VC-09',
        'Pending remote promotion requires explicit host permission and complete VC-09 provenance truth.',
        'version.surfaceStatus.remotePromoteUnavailable',
      ),
    };
  }

  return {
    'version:read': availableCapability(
      'version:read',
      availability.read,
      'VC-04',
      'Version graph read services are not attached.',
      true,
      'version.surfaceStatus.readUnavailable',
    ),
    'version:diff': availableCapability(
      'version:diff',
      availability.diff,
      'VC-04',
      'Semantic diff services are not attached.',
      true,
      'version.surfaceStatus.diffUnavailable',
    ),
    'version:commit': mutableCapability(
      'version:commit',
      availability.commit,
      'VC-04',
      'Version commit write services are not attached.',
      true,
      'version.surfaceStatus.commitUnavailable',
    ),
    'version:branch': mutableCapability(
      'version:branch',
      availability.branch,
      'VC-05',
      'Version branch/ref lifecycle services are not attached.',
      true,
      'version.surfaceStatus.branchUnavailable',
    ),
    'version:checkout': mutableCapability(
      'version:checkout',
      availability.checkout,
      'VC-05',
      'Version checkout materialization services are not attached.',
      true,
      'version.surfaceStatus.checkoutUnavailable',
    ),
    'version:reviewRead': availableCapability(
      'version:reviewRead',
      availability.reviewRead,
      'storage',
      'Review metadata read services are not attached.',
      true,
      'version.surfaceStatus.reviewUnavailable',
    ),
    'version:reviewWrite': mutableCapability(
      'version:reviewWrite',
      availability.reviewWrite,
      'storage',
      'Review metadata write services are not attached.',
      true,
      'version.surfaceStatus.reviewUnavailable',
    ),
    'version:proposal': mutableCapability(
      'version:proposal',
      availability.proposal,
      'VC-05',
      'Agent proposal workflows require an attached proposal service.',
      false,
      'version.surfaceStatus.proposalUnavailable',
    ),
    'version:mergePreview': mergeCapability(
      'version:mergePreview',
      availability.mergePreview,
      'Version merge preview services are not attached.',
      'version.surfaceStatus.mergePreviewUnavailable',
    ),
    'version:mergeApply': mergeCapability(
      'version:mergeApply',
      availability.mergeApply,
      'Version merge apply requires merge preview and merge-commit write services.',
      'version.surfaceStatus.mergeApplyUnavailable',
    ),
    'version:refAdmin': mutableCapability(
      'version:refAdmin',
      availability.refAdmin,
      'VC-05',
      'Version ref-admin services are not attached.',
      true,
      'version.surfaceStatus.refAdminUnavailable',
    ),
    'version:revert': mutableCapability(
      'version:revert',
      availability.revert,
      'upstreamRevertContract',
      'Version revert services are not attached.',
      false,
      'version.surfaceStatus.revertUnavailable',
    ),
    'version:provenance': availableCapability(
      'version:provenance',
      availability.provenance,
      'VC-09',
      'Complete VC-09 provenance truth is not attached; broad mutation admission and pending remote promotion plumbing are insufficient.',
      true,
      'version.surfaceStatus.provenanceUnavailable',
    ),
    'version:remotePromote': remotePromoteCapability(),
  };
}

export function determineVersionSurfaceStage(
  featureGate: VersionControlGateStatus,
  capabilities: SurfaceCapabilityStates,
): VersionSurfaceStage {
  if (!featureGate.enabled) return 'off';
  if (capabilities['version:provenance'].enabled) return 'provenance';
  if (capabilities['version:proposal'].enabled) return 'proposal';
  if (capabilities['version:mergePreview'].enabled && capabilities['version:mergeApply'].enabled) {
    return 'merge';
  }
  if (
    capabilities['version:commit'].enabled ||
    capabilities['version:branch'].enabled ||
    capabilities['version:checkout'].enabled ||
    capabilities['version:refAdmin'].enabled
  ) {
    return 'authoring';
  }
  if (
    capabilities['version:read'].enabled ||
    capabilities['version:diff'].enabled ||
    capabilities['version:reviewRead'].enabled
  ) {
    return 'readOnly';
  }
  return 'off';
}

function enabledCapability(): VersionCapabilityState {
  return { enabled: true };
}

function disabledCapability(
  diagnostics: VersionDiagnostic[],
  capability: SurfaceVersionCapability,
  dependency: VersionCapabilityDependency,
  reason: string,
  retryable: boolean,
  code: VersionDiagnostic['code'],
): VersionCapabilityState {
  diagnostics.push(
    surfaceDiagnostic(code, retryable ? 'warning' : 'info', reason, dependency, { capability }),
  );
  return { enabled: false, dependency, reason, retryable };
}

function hostCapabilityDeniedReason(capability: SurfaceVersionCapability): string {
  return `Host policy denies ${capability}.`;
}
