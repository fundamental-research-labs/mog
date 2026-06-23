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
const MAX_DIAGNOSTIC_PAYLOAD_SCAN_DEPTH = 12;

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
    const capability = firstPublicCapabilityFromDiagnosticData(diagnostic.data);
    if (capability) return capability;
    const denied = deniedCapabilitiesFromDiagnostic(diagnostic)[0];
    if (denied) return denied;
  }
  return undefined;
}

function deniedCapabilitiesFromDiagnostic(
  diagnostic: VersionDiagnostic,
): readonly VersionCapability[] {
  return publicDeniedCapabilitiesFromDiagnosticData(diagnostic.data);
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

function firstPublicCapabilityFromDiagnosticData(
  data: VersionDiagnostic['data'] | undefined,
): VersionCapability | undefined {
  return collectPublicCapabilitiesFromDiagnosticData(data, 'capability')[0];
}

function publicDeniedCapabilitiesFromDiagnosticData(
  data: VersionDiagnostic['data'] | undefined,
): readonly VersionCapability[] {
  return collectPublicCapabilitiesFromDiagnosticData(data, 'deniedCapabilities');
}

function collectPublicCapabilitiesFromDiagnosticData(
  value: unknown,
  field: 'capability' | 'deniedCapabilities',
): readonly VersionCapability[] {
  const capabilities: VersionCapability[] = [];
  collectPublicCapabilities(value, field, capabilities, new WeakSet(), 0);
  return [...new Set(capabilities)];
}

function collectPublicCapabilities(
  value: unknown,
  field: 'capability' | 'deniedCapabilities',
  output: VersionCapability[],
  seen: WeakSet<object>,
  depth: number,
): void {
  if (depth > MAX_DIAGNOSTIC_PAYLOAD_SCAN_DEPTH) return;
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const item of value) {
      collectPublicCapabilities(item, field, output, seen, depth + 1);
    }
    return;
  }
  if (!isRecord(value)) return;
  if (seen.has(value)) return;
  seen.add(value);

  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveDiagnosticPayloadKey(key)) continue;
    if (field === 'capability' && key === 'capability') {
      addPublicCapability(child, output);
      continue;
    }
    if (field === 'deniedCapabilities' && key === 'deniedCapabilities') {
      collectDeniedCapabilityField(child, output, seen, depth + 1);
      continue;
    }
    collectPublicCapabilities(child, field, output, seen, depth + 1);
  }
}

function collectDeniedCapabilityField(
  value: unknown,
  output: VersionCapability[],
  seen: WeakSet<object>,
  depth: number,
): void {
  if (depth > MAX_DIAGNOSTIC_PAYLOAD_SCAN_DEPTH) return;
  if (addPublicCapability(value, output)) return;
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const item of value) {
      collectDeniedCapabilityField(item, output, seen, depth + 1);
    }
    return;
  }
  if (!isRecord(value)) return;
  if (seen.has(value)) return;
  seen.add(value);

  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveDiagnosticPayloadKey(key)) continue;
    if (key === 'capability') {
      addPublicCapability(child, output);
      continue;
    }
    collectDeniedCapabilityField(child, output, seen, depth + 1);
  }
}

function addPublicCapability(value: unknown, output: VersionCapability[]): boolean {
  const capability = publicVersionCapability(value);
  if (!capability) return false;
  output.push(capability);
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSensitiveDiagnosticPayloadKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes('principal') ||
    normalized === 'actorid' ||
    normalized === 'userid' ||
    normalized === 'useremail' ||
    normalized === 'agentrunid' ||
    normalized.includes('path') ||
    normalized.includes('ref') ||
    normalized.includes('branch') ||
    normalized.includes('commit') ||
    normalized === 'head' ||
    normalized.includes('revision') ||
    normalized === 'value' ||
    normalized === 'values' ||
    normalized.endsWith('value') ||
    normalized.endsWith('values') ||
    normalized === 'before' ||
    normalized === 'after' ||
    normalized === 'formula' ||
    normalized === 'result'
  );
}

function publicVersionCapabilityDependency(
  value: unknown,
): VersionCapabilityDependency | undefined {
  return typeof value === 'string' && VERSION_CAPABILITY_DEPENDENCIES.has(value)
    ? (value as VersionCapabilityDependency)
    : undefined;
}
