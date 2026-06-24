import type { VersionRecordRevision } from '@mog-sdk/contracts/api';

export function revisionsEqual(left: VersionRecordRevision, right: VersionRecordRevision): boolean {
  return left.kind === right.kind && left.value === right.value;
}

export function isVersionRecordRevision(value: unknown): value is VersionRecordRevision {
  return (
    isRecord(value) &&
    (value.kind === 'counter' || value.kind === 'opaque') &&
    typeof value.value === 'string'
  );
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
