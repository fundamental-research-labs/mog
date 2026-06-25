import type {
  VersionCapability,
  VersionDiagnosticPublicPayload,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  getVersionControlGateStatus,
  getVersionHostCapabilityDecisions,
} from './version/merge/version-merge-capability';

export function validateVersionOperationGate(
  ctx: DocumentContext,
  operation: string,
  capability: VersionCapability,
  options: { readonly mutates: boolean },
): readonly VersionStoreDiagnostic[] {
  const gate = getVersionControlGateStatus(ctx);
  if (!gate.enabled) {
    return [
      capabilityDisabledDiagnostic(operation, capability, {
        reason: 'versionControlDisabled',
        safeMessage: 'The versionControl feature gate is disabled for this workbook.',
        mutates: options.mutates,
      }),
    ];
  }

  if (options.mutates && !gate.editingEnabled) {
    return [
      capabilityDisabledDiagnostic(operation, capability, {
        reason: 'editingDisabled',
        safeMessage: 'Workbook editing is disabled by host feature gates.',
        mutates: true,
      }),
    ];
  }

  const hostDecision = getVersionHostCapabilityDecisions(ctx)[capability];
  if (hostDecision === 'denied' || hostDecision === 'approval-required') {
    return [
      capabilityDisabledDiagnostic(operation, capability, {
        reason:
          hostDecision === 'denied' ? 'hostCapabilityDenied' : 'hostCapabilityApprovalRequired',
        safeMessage:
          hostDecision === 'denied'
            ? `Host policy denies ${capability}.`
            : `Host policy requires approval for ${capability}.`,
        mutates: options.mutates,
      }),
    ];
  }

  return [];
}

function capabilityDisabledDiagnostic(
  operation: string,
  capability: VersionCapability,
  options: {
    readonly reason:
      | 'versionControlDisabled'
      | 'editingDisabled'
      | 'hostCapabilityDenied'
      | 'hostCapabilityApprovalRequired';
    readonly safeMessage: string;
    readonly mutates: boolean;
  },
): VersionStoreDiagnostic {
  return {
    issueCode: 'VERSION_CAPABILITY_DISABLED',
    severity: 'error',
    recoverability: 'none',
    messageTemplateId: `version.${operation}.capabilityDisabled`,
    safeMessage: options.safeMessage,
    payload: {
      operation,
      capability,
      reason: options.reason,
    } satisfies VersionDiagnosticPublicPayload,
    redacted: true,
    ...(options.mutates ? { mutationGuarantee: 'no-write-attempted' as const } : {}),
  };
}
