import type { ObjectDigest, WorkbookCommitId } from './object-digest';
import type { SnapshotRootMaterializationResult } from './snapshot-root-materialization-service';
import type {
  VersionPersistenceReloadDiagnostic,
  VersionPersistenceReloadDiagnosticCode,
  VersionPersistenceReloadResult,
} from './version-persistence-types';

export function versionPersistenceReloadServiceUnavailable<TMaterialized>(): Extract<
  VersionPersistenceReloadResult<TMaterialized>,
  { ok: false }
> {
  return reloadFailure(
    'VERSION_PERSISTENCE_RELOAD_SERVICE_UNAVAILABLE',
    'VersionPersistence.reload requires a snapshot-root materialization service or version-store provider.',
  );
}

export function versionPersistenceReloadMaterializationFailure<TMaterialized>(
  materialized: Extract<SnapshotRootMaterializationResult<TMaterialized>, { ok: false }>,
): Extract<VersionPersistenceReloadResult<TMaterialized>, { ok: false }> {
  return reloadFailure(
    'VERSION_PERSISTENCE_RELOAD_MATERIALIZATION_FAILED',
    'VersionPersistence.reload could not materialize a committed snapshot root.',
    {
      commitId: materialized.commitId,
      snapshotRootDigest: materialized.snapshotRootDigest,
      decodedByteLength: materialized.decodedByteLength,
      sourceDiagnostics: materialized.diagnostics,
      details: {
        sourceCode: materialized.error.code,
      },
    },
  );
}

function reloadFailure<TMaterialized>(
  code: VersionPersistenceReloadDiagnosticCode,
  message: string,
  options: {
    readonly commitId?: WorkbookCommitId;
    readonly snapshotRootDigest?: ObjectDigest;
    readonly decodedByteLength?: number;
    readonly details?: VersionPersistenceReloadDiagnostic['details'];
    readonly sourceDiagnostics?: VersionPersistenceReloadDiagnostic['sourceDiagnostics'];
  } = {},
): Extract<VersionPersistenceReloadResult<TMaterialized>, { ok: false }> {
  const diagnostics = [
    reloadDiagnostic(code, message, {
      ...(options.commitId ? { commitId: options.commitId } : {}),
      ...(options.snapshotRootDigest ? { snapshotRootDigest: options.snapshotRootDigest } : {}),
      ...(options.decodedByteLength === undefined
        ? {}
        : { decodedByteLength: options.decodedByteLength }),
      ...(options.details ? { details: options.details } : {}),
      ...(options.sourceDiagnostics ? { sourceDiagnostics: options.sourceDiagnostics } : {}),
    }),
  ];
  return Object.freeze({
    ok: false as const,
    error: Object.freeze({ code, message, diagnostics }),
    ...(options.commitId ? { commitId: options.commitId } : {}),
    ...(options.snapshotRootDigest ? { snapshotRootDigest: options.snapshotRootDigest } : {}),
    ...(options.decodedByteLength === undefined
      ? {}
      : { decodedByteLength: options.decodedByteLength }),
    diagnostics,
    mutationGuarantee: 'no-current-workbook-mutation' as const,
  });
}

function reloadDiagnostic(
  code: VersionPersistenceReloadDiagnosticCode,
  message: string,
  options: Omit<VersionPersistenceReloadDiagnostic, 'code' | 'severity' | 'message'> = {},
): VersionPersistenceReloadDiagnostic {
  return Object.freeze({
    code,
    severity:
      options.sourceDiagnostics?.some((source) => source.severity === 'corruption') === true
        ? 'corruption'
        : 'error',
    message,
    ...options,
  });
}
