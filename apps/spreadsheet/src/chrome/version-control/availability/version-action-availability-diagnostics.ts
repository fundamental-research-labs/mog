import type {
  VersionCapability,
  VersionDiagnostic,
  VersionSurfaceStatus,
} from '@mog-sdk/contracts/api';

import { fallbackDiagnosticMessage } from './version-action-availability-metadata';
import type {
  DisabledActionReason,
  VersionActionDisabledReasonId,
} from './version-action-availability-types';

const INCOMPLETE_HISTORY_DIAGNOSTIC_CODES = new Set([
  'VERSION_DANGLING_REF',
  'VERSION_GRAPH_UNINITIALIZED',
  'VERSION_MISSING_OBJECT',
  'VERSION_MISSING_PARENT',
  'VERSION_OBJECT_STORE_FAILURE',
  'VERSION_UNMATERIALIZABLE_COMMIT',
  'VERSION_CHECKOUT_COMMIT_COMPLETENESS_DIAGNOSTIC',
  'VERSION_CHECKOUT_MISSING_COMMIT',
  'VERSION_CHECKOUT_MISSING_DEPENDENCY',
  'VERSION_CHECKOUT_UNMATERIALIZABLE_COMMIT',
  'VERSION_REVERT_HISTORY_GAP',
]);

const STALE_HEAD_DIAGNOSTIC_CODES = new Set([
  'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD',
  'VERSION_REVERT_STALE_HEAD',
  'stale_head',
]);

const UNSUPPORTED_DOMAIN_DIAGNOSTIC_CODES = new Set([
  'VERSION_REVERT_OPAQUE_DOMAIN',
  'VERSION_REVERT_UNSUPPORTED_DOMAIN',
  'VERSION_UNSUPPORTED_AUTHORED_DOMAIN',
  'externalReferenceUnsupported',
  'inconsistentVisibilityCache',
  'indexKeyedColumnVisibility',
  'indexKeyedRowVisibility',
  'indexKeyedVisibility',
  'opaqueDomain',
  'opaqueDomainDigestUnavailable',
  'opaqueFormatPointer',
  'unsupportedDomain',
  'unsupportedFormat',
]);

const INCOMPLETE_DIFF_DIAGNOSTIC_CODES = new Set([
  'VERSION_REVIEW_DIFF_COMPLETENESS_BLOCKED',
  'VERSION_REVIEW_DIFF_INCOMPLETE',
]);

export function hostCapabilityDiagnosticDisabledReason(
  surface: VersionSurfaceStatus,
  capability: VersionCapability,
): DisabledActionReason | undefined {
  const diagnostic = allSurfaceDiagnostics(surface).find((item) =>
    hostCapabilityDiagnosticApplies(item, capability),
  );
  if (!diagnostic) return undefined;

  return {
    id: 'version-capability-host-denied',
    message: fallbackDiagnosticMessage('version-capability-host-denied'),
  };
}

export function publicStatusDiagnosticDisabledReason(
  surface: VersionSurfaceStatus,
  capability: VersionCapability,
): DisabledActionReason | undefined {
  for (const diagnostic of allSurfaceDiagnostics(surface)) {
    const reasonId = publicStatusDiagnosticReasonId(diagnostic, capability);
    if (!reasonId) continue;
    return {
      id: reasonId,
      message: fallbackDiagnosticMessage(reasonId),
    };
  }
  return undefined;
}

function hostCapabilityDiagnosticApplies(
  diagnostic: VersionDiagnostic,
  capability: VersionCapability,
): boolean {
  if (
    diagnostic.code !== 'version.surfaceStatus.hostCapabilityDenied' &&
    diagnostic.dependency !== 'hostCapability'
  ) {
    return false;
  }

  const data = diagnosticData(diagnostic);
  const deniedCapabilities = [
    ...diagnosticStringArray(data, 'deniedCapabilities'),
    ...diagnosticStringArray(data, 'capabilities'),
    ...diagnosticStringArray(data, 'capability'),
  ];
  if (deniedCapabilities.length === 0) return true;
  return deniedCapabilities.includes(capability) || deniedCapabilities.includes('version:read');
}

