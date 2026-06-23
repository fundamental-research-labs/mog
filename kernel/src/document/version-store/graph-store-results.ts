import type { VersionGraphStoreDiagnostic, VersionGraphWriteFailure } from './graph-store-types';

export function failedGraphWrite(
  diagnostics: readonly VersionGraphStoreDiagnostic[],
  mutationGuarantee: VersionGraphWriteFailure['mutationGuarantee'],
): VersionGraphWriteFailure {
  return { status: 'failed', diagnostics, mutationGuarantee };
}
