import type { WorkbookCommitId } from '../object-digest';
import type {
  RefFailureResult,
  RefMutationConflict,
  RefVersion,
  TombstoneRefRecord,
  VersionDiagnostic,
  VersionErrorCode,
} from './ref-store-types';
import { cloneRefVersion } from './ref-store-revisions';

export function failure(
  code: VersionErrorCode,
  message: string,
  diagnostics: readonly VersionDiagnostic[],
  conflict?: RefMutationConflict,
): RefFailureResult {
  return {
    ok: false,
    error: {
      code,
      message,
      diagnostics,
    },
    conflict,
    diagnostics,
  };
}

export function diagnostic(
  code: string,
  message: string,
  refName?: string,
  commitId?: WorkbookCommitId,
  refVersion?: RefVersion,
  refIncarnationId?: string,
  previousRefIncarnationId?: string,
  tombstoneRefVersion?: RefVersion,
  details?: Record<string, string | boolean>,
): VersionDiagnostic {
  return Object.freeze({
    code,
    severity: 'error',
    message,
    refName,
    commitId,
    refVersion: refVersion === undefined ? undefined : cloneRefVersion(refVersion),
    refIncarnationId,
    previousRefIncarnationId,
    tombstoneRefVersion:
      tombstoneRefVersion === undefined ? undefined : cloneRefVersion(tombstoneRefVersion),
    details: freezeDiagnosticDetails(details),
  });
}

export function redactedDiagnostic(
  code: string,
  message: string,
  details: Record<string, string | boolean> = {},
): VersionDiagnostic {
  return diagnostic(
    code,
    message,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      ...details,
      redacted: true,
    },
  );
}

export function tombstoneDiagnostic(
  record: TombstoneRefRecord,
  code: string,
  message: string,
  details?: Record<string, string | boolean>,
): VersionDiagnostic {
  return diagnostic(
    code,
    message,
    record.name,
    record.previousTargetCommitId,
    record.refVersion,
    undefined,
    record.previousRefIncarnationId,
    record.refVersion,
    details,
  );
}

function freezeDiagnosticDetails(
  details: Record<string, string | boolean> | undefined,
): Readonly<Record<string, string | boolean>> | undefined {
  return details === undefined ? undefined : Object.freeze({ ...details });
}