function publicStatusDiagnosticReasonId(
  diagnostic: VersionDiagnostic,
  capability: VersionCapability,
): VersionActionDisabledReasonId | undefined {
  if (isStaleHeadDiagnostic(diagnostic)) return 'version-head-stale';
  if (isIncompleteDiffDiagnostic(diagnostic) && incompleteDiffDiagnosticApplies(capability)) {
    return 'version-diff-incomplete';
  }
  if (isUnsupportedDomainDiagnostic(diagnostic)) return 'version-unsupported-domain';
  if (isIncompleteHistoryDiagnostic(diagnostic)) return 'version-history-incomplete';
  return undefined;
}

function isStaleHeadDiagnostic(diagnostic: VersionDiagnostic): boolean {
  const code = String(diagnostic.code);
  const reason = diagnosticString(diagnosticData(diagnostic), 'reason');
  return STALE_HEAD_DIAGNOSTIC_CODES.has(code) || reason === 'stale-head' || reason === 'staleHead';
}

function isUnsupportedDomainDiagnostic(diagnostic: VersionDiagnostic): boolean {
  const code = String(diagnostic.code);
  const data = diagnosticData(diagnostic);
  const category =
    diagnosticString(data, 'category') ??
    diagnosticString(data, 'accessCategory') ??
    diagnosticNestedString(data, 'payload', 'category');
  const reason =
    diagnosticString(data, 'reason') ?? diagnosticNestedString(data, 'payload', 'reason');

  return (
    UNSUPPORTED_DOMAIN_DIAGNOSTIC_CODES.has(code) ||
    category === 'unsupported' ||
    category === 'opaque' ||
    category === 'subset-hidden' ||
    reason === 'unsupportedDomain' ||
    reason === 'opaqueDomain'
  );
}

function isIncompleteDiffDiagnostic(diagnostic: VersionDiagnostic): boolean {
  const code = String(diagnostic.code);
  return INCOMPLETE_DIFF_DIAGNOSTIC_CODES.has(code) || code.includes('DIFF_COMPLETENESS');
}

function incompleteDiffDiagnosticApplies(capability: VersionCapability): boolean {
  return (
    capability === 'version:reviewRead' ||
    capability === 'version:reviewWrite' ||
    capability === 'version:proposal' ||
    capability === 'version:mergePreview' ||
    capability === 'version:mergeApply'
  );
}

function isIncompleteHistoryDiagnostic(diagnostic: VersionDiagnostic): boolean {
  const code = String(diagnostic.code);
  const category =
    diagnosticString(diagnosticData(diagnostic), 'category') ??
    diagnosticNestedString(diagnosticData(diagnostic), 'payload', 'category');
  return (
    INCOMPLETE_HISTORY_DIAGNOSTIC_CODES.has(code) ||
    code.includes('HISTORY_GAP') ||
    category === 'incomplete'
  );
}

function allSurfaceDiagnostics(surface: VersionSurfaceStatus): readonly VersionDiagnostic[] {
  return [
    ...diagnosticsArray(surface.diagnostics),
    ...diagnosticsArray(surface.storage?.diagnostics),
    ...diagnosticsArray(surface.dirty?.diagnostics),
    ...diagnosticsArray(surface.dirty?.unsafeReasons),
  ];
}

function diagnosticsArray(value: unknown): readonly VersionDiagnostic[] {
  return Array.isArray(value) ? (value as readonly VersionDiagnostic[]) : [];
}

function diagnosticData(
  diagnostic: VersionDiagnostic,
): Readonly<Record<string, unknown>> | undefined {
  const data = diagnostic.data;
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Readonly<Record<string, unknown>>)
    : undefined;
}

function diagnosticString(
  data: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = data?.[key];
  return typeof value === 'string' ? value : undefined;
}

function diagnosticStringArray(
  data: Readonly<Record<string, unknown>> | undefined,
  key: string,
): readonly string[] {
  const value = data?.[key];
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function diagnosticNestedString(
  data: Readonly<Record<string, unknown>> | undefined,
  parentKey: string,
  key: string,
): string | undefined {
  const parent = data?.[parentKey];
  return parent && typeof parent === 'object' && !Array.isArray(parent)
    ? diagnosticString(parent as Readonly<Record<string, unknown>>, key)
    : undefined;
}
