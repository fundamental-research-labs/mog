import type {
  VersionCapability,
  VersionCapabilityDependency,
  VersionDiagnostic,
} from '@mog-sdk/contracts/api';
import type {
  VersionHistoryAccessDeniedSummary,
  VersionHistoryDeniedSummaryKind,
} from '@mog-sdk/contracts/versioning';

import { VERSION_CAPABILITY_KEYS } from './version-merge-capability';

type VersionHistoryAllowedProjection = {
  readonly kind: 'allowed';
};

export type VersionHistoryDeniedDiagnosticProjection = {
  readonly kind: VersionHistoryDeniedSummaryKind;
  readonly code?: VersionHistoryAccessDeniedSummary['code'];
  readonly capability?: VersionCapability | string;
  readonly deniedCapabilities?: readonly (VersionCapability | string)[];
  readonly dependency?: VersionCapabilityDependency | string;
  readonly retryable?: boolean;
};

export type VersionHistoryDiagnosticProjectionAccess =
  | VersionHistoryAllowedProjection
  | VersionHistoryDeniedDiagnosticProjection;

const VERSION_CAPABILITIES = new Set<string>(VERSION_CAPABILITY_KEYS);
const VERSION_CAPABILITY_DEPENDENCIES = new Set<string>([
  'VC-04',
  'VC-05',
  'VC-07',
  'VC-09',
  'storage',
  'featureGate',
  'hostCapability',
  'upstreamRevertContract',
]);

export function projectVersionHistoryDiagnosticsForAccess(
  diagnostics: readonly VersionDiagnostic[],
  access: VersionHistoryDiagnosticProjectionAccess,
): readonly VersionDiagnostic[] {
  if (access.kind === 'allowed') return diagnostics;
  return [
    versionHistoryDeniedSummaryDiagnostic(
      projectVersionHistoryAccessDeniedSummary(access, diagnostics),
      diagnostics.length,
    ),
  ];
}

export function projectVersionHistoryAccessDeniedSummary(
  access: VersionHistoryDeniedDiagnosticProjection,
  diagnostics: readonly VersionDiagnostic[] = [],
): VersionHistoryAccessDeniedSummary {
  const capability =
    publicVersionCapability(access.capability) ?? firstDiagnosticCapability(diagnostics);
  const deniedCapabilities = publicDeniedCapabilities([
    ...(access.deniedCapabilities ?? []),
    ...diagnostics.flatMap((diagnostic) => deniedCapabilitiesFromDiagnostic(diagnostic)),
    ...(capability ? [capability] : []),
  ]);

  return {
    kind: access.kind,
    code:
      access.code ??
      (access.kind === 'capability-denied'
        ? 'version_capability_unavailable'
        : 'version_access_denied'),
    ...(capability ? { capability } : {}),
    ...(deniedCapabilities.length > 0 ? { deniedCapabilities } : {}),
    ...(publicVersionCapabilityDependency(access.dependency)
      ? { dependency: publicVersionCapabilityDependency(access.dependency) }
      : {}),
    ...(typeof access.retryable === 'boolean' ? { retryable: access.retryable } : {}),
  };
}

function versionHistoryDeniedSummaryDiagnostic(
  summary: VersionHistoryAccessDeniedSummary,
  diagnosticCount: number,
): VersionDiagnostic {
  return {
    code: summary.code,
    severity: 'error',
    message:
      summary.kind === 'capability-denied'
        ? 'Version history capability is denied for this caller.'
        : 'Version history access is denied for this caller.',
    ...(typeof summary.dependency === 'string'
      ? { dependency: summary.dependency as VersionCapabilityDependency }
      : {}),
    data: {
      kind: summary.kind,
      diagnosticCount,
      ...(summary.capability ? { capability: summary.capability } : {}),
      ...(summary.deniedCapabilities ? { deniedCapabilities: summary.deniedCapabilities } : {}),
      ...(typeof summary.retryable === 'boolean' ? { retryable: summary.retryable } : {}),
    },
  };
}

function firstDiagnosticCapability(
  diagnostics: readonly VersionDiagnostic[],
): VersionCapability | undefined {
  for (const diagnostic of diagnostics) {
    const capability = publicVersionCapability(diagnostic.data?.capability);
    if (capability) return capability;
    for (const candidate of deniedCapabilitiesFromDiagnostic(diagnostic)) {
      const denied = publicVersionCapability(candidate);
      if (denied) return denied;
    }
  }
  return undefined;
}

function deniedCapabilitiesFromDiagnostic(
  diagnostic: VersionDiagnostic,
): readonly (VersionCapability | string)[] {
  const denied = diagnostic.data?.deniedCapabilities;
  return Array.isArray(denied)
    ? denied.filter((value): value is string => typeof value === 'string')
    : [];
}

function publicDeniedCapabilities(
  candidates: readonly (VersionCapability | string)[],
): readonly VersionCapability[] {
  return [
    ...new Set(
      candidates.flatMap((candidate) => {
        const capability = publicVersionCapability(candidate);
        return capability ? [capability] : [];
      }),
    ),
  ];
}

function publicVersionCapability(value: unknown): VersionCapability | undefined {
  return typeof value === 'string' && VERSION_CAPABILITIES.has(value)
    ? (value as VersionCapability)
    : undefined;
}

function publicVersionCapabilityDependency(
  value: unknown,
): VersionCapabilityDependency | undefined {
  return typeof value === 'string' && VERSION_CAPABILITY_DEPENDENCIES.has(value)
    ? (value as VersionCapabilityDependency)
    : undefined;
}
