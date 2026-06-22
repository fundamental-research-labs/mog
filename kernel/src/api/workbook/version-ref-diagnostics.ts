import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

const NO_WRITE_ATTEMPTED_BRANCH_DIAGNOSTIC_CODES = new Set([
  'casConflict',
  'expectedHeadMismatch',
  'expectedRefVersionMismatch',
  'refAlreadyExists',
  'refNotFound',
  'refTombstoned',
  'invalidCommitId',
  'invalidRefName',
  'invalidRefPrefix',
  'invalidRefVersion',
  'lastLiveRef',
  'protectedRef',
  'reservedNamespace',
  'unsupportedDetachedHead',
  'unsupportedRefMetadataMutation',
  'unsupportedRefOption',
]);

export function branchDiagnosticMutationGuarantee(
  code: string,
  details: unknown,
): VersionStoreDiagnostic['mutationGuarantee'] | undefined {
  const explicit = isRecord(details)
    ? toPublicMutationGuarantee(details.mutationGuarantee)
    : undefined;
  if (explicit) return explicit;
  return NO_WRITE_ATTEMPTED_BRANCH_DIAGNOSTIC_CODES.has(code) ? 'no-write-attempted' : undefined;
}

function toPublicMutationGuarantee(
  value: unknown,
): VersionStoreDiagnostic['mutationGuarantee'] | undefined {
  return value === 'ref-not-mutated' ||
    value === 'registry-not-visible' ||
    value === 'no-write-attempted' ||
    value === 'unknown-after-crash'
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
