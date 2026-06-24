import type { DocumentContext } from '../../../../context';
import type { VersionMergePublicCapability } from './version-merge-capability-constants';
import { getVersionControlGateStatus } from './version-merge-capability-gates';
import { getVersionHostCapabilityDecisions } from './version-merge-capability-host-policy';
import type { VersionMergeCapabilityDecision } from './version-merge-capability-types';

export function getVersionMergeCapabilityDecision(
  ctx: DocumentContext,
  capability: VersionMergePublicCapability,
): VersionMergeCapabilityDecision {
  const status = getVersionControlGateStatus(ctx);
  if (!status.enabled) {
    return { enabled: false, capability, reason: 'versionControlDisabled', status };
  }
  if (!status.mergeEnabled) {
    return { enabled: false, capability, reason: 'mergeCapabilityDisabled', status };
  }
  if (status.mergeKillSwitchActive) {
    return { enabled: false, capability, reason: 'mergeKillSwitchActive', status };
  }

  const hostDecision = getVersionHostCapabilityDecisions(ctx)[capability];
  if (hostDecision === 'denied') {
    return { enabled: false, capability, reason: 'hostCapabilityDenied', status };
  }
  if (hostDecision === 'approval-required') {
    return { enabled: false, capability, reason: 'hostCapabilityApprovalRequired', status };
  }
  return { enabled: true, status };
}
