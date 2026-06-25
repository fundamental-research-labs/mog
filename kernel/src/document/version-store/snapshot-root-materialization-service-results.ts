import type { CheckoutMaterializationResult } from './checkout-service';
import type { ObjectDigest, WorkbookCommitId } from './object-digest';
import { VersionObjectStoreError, type VersionGraphNamespace } from './object-store';
import type { SnapshotRootReloadResult } from './snapshot-root-reload-service';
import type {
  SnapshotRootMaterializationDiagnostic,
  SnapshotRootMaterializationDiagnosticCode,
  SnapshotRootMaterializationResult,
} from './snapshot-root-materialization-service-types';
import { errorName } from './snapshot-root-materialization-service-utils';

export function checkoutPlanFailure<TMaterialized>(
  namespace: VersionGraphNamespace,
  planned: Extract<CheckoutMaterializationResult, { ok: false }>,
): Extract<SnapshotRootMaterializationResult<TMaterialized>, { ok: false }> {
  const first = planned.diagnostics[0];
  return failure(
    first?.code === 'VERSION_CHECKOUT_COMMIT_READ_FAILED' ||
      first?.code === 'VERSION_CHECKOUT_MISSING_COMMIT'
      ? 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_COMMIT_READ_FAILED'
      : 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_CHECKOUT_PLAN_FAILED',
    'Checkout planning failed before snapshot-root materialization.',
    {
      namespace,
      commitId: first?.commitId,
      snapshotRootDigest: first?.objectDigest,
      sourceDiagnostics: planned.diagnostics,
    },
  );
}

export function reloadFailure<TMaterialized>(
  commitId: WorkbookCommitId,
  snapshotRootDigest: ObjectDigest,
  reloaded: Extract<SnapshotRootReloadResult<TMaterialized>, { ok: false }>,
): Extract<SnapshotRootMaterializationResult<TMaterialized>, { ok: false }> {
  return failure(
    'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_RELOAD_FAILED',
    'Snapshot-root object could not be materialized through a fresh lifecycle.',
    {
      commitId,
      snapshotRootDigest,
      decodedByteLength: reloaded.decodedByteLength,
      sourceDiagnostics: reloaded.diagnostics,
    },
  );
}

export function failure<TMaterialized>(
  code: SnapshotRootMaterializationDiagnosticCode,
  message: string,
  options: {
    readonly namespace?: VersionGraphNamespace;
    readonly commitId?: WorkbookCommitId;
    readonly snapshotRootDigest?: ObjectDigest;
    readonly decodedByteLength?: number;
    readonly sourceDiagnostics?: SnapshotRootMaterializationDiagnostic['sourceDiagnostics'];
  } = {},
): Extract<SnapshotRootMaterializationResult<TMaterialized>, { ok: false }> {
  const diagnostics = [
    diagnostic(code, message, {
      namespace: options.namespace,
      commitId: options.commitId,
      objectDigest: options.snapshotRootDigest,
      sourceDiagnostics: options.sourceDiagnostics,
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

function diagnostic(
  code: SnapshotRootMaterializationDiagnosticCode,
  message: string,
  options: Omit<SnapshotRootMaterializationDiagnostic, 'code' | 'severity' | 'message'> = {},
): SnapshotRootMaterializationDiagnostic {
  return Object.freeze({
    code,
    severity:
      code === 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_OBJECT_READ_FAILED' ? 'corruption' : 'error',
    message,
    ...options,
  });
}

export function diagnosticsFromObjectReadError(
  error: unknown,
): NonNullable<SnapshotRootMaterializationDiagnostic['sourceDiagnostics']> {
  if (error instanceof VersionObjectStoreError) return [error.diagnostic];
  return [{ cause: errorName(error) }];
}
