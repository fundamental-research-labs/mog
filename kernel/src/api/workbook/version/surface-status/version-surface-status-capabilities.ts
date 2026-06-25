import type {
  VersionCapabilityDependency,
  VersionCapabilityState,
  VersionDiagnostic,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import type {
  HostCapabilityDecision,
  HostCapabilityDecisions,
} from '../merge/version-merge-capability';
import type {
  RemotePromoteSurfaceCapabilityInput,
  SurfaceHostCapabilityDecisions,
  SurfaceVersionCapability,
} from './version-surface-status-service-types';
import { isRecord } from './version-surface-status-utils';

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly policy?: unknown;
  readonly policySnapshot?: unknown;
  readonly versionPolicy?: unknown;
  readonly hostCapabilityPolicy?: unknown;
  readonly hostPolicy?: unknown;
};

export const SURFACE_VERSION_CAPABILITY_KEYS = [
  'version:read',
  'version:diff',
  'version:commit',
  'version:branch',
  'version:checkout',
  'version:reviewRead',
  'version:reviewWrite',
  'version:proposal',
  'version:mergePreview',
  'version:mergeApply',
  'version:refAdmin',
  'version:revert',
  'version:provenance',
  'version:remotePromote',
] as const satisfies readonly SurfaceVersionCapability[];

export function getSurfaceVersionHostCapabilityDecisions(
  ctx: DocumentContext,
  baseDecisions: HostCapabilityDecisions,
): SurfaceHostCapabilityDecisions {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const decisions: SurfaceHostCapabilityDecisions = { ...baseDecisions };
  for (const candidate of [
    runtime.policy,
    runtime.policySnapshot,
    runtime.versionPolicy,
    runtime.hostCapabilityPolicy,
    runtime.hostPolicy,
  ]) {
    const candidateDecisions = readSurfaceHostCapabilityDecisions(candidate);
    if (candidateDecisions) Object.assign(decisions, candidateDecisions);
  }
  return decisions;
}

export function isSurfaceHostCapabilityDenied(
  decisions: SurfaceHostCapabilityDecisions,
  capability: SurfaceVersionCapability,
): boolean {
  const decision = decisions[capability];
  return decision === 'denied' || decision === 'approval-required';
}

export function remotePromoteSurfaceCapabilityState(
  input: RemotePromoteSurfaceCapabilityInput,
): VersionCapabilityState {
  if (!input.editingEnabled) {
    return disabledSurfaceCapability(
      input.diagnostics,
      'featureGate',
      'Workbook editing is disabled by host feature gates.',
      false,
      'version.surfaceStatus.editingDisabled',
    );
  }

  const remoteDecision = input.hostCapabilityDecisions['version:remotePromote'];
  if (remoteDecision === 'denied' || remoteDecision === 'approval-required') {
    return disabledSurfaceCapability(
      input.diagnostics,
      'hostCapability',
      'Host policy denies version:remotePromote.',
      false,
      'version.surfaceStatus.hostCapabilityDenied',
    );
  }
  const provenanceDecision = input.hostCapabilityDecisions['version:provenance'];
  if (provenanceDecision === 'denied' || provenanceDecision === 'approval-required') {
    return disabledSurfaceCapability(
      input.diagnostics,
      'hostCapability',
      'Host policy denies version:provenance.',
      false,
      'version.surfaceStatus.hostCapabilityDenied',
    );
  }
  if (remoteDecision !== 'allowed') {
    return disabledSurfaceCapability(
      input.diagnostics,
      'hostCapability',
      'Host policy must explicitly allow version:remotePromote for pending remote promotion.',
      false,
      'version.surfaceStatus.remotePromoteUnavailable',
    );
  }
  if (provenanceDecision !== 'allowed') {
    return disabledSurfaceCapability(
      input.diagnostics,
      'hostCapability',
      'Host policy must explicitly allow version:provenance for pending remote promotion.',
      false,
      'version.surfaceStatus.remotePromoteUnavailable',
    );
  }
  if (
    input.diagnostics.some(
      (entry) => entry.code === 'version.surfaceStatus.lowerGateEvidenceBlocked',
    )
  ) {
    return disabledSurfaceCapability(
      input.diagnostics,
      'VC-09',
      'Promoted version surfaces require current, clean, passing lower-gate evidence.',
      true,
      'version.surfaceStatus.lowerGateEvidenceBlocked',
    );
  }
  if (!input.provenanceAvailable) {
    return disabledSurfaceCapability(
      input.diagnostics,
      'VC-09',
      'Complete VC-09 provenance truth is not attached; pending remote promotion is disabled.',
      true,
      'version.surfaceStatus.remotePromoteUnavailable',
    );
  }
  return input.remotePromoteAvailable
    ? { enabled: true }
    : disabledSurfaceCapability(
        input.diagnostics,
        'VC-09',
        'No document-scoped pending remote promotion service is attached.',
        true,
        'version.surfaceStatus.remotePromoteUnavailable',
      );
}

function disabledSurfaceCapability(
  diagnostics: VersionDiagnostic[],
  dependency: VersionCapabilityDependency,
  reason: string,
  retryable: boolean,
  code: VersionDiagnostic['code'],
): VersionCapabilityState {
  diagnostics.push({
    code,
    severity: retryable ? 'warning' : 'info',
    message: reason,
    dependency,
    data: { capability: 'version:remotePromote' },
  });
  return { enabled: false, dependency, reason, retryable };
}

function readSurfaceHostCapabilityDecisions(value: unknown): SurfaceHostCapabilityDecisions | null {
  const source = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.decisions)
      ? value.decisions
      : null;
  if (!source) return null;

  const decisions: SurfaceHostCapabilityDecisions = {};
  for (const entry of source) {
    if (!isRecord(entry)) continue;
    const capability = toSurfaceVersionCapability(entry.capability);
    const decision = toHostCapabilityDecision(entry.decision);
    if (capability && decision) decisions[capability] = decision;
  }
  return Object.keys(decisions).length > 0 ? decisions : null;
}

function toSurfaceVersionCapability(value: unknown): SurfaceVersionCapability | null {
  return typeof value === 'string' &&
    (SURFACE_VERSION_CAPABILITY_KEYS as readonly string[]).includes(value)
    ? (value as SurfaceVersionCapability)
    : null;
}

function toHostCapabilityDecision(value: unknown): HostCapabilityDecision | null {
  return value === 'allowed' || value === 'denied' || value === 'approval-required' ? value : null;
}
