import type { VersionRecordRevision, WorkbookCommitId } from '@mog-sdk/contracts/api';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;

export function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

export function toPublicRevision(value: unknown): VersionRecordRevision | undefined {
  if (
    isRecord(value) &&
    (value.kind === 'counter' || value.kind === 'opaque') &&
    typeof value.value === 'string' &&
    value.value.length > 0
  ) {
    return { kind: value.kind, value: value.value };
  }
  return undefined;
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

export function isPayloadPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}
