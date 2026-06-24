import type { VersionGraphStoreDiagnostic, VersionGraphWriteResult } from '../graph';
import type {
  VersionGraphRegistryReadResult,
  VersionStoreDiagnostic,
  VersionStoreFailure,
  VersionStoreOperation,
} from '../provider';
import type { VersionDocumentScope } from '../registry';
import { versionStoreDiagnostic } from './internal-diagnostics';

export function failedStoreResult(
  diagnostics: readonly VersionStoreDiagnostic[],
  mutationGuarantee: VersionStoreFailure['mutationGuarantee'],
  retryable = false,
): VersionStoreFailure {
  return {
    status: 'failed',
    diagnostics: Object.freeze([...diagnostics]),
    mutationGuarantee,
    retryable,
  };
}

export function failedGraphWrite(
  diagnostics: readonly VersionGraphStoreDiagnostic[],
  mutationGuarantee: Extract<VersionGraphWriteResult, { status: 'failed' }>['mutationGuarantee'],
): Extract<VersionGraphWriteResult, { status: 'failed' }> {
  return { status: 'failed', diagnostics, mutationGuarantee };
}

export function registryRecordResult(
  kind: 'corrupt' | 'unsupported',
  operation: VersionStoreOperation,
  documentScope: VersionDocumentScope,
): Extract<VersionGraphRegistryReadResult, { status: 'corrupt' | 'unsupported' }> {
  const code = kind === 'corrupt' ? 'VERSION_CORRUPT_REGISTRY' : 'VERSION_UNSUPPORTED_REGISTRY';
  return {
    status: kind,
    registry: null,
    diagnostics: [
      versionStoreDiagnostic(code, {
        operation,
        documentScope,
        recoverability: kind === 'corrupt' ? 'repair' : 'unsupported',
        safeMessage:
          kind === 'corrupt'
            ? 'Version graph registry is corrupt and cannot be opened normally.'
            : 'Version graph registry schema is not supported by this provider.',
      }),
    ],
    mutationGuarantee: 'no-write-attempted',
  };
}
