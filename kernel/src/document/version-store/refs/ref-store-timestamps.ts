import type { LiveRefRecord, TombstoneRefRecord } from './ref-store-types';
import { redactedDiagnostic } from './ref-store-diagnostics';
import { RefStoreValidationError } from './ref-store-revisions';

const RFC3339_MILLISECONDS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function normalizeRfc3339Milliseconds(value: Date | string, path = 'timestamp'): string {
  const timestamp = typeof value === 'string' ? value : value.toISOString();
  if (!isCanonicalRfc3339Milliseconds(timestamp)) {
    throw invalidTimestamp(path);
  }
  return timestamp;
}

export function normalizeLiveRefRecordTimestamps(record: LiveRefRecord): LiveRefRecord {
  return {
    ...record,
    createdAt: normalizeRfc3339Milliseconds(record.createdAt, 'record.createdAt'),
    updatedAt: normalizeRfc3339Milliseconds(record.updatedAt, 'record.updatedAt'),
  };
}

export function normalizeTombstoneRefRecordTimestamp(
  record: TombstoneRefRecord,
): TombstoneRefRecord {
  return {
    ...record,
    deletedAt: normalizeRfc3339Milliseconds(record.deletedAt, 'record.deletedAt'),
  };
}

export function compareRfc3339MillisecondsDescending(left: string, right: string): number {
  const leftEpoch = parseCanonicalRfc3339Milliseconds(left);
  const rightEpoch = parseCanonicalRfc3339Milliseconds(right);

  if (leftEpoch !== null && rightEpoch !== null && leftEpoch !== rightEpoch) {
    return rightEpoch - leftEpoch;
  }
  if (leftEpoch !== null && rightEpoch === null) {
    return -1;
  }
  if (leftEpoch === null && rightEpoch !== null) {
    return 1;
  }
  if (leftEpoch === null && rightEpoch === null) {
    return compareAscii(left, right);
  }
  return 0;
}

function parseCanonicalRfc3339Milliseconds(value: string): number | null {
  if (!RFC3339_MILLISECONDS_RE.test(value)) {
    return null;
  }
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) {
    return null;
  }
  return new Date(epoch).toISOString() === value ? epoch : null;
}

function isCanonicalRfc3339Milliseconds(value: string): boolean {
  return parseCanonicalRfc3339Milliseconds(value) !== null;
}

function invalidTimestamp(path: string): RefStoreValidationError {
  return new RefStoreValidationError(
    'versionCapabilityDisabled',
    'Ref store timestamps must be RFC 3339 UTC values with millisecond precision.',
    [
      redactedDiagnostic(
        'invalidTimestamp',
        'Ref store timestamps must be RFC 3339 UTC values with millisecond precision.',
        { path },
      ),
    ],
  );
}

function compareAscii(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
