import { failure, tombstoneDiagnostic } from './ref-store-diagnostics';
import { cloneRefVersion, isPlainRecord, refVersionsEqual } from './ref-store-revisions';
import { parseRefVersionForResult } from './ref-store-validation';
import type { RefFailureResult, RefVersion, TombstoneRefRecord } from './ref-store-types';

export function validateTombstoneReuseMetadata(
  record: TombstoneRefRecord,
  value: unknown,
): { readonly ok: true } | { readonly ok: false; readonly result: RefFailureResult } {
  if (value === undefined) return { ok: false, result: refTombstoned(record) };
  const message =
    'createBranch reuseTombstone requires expectedTombstoneRefVersion and expectedPreviousRefIncarnationId.';
  if (!isPlainRecord(value)) {
    return { ok: false, result: unsupportedTombstoneReuseMetadata(record, message) };
  }

  const expectedRefVersion = parseRefVersionForResult(
    value.expectedTombstoneRefVersion,
    'reuseTombstone.expectedTombstoneRefVersion',
  );
  if (!expectedRefVersion.ok) return expectedRefVersion;

  const expectedPreviousRefIncarnationId = value.expectedPreviousRefIncarnationId;
  if (
    typeof expectedPreviousRefIncarnationId !== 'string' ||
    expectedPreviousRefIncarnationId === ''
  ) {
    return { ok: false, result: unsupportedTombstoneReuseMetadata(record, message) };
  }
  if (!refVersionsEqual(record.refVersion, expectedRefVersion.refVersion)) {
    return {
      ok: false,
      result: expectedTombstoneRefVersionMismatch(record, expectedRefVersion.refVersion),
    };
  }
  if (record.previousRefIncarnationId !== expectedPreviousRefIncarnationId) {
    return {
      ok: false,
      result: expectedPreviousRefIncarnationIdMismatch(record, expectedPreviousRefIncarnationId),
    };
  }
  return { ok: true };
}

export function refTombstoned(record: TombstoneRefRecord): RefFailureResult {
  const diagnostics = [
    tombstoneDiagnostic(record, 'refTombstoned', `Ref ${record.name} is tombstoned.`),
  ];
  return failure('refTombstoned', `Ref ${record.name} is tombstoned.`, diagnostics, {
    code: 'refTombstoned',
    tombstoneRefVersion: cloneRefVersion(record.refVersion),
    previousRefIncarnationId: record.previousRefIncarnationId,
  });
}

function unsupportedTombstoneReuseMetadata(
  record: TombstoneRefRecord,
  message: string,
): RefFailureResult {
  return failure('unsupportedRefOption', message, [
    tombstoneDiagnostic(record, 'unsupportedRefOption', message, { option: 'reuseTombstone' }),
  ]);
}

function expectedTombstoneRefVersionMismatch(
  record: TombstoneRefRecord,
  expectedRefVersion: RefVersion,
): RefFailureResult {
  const message = `Tombstone for ref ${record.name} is at a different version than expected.`;
  return failure(
    'expectedRefVersionMismatch',
    message,
    [tombstoneDiagnostic(record, 'expectedRefVersionMismatch', message)],
    {
      code: 'expectedRefVersionMismatch',
      expectedRefVersion: cloneRefVersion(expectedRefVersion),
      actualRefVersion: cloneRefVersion(record.refVersion),
      tombstoneRefVersion: cloneRefVersion(record.refVersion),
      previousRefIncarnationId: record.previousRefIncarnationId,
    },
  );
}

function expectedPreviousRefIncarnationIdMismatch(
  record: TombstoneRefRecord,
  expectedPreviousRefIncarnationId: string,
): RefFailureResult {
  const message = `Tombstone for ref ${record.name} has a different previous incarnation than expected.`;
  return failure(
    'expectedPreviousRefIncarnationIdMismatch',
    message,
    [
      tombstoneDiagnostic(record, 'expectedPreviousRefIncarnationIdMismatch', message, {
        expectedPreviousRefIncarnationId,
      }),
    ],
    {
      code: 'expectedPreviousRefIncarnationIdMismatch',
      expectedPreviousRefIncarnationId,
      actualPreviousRefIncarnationId: record.previousRefIncarnationId,
      tombstoneRefVersion: cloneRefVersion(record.refVersion),
      previousRefIncarnationId: record.previousRefIncarnationId,
    },
  );
}
