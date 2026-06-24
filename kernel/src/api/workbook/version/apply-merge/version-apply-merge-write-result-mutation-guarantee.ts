import type { VersionApplyMergeResult, VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

export function toApplyMergeMutationGuarantee(
  value: unknown,
): VersionApplyMergeResult['mutationGuarantee'] | undefined {
  return value === 'preview-only' ||
    value === 'merge-commit-created' ||
    value === 'ref-fast-forwarded' ||
    value === 'no-write-attempted' ||
    value === 'ref-not-mutated' ||
    value === 'unknown-after-crash'
    ? value
    : undefined;
}

export function toTerminalMutationGuarantee(
  value: unknown,
): 'ref-fast-forwarded' | 'ref-not-mutated' | undefined {
  return value === 'ref-fast-forwarded' || value === 'ref-not-mutated' ? value : undefined;
}

export function toDiagnosticMutationGuarantee(
  value: unknown,
): VersionStoreDiagnostic['mutationGuarantee'] | undefined {
  return value === 'no-write-attempted' ||
    value === 'ref-not-mutated' ||
    value === 'registry-not-visible' ||
    value === 'unknown-after-crash'
    ? value
    : undefined;
}
