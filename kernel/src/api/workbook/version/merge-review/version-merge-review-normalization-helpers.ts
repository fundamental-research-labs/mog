import type {
  JsonValue,
  VersionApplyMergeResolution,
  VersionMergeConflict,
  VersionMergeConflictDetailPurpose,
  VersionMergeConflictResolutionOption,
  VersionMergeConflictResolutionOptionKind,
  VersionMergeConflictValueRole,
  VersionMergeResolutionPayloadPurpose,
  VersionMergeResultId,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import { mapPublicObjectDigest } from '../../version-attempt-metadata';
import type { VersionMergePublicOperation } from '../merge/version-merge-capability';
import { mergeReviewDiagnostic } from './version-merge-review-artifacts';
import { normalizeVersionApplyMergeResolutions } from '../../version-merge-resolution-normalization';

const CONFLICT_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

export function invalidInputDiagnostic(
  operation: VersionMergePublicOperation,
  option: string,
  safeMessage: string,
): VersionStoreDiagnostic {
  return mergeReviewDiagnostic(operation, 'VERSION_INVALID_OPTIONS', safeMessage, {
    payload: { option },
  });
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeResolutions(
  operation: VersionMergePublicOperation,
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): readonly VersionApplyMergeResolution[] | null {
  const resolutions = normalizeVersionApplyMergeResolutions(value, diagnostics, {
    allowUndefined: false,
    invalidDiagnostic: invalidInputDiagnostic.bind(null, operation),
  });
  if (!resolutions) return null;
  for (let index = 0; index < resolutions.length; index++) {
    if (mapConflictDigest(resolutions[index].expectedConflictDigest)) continue;
    diagnostics.push(
      invalidInputDiagnostic(
        operation,
        `resolutions[${index}].expectedConflictDigest`,
        'expectedConflictDigest is invalid.',
      ),
    );
  }
  return diagnostics.length === 0 ? resolutions : null;
}

export function rejectUnknownKeys(
  operation: VersionMergePublicOperation,
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  diagnostics: VersionStoreDiagnostic[],
  prefix = 'input',
): void {
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    diagnostics.push(
      invalidInputDiagnostic(operation, `${prefix}.${key}`, `Unknown field "${key}".`),
    );
  }
}

export function normalizeMaxBytes(
  operation: VersionMergePublicOperation,
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    diagnostics.push(
      invalidInputDiagnostic(operation, 'maxBytes', 'maxBytes must be a positive integer.'),
    );
    return undefined;
  }
  return value;
}

export function mapMergeResultId(value: unknown): VersionMergeResultId | null {
  return typeof value === 'string' &&
    value.startsWith('merge-result:') &&
    value.length > 'merge-result:'.length
    ? (value as VersionMergeResultId)
    : null;
}

export function mapConflictDigest(value: unknown): string | null {
  if (typeof value === 'string') return CONFLICT_DIGEST_RE.test(value) ? value : null;
  const digest = mapPublicObjectDigest(value);
  return digest?.algorithm === 'sha256' ? `sha256:${digest.digest}` : null;
}

export function mapValueRole(value: unknown): VersionMergeConflictValueRole | null {
  return value === 'base' || value === 'ours' || value === 'theirs' || value === 'resolved'
    ? value
    : null;
}

export function mapDetailPurpose(value: unknown): VersionMergeConflictDetailPurpose | null {
  return value === 'review' || value === 'resolution' ? value : null;
}

export function mapPayloadPurpose(value: unknown): VersionMergeResolutionPayloadPurpose | null {
  return value === 'chooseValue' || value === 'custom' ? value : null;
}

export function mapResolutionKind(value: unknown): VersionMergeConflictResolutionOptionKind | null {
  return value === 'acceptOurs' || value === 'acceptTheirs' || value === 'acceptBase'
    ? value
    : null;
}

export function findResolutionOption(
  conflict: VersionMergeConflict,
  optionId: string,
  kind: VersionMergeConflictResolutionOptionKind,
): VersionMergeConflictResolutionOption | undefined {
  return conflict.resolutionOptions.find(
    (candidate) => candidate.optionId === optionId && candidate.kind === kind,
  );
}

export function mapNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
