import type { VersionCapability, VersionResult } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import { hasAttachedVersionMergeService } from '../../version-merge';
import {
  getVersionControlGateStatus,
  getVersionHostCapabilityDecisions,
  getVersionMergeCapabilityDecision,
  type VersionMergeCapabilityDisabledReason,
  type VersionMergePublicCapability,
} from '../merge/version-merge-capability';
import { isRecord } from './version-proposal-guards';
import { capabilityUnavailable } from './version-proposal-service-diagnostics';
import type { VersionProposalPublicOperation } from './version-proposal-types';

export function proposalCapabilityFailure<T>(
  ctx: DocumentContext,
  operation: VersionProposalPublicOperation,
  requiredCapabilities: readonly VersionCapability[],
): VersionResult<T> | null {
  const gate = getVersionControlGateStatus(ctx);
  const primaryCapability = requiredCapabilities[0] ?? 'version:proposal';
  if (!gate.enabled) {
    return capabilityUnavailable(
      operation,
      primaryCapability,
      'featureGate',
      'Version-control proposal endpoints are disabled for this workbook.',
      false,
      'version.proposal.capabilityDisabled',
    );
  }
  if (!gate.editingEnabled) {
    return capabilityUnavailable(
      operation,
      primaryCapability,
      'featureGate',
      'Workbook editing is disabled by host feature gates.',
      false,
      'version.proposal.editingDisabled',
    );
  }

  const hostDecisions = getVersionHostCapabilityDecisions(ctx);
  for (const capability of requiredCapabilities) {
    if (isVersionMergePublicCapability(capability)) {
      const mergeDecision = getVersionMergeCapabilityDecision(ctx, capability);
      if (!mergeDecision.enabled) {
        return mergeCapabilityUnavailable(
          operation,
          mergeDecision.capability,
          mergeDecision.reason,
        );
      }
      continue;
    }

    const decision = hostDecisions[capability];
    if (decision === 'denied' || decision === 'approval-required') {
      return capabilityUnavailable(
        operation,
        capability,
        'hostCapability',
        `Host policy ${decision === 'denied' ? 'denies' : 'requires approval for'} ${capability}.`,
        decision === 'approval-required',
        'version.proposal.hostCapabilityDenied',
      );
    }
  }

  if (operation === 'acceptProposal') {
    const acceptCapabilityFailure = proposalAcceptDynamicCapabilityFailure<T>(ctx, operation);
    if (acceptCapabilityFailure) return acceptCapabilityFailure;
  }

  return null;
}

function proposalAcceptDynamicCapabilityFailure<T>(
  ctx: DocumentContext,
  operation: VersionProposalPublicOperation,
): VersionResult<T> | null {
  if (!hasAttachedVersionMergeService(ctx)) {
    return capabilityUnavailable(
      operation,
      'version:mergePreview',
      'VC-07',
      'Proposal acceptance requires attached merge preview capability; acceptProposal remains disabled.',
      true,
      'version.proposal.mergePreviewUnavailable',
    );
  }

  if (!hasAttachedVersionApplyMergeCapability(ctx)) {
    return capabilityUnavailable(
      operation,
      'version:mergeApply',
      'VC-07',
      'Proposal acceptance requires attached merge apply capability; acceptProposal remains disabled.',
      true,
      'version.proposal.mergeApplyUnavailable',
    );
  }

  return null;
}

function mergeCapabilityUnavailable<T>(
  operation: VersionProposalPublicOperation,
  capability: VersionMergePublicCapability,
  reason: VersionMergeCapabilityDisabledReason,
): VersionResult<T> {
  switch (reason) {
    case 'versionControlDisabled':
      return capabilityUnavailable(
        operation,
        capability,
        'featureGate',
        'Version-control proposal endpoints are disabled for this workbook.',
        false,
        'version.proposal.capabilityDisabled',
      );
    case 'mergeCapabilityDisabled':
      return capabilityUnavailable(
        operation,
        capability,
        'featureGate',
        'Version-control merge capability is disabled for this workbook.',
        false,
        'version.proposal.mergeCapabilityDisabled',
      );
    case 'mergeKillSwitchActive':
      return capabilityUnavailable(
        operation,
        capability,
        'featureGate',
        'Version-control merge endpoints are disabled by the runtime kill switch.',
        false,
        'version.proposal.mergeKillSwitchActive',
      );
    case 'hostCapabilityDenied':
      return capabilityUnavailable(
        operation,
        capability,
        'hostCapability',
        'Host policy denies version-control merge capability for this workbook.',
        false,
        'version.proposal.hostCapabilityDenied',
      );
    case 'hostCapabilityApprovalRequired':
      return capabilityUnavailable(
        operation,
        capability,
        'hostCapability',
        'Host policy requires approval for version-control merge capability.',
        true,
        'version.proposal.hostCapabilityDenied',
      );
  }
}

function isVersionMergePublicCapability(
  capability: VersionCapability,
): capability is VersionMergePublicCapability {
  return capability === 'version:mergePreview' || capability === 'version:mergeApply';
}

function hasAttachedVersionApplyMergeCapability(ctx: DocumentContext): boolean {
  const services = getAttachedVersionServices(ctx);
  if (!services) return false;

  const hasDirectApplyService = [
    services.applyMergeService,
    services.versionApplyMergeService,
    services.publicService,
  ].some((candidate) =>
    Boolean(
      bindMethod(candidate, 'applyMerge') ??
      bindMethod(candidate, 'applyMergeVersion') ??
      bindMethod(candidate, 'applyMergeCommit'),
    ),
  );
  if (hasDirectApplyService) return true;

  const hasMergeCommitWriter = [services.writeService, services.commitService].some((candidate) =>
    Boolean(bindMethod(candidate, 'mergeCommit')),
  );
  return (
    hasMergeCommitWriter && Boolean(services.captureMergeCommit || services.mergeCommitMaterializer)
  );
}

type ProposalAcceptAttachedServices = {
  readonly applyMergeService?: unknown;
  readonly versionApplyMergeService?: unknown;
  readonly publicService?: unknown;
  readonly writeService?: unknown;
  readonly commitService?: unknown;
  readonly captureMergeCommit?: unknown;
  readonly mergeCommitMaterializer?: unknown;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

type BoundMethod = (...args: readonly unknown[]) => unknown;

function getAttachedVersionServices(ctx: DocumentContext): ProposalAcceptAttachedServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version;
  return isRecord(services) ? services : null;
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as unknown;
}
