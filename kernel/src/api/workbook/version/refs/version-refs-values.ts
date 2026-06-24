import type { VersionRecordRevision, WorkbookCommitId } from '@mog-sdk/contracts/api';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const REF_COUNTER_REVISION_VALUE_RE = /^(0|[1-9][0-9]*)$/;

export function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

export function toRevision(value: unknown): VersionRecordRevision | undefined {
  if (
    isRecord(value) &&
    value.kind === 'counter' &&
    typeof value.value === 'string' &&
    REF_COUNTER_REVISION_VALUE_RE.test(value.value)
  ) {
    return { kind: 'counter', value: value.value };
  }
  if (
    isRecord(value) &&
    value.kind === 'opaque' &&
    typeof value.value === 'string' &&
    value.value.length > 0
  ) {
    return { kind: 'opaque', value: value.value };
  }
  return undefined;
}

export function toCounterRevision(
  value: unknown,
): Extract<VersionRecordRevision, { readonly kind: 'counter' }> | undefined {
  const revision = toRevision(value);
  return revision?.kind === 'counter' ? revision : undefined;
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
