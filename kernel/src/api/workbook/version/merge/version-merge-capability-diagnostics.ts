import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type { VersionMergePublicOperation } from './version-merge-capability-constants';
import { versionMergeCapabilityForOperation } from './version-merge-capability-operations';
import type {
  VersionMergeCapabilityDecision,
  VersionMergeCapabilityDisabledReason,
} from './version-merge-capability-types';

export function versionMergeCapabilityDisabledDiagnostic(
  operation: VersionMergePublicOperation,
  decision: Extract<VersionMergeCapabilityDecision, { readonly enabled: false }>,
): VersionStoreDiagnostic {
  const operationCapability = versionMergeCapabilityForOperation(operation);
  return {
    issueCode: 'VERSION_MERGE_CAPABILITY_DISABLED',
    severity: 'error',
    recoverability: 'none',
    messageTemplateId: `version.${operation}.capabilityDisabled`,
    safeMessage: safeMessageForDisabledReason(decision.reason),
    payload: {
      operation,
      endpointStatus: 'capabilityDisabled',
      capability: decision.capability,
      featureGateCapability: 'versionControl.merge',
      publicCapability: decision.capability,
      operationCapability,
      reason: decision.reason,
    },
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}

function safeMessageForDisabledReason(reason: VersionMergeCapabilityDisabledReason): string {
  switch (reason) {
    case 'versionControlDisabled':
      return 'Version-control merge endpoints are disabled for this workbook.';
    case 'mergeCapabilityDisabled':
      return 'Version-control merge capability is disabled for this workbook.';
    case 'mergeKillSwitchActive':
      return 'Version-control merge endpoints are disabled by the runtime kill switch.';
    case 'hostCapabilityDenied':
      return 'Host policy denies version-control merge capability for this workbook.';
    case 'hostCapabilityApprovalRequired':
      return 'Host policy requires approval for version-control merge capability.';
  }
}
