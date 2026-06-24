import type { VersionCapability } from '@mog-sdk/contracts/api';

import type { VersionActionDisabledReasonId } from './version-action-availability-types';

export const ACTION_CAPABILITY_LABELS: Partial<Record<VersionCapability, string>> = {
  'version:read': 'Read',
  'version:commit': 'Commit',
  'version:branch': 'Branch',
  'version:checkout': 'Checkout',
  'version:diff': 'Diff',
  'version:reviewRead': 'Review read',
  'version:reviewWrite': 'Review write',
  'version:proposal': 'Proposal',
  'version:mergePreview': 'Merge preview',
  'version:mergeApply': 'Merge apply',
  'version:revert': 'Rollback',
  'version:provenance': 'Provenance',
  'version:remotePromote': 'Remote promote',
};

export const VERSIONING_DISABLED_REASON = 'Versioning is disabled for this workbook.';
export const VERSION_ACTION_UNAVAILABLE = 'Version action is unavailable.';
export const DIRTY_STATUS_UNAVAILABLE_REASON =
  'Dirty status is unavailable; refresh version status before continuing.';

export type CurrentStaleAction =
  | 'commit'
  | 'checkout'
  | 'rollback'
  | 'review'
  | 'merge'
  | 'export'
  | 'remotePromote';

export type DirtyDomainAction = 'commit' | 'checkout' | 'review' | 'merge' | 'export';

export function publicStatusActionForCapability(
  capability: VersionCapability,
): CurrentStaleAction | undefined {
  switch (capability) {
    case 'version:commit':
      return 'commit';
    case 'version:checkout':
      return 'checkout';
    case 'version:revert':
      return 'rollback';
    case 'version:reviewRead':
    case 'version:reviewWrite':
    case 'version:proposal':
      return 'review';
    case 'version:mergePreview':
    case 'version:mergeApply':
      return 'merge';
    case 'version:provenance':
      return 'export';
    case 'version:remotePromote':
      return 'remotePromote';
    default:
      return undefined;
  }
}

export function unsupportedDirtyDomainActionForCapability(
  capability: VersionCapability,
): DirtyDomainAction | undefined {
  switch (capability) {
    case 'version:commit':
      return 'commit';
    case 'version:checkout':
      return 'checkout';
    case 'version:reviewRead':
    case 'version:reviewWrite':
    case 'version:proposal':
      return 'review';
    case 'version:mergePreview':
    case 'version:mergeApply':
      return 'merge';
    case 'version:provenance':
      return 'export';
    default:
      return undefined;
  }
}

export function providerWriteActionForCapability(
  capability: VersionCapability,
): string | undefined {
  switch (capability) {
    case 'version:commit':
      return 'committing';
    case 'version:checkout':
      return 'checking out';
    case 'version:reviewWrite':
      return 'updating reviews';
    case 'version:proposal':
      return 'updating proposals';
    case 'version:mergeApply':
      return 'applying merge changes';
    case 'version:revert':
      return 'staging rollback';
    case 'version:provenance':
      return 'exporting version metadata';
    default:
      return undefined;
  }
}

export function fallbackDiagnosticMessage(reasonId: VersionActionDisabledReasonId): string {
  switch (reasonId) {
    case 'version-capability-host-denied':
      return 'Host policy denies this version capability.';
    case 'version-diff-incomplete':
      return 'Review or merge diff diagnostics are incomplete; refresh version status before continuing.';
    case 'version-dirty-status-unavailable':
      return DIRTY_STATUS_UNAVAILABLE_REASON;
    case 'version-head-stale':
      return 'Refresh version status before continuing.';
    case 'version-history-incomplete':
      return 'Version history is incomplete for this action.';
    case 'version-unsupported-domain':
      return 'This version action includes unsupported domains.';
    default:
      return 'This version action is unavailable.';
  }
}
