import type {
  VersionPageToken,
  VersionRecordRevision,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';
import { isPublicVersionDiffCursor } from '@mog-sdk/contracts/versioning';
import { WORKBOOK_COMMIT_ID_RE } from './version-diff-constants';

export function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

export function toPageToken(value: unknown): VersionPageToken | undefined {
  return isPublicVersionDiffCursor(value) ? (value as VersionPageToken) : undefined;
}

export function toRevision(value: unknown): VersionRecordRevision | undefined {
  if (isRecord(value) && value.kind === 'counter' && typeof value.value === 'string') {
    return { kind: 'counter', value: value.value };
  }
  if (isRecord(value) && value.kind === 'opaque' && typeof value.value === 'string') {
    return { kind: 'opaque', value: value.value };
  }
  if (typeof value === 'string') return { kind: 'opaque', value };
  return undefined;
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

export function isPayloadPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

export function formatPrimitiveForPayload(value: unknown): string | number | boolean | null {
  return isPayloadPrimitive(value) ? value : String(value);
}

export function isRecoverability(
  value: unknown,
): value is VersionStoreDiagnostic['recoverability'] {
  return value === 'retry' || value === 'repair' || value === 'unsupported' || value === 'none';
}

export function sanitizePayloadPrimitive(
  value: unknown,
): string | number | boolean | null | undefined {
  if (!isPayloadPrimitive(value)) return undefined;
  if (typeof value !== 'string') return value;
  return /\b(?:preimage|commit:sha256:|merge-result:|sha256:[0-9a-f]{64}|secret|token)\b/i.test(
    value,
  )
    ? 'redacted'
    : value;
}
