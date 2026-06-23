import type {
  VersionCapabilityDependency,
  VersionDiagnostic,
  VersionSurfaceStatus,
} from '@mog-sdk/contracts/api';

import type { BoundMethod, MaybePromise } from './version-surface-status-service-types';

export const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';
export const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;

const SYNC_BATCH_STATUS_ID_RE = /^sync-batch-status:sha256:[0-9a-f]{64}$/;
const DIAGNOSTIC_DEPENDENCIES = new Set<VersionCapabilityDependency>([
  'VC-04',
  'VC-05',
  'VC-07',
  'VC-09',
  'storage',
  'featureGate',
  'hostCapability',
  'upstreamRevertContract',
]);

export function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

export function toCommitId(value: unknown): string | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value) ? value : null;
}

export function normalizeBranchName(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value.startsWith(VERSION_BRANCH_REF_PREFIX)
    ? value.slice(VERSION_BRANCH_REF_PREFIX.length)
    : value;
}

export function publicRefNameFromBranchName(branchName: string): string {
  return branchName.startsWith(VERSION_BRANCH_REF_PREFIX)
    ? branchName
    : `${VERSION_BRANCH_REF_PREFIX}${branchName}`;
}

export function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? Object.freeze([...value])
    : null;
}

export function diagnosticArray(value: unknown): readonly VersionDiagnostic[] | null {
  if (!Array.isArray(value)) return null;
  const diagnostics: VersionDiagnostic[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    if (
      typeof entry.code !== 'string' ||
      !isDiagnosticSeverity(entry.severity) ||
      typeof entry.message !== 'string'
    ) {
      return null;
    }
    const dependency = isDiagnosticDependency(entry.dependency) ? entry.dependency : undefined;
    const data = sanitizeDiagnosticData(entry.data);
    diagnostics.push({
      code: entry.code,
      severity: entry.severity,
      message: entry.message,
      ...(dependency ? { dependency } : {}),
      ...(data ? { data } : {}),
    });
  }
  return Object.freeze(diagnostics);
}

export function dedupeDiagnostics(
  diagnostics: readonly VersionDiagnostic[],
): readonly VersionDiagnostic[] {
  const seen = new Set<string>();
  const deduped: VersionDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}:${diagnostic.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(diagnostic);
  }
  return deduped;
}

export function surfaceDiagnostic(
  code: VersionDiagnostic['code'],
  severity: VersionDiagnostic['severity'],
  message: string,
  dependency: VersionDiagnostic['dependency'] = 'VC-05',
  data?: VersionDiagnostic['data'],
): VersionDiagnostic {
  return {
    code,
    severity,
    message,
    dependency,
    ...(data ? { data } : {}),
  };
}

export function normalizeBackend(value: unknown): VersionSurfaceStatus['storage']['backend'] {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.toLowerCase();
  if (normalized.includes('indexeddb') || normalized.includes('indexed-db')) return 'indexeddb';
  if (normalized.includes('memory') || normalized.includes('inmemory')) return 'memory';
  if (
    normalized.includes('remote') ||
    normalized.includes('cloud') ||
    normalized.includes('database') ||
    normalized.includes('object-store') ||
    normalized.includes('objectstore')
  ) {
    return 'remote';
  }
  return 'unknown';
}

function isDiagnosticSeverity(value: unknown): value is VersionDiagnostic['severity'] {
  return value === 'info' || value === 'warning' || value === 'error';
}

function isDiagnosticDependency(value: unknown): value is VersionCapabilityDependency {
  return (
    typeof value === 'string' && DIAGNOSTIC_DEPENDENCIES.has(value as VersionCapabilityDependency)
  );
}

function sanitizeDiagnosticData(value: unknown): VersionDiagnostic['data'] | undefined {
  if (!isRecord(value)) return undefined;
  const data: Record<string, string | number | boolean | null> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isPublicDiagnosticDataValue(entry)) continue;
    data[key] = shouldRedactDiagnosticDataValue(key, entry) ? 'redacted' : entry;
  }
  return Object.keys(data).length > 0 ? data : undefined;
}

function isPublicDiagnosticDataValue(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function shouldRedactDiagnosticDataValue(
  key: string,
  value: string | number | boolean | null,
): boolean {
  const normalizedKey = key.toLowerCase();
  if (
    normalizedKey.includes('secret') ||
    normalizedKey.includes('credential') ||
    normalizedKey.includes('password') ||
    normalizedKey.includes('authorization') ||
    normalizedKey.includes('token') ||
    normalizedKey.includes('cursor') ||
    normalizedKey.includes('trace') ||
    normalizedKey.includes('opaque') ||
    normalizedKey.includes('hidden') ||
    normalizedKey.includes('deleted') ||
    normalizedKey.includes('protected') ||
    normalizedKey.endsWith('batchid') ||
    normalizedKey.endsWith('batchstatusid')
  ) {
    return true;
  }
  return typeof value === 'string' && SYNC_BATCH_STATUS_ID_RE.test(value);
}
