import type { VersionGraphNamespace } from './object-store';
import { SnapshotRootCaptureError } from './snapshot-root-capture';
import type {
  SnapshotRootFreshLifecycleHydrationResult,
  SnapshotRootFreshLifecycleMutationGuarantee,
  SnapshotRootReloadDiagnostic,
  SnapshotRootReloadDiagnosticCode,
  SnapshotRootReloadErrorCode,
  SnapshotRootReloadResult,
} from './snapshot-root-reload-types';

export function createSnapshotRootReloadHydratorFailedResult<TMaterialized>(
  error: unknown,
  decodedByteLength: number,
): Extract<SnapshotRootReloadResult<TMaterialized>, { readonly ok: false }> {
  return failure(
    'hydratorFailed',
    'Snapshot root fresh-lifecycle hydrator threw before reporting materialization.',
    [
      diagnostic(
        'VERSION_SNAPSHOT_ROOT_RELOAD_HYDRATOR_FAILED',
        'Snapshot root fresh-lifecycle hydrator threw before reporting materialization.',
        { details: { cause: errorName(error) } },
      ),
    ],
    'unknown-after-hydrator-failure',
    decodedByteLength,
  );
}

export function createSnapshotRootReloadHydratorRejectedResult<TMaterialized>(
  hydration: Extract<
    SnapshotRootFreshLifecycleHydrationResult<TMaterialized>,
    { readonly status: 'failed' }
  >,
  decodedByteLength: number,
): Extract<SnapshotRootReloadResult<TMaterialized>, { readonly ok: false }> {
  const hydratorDiagnostics = freezeDiagnostics(hydration.diagnostics);
  return failure(
    'hydratorRejected',
    'Snapshot root fresh-lifecycle hydrator did not materialize the snapshot root.',
    hydratorDiagnostics.length > 0
      ? hydratorDiagnostics
      : [
          diagnostic(
            'VERSION_SNAPSHOT_ROOT_RELOAD_HYDRATOR_REJECTED',
            'Snapshot root fresh-lifecycle hydrator did not materialize the snapshot root.',
          ),
        ],
    hydration.freshLifecycleMutationGuarantee ?? 'unknown-after-hydrator-failure',
    decodedByteLength,
  );
}

export function invalidHydratorResult<TMaterialized>(
  decodedByteLength: number,
): SnapshotRootReloadResult<TMaterialized> {
  return failure(
    'invalidHydratorResult',
    'Snapshot root fresh-lifecycle hydrator returned an invalid result.',
    [
      diagnostic(
        'VERSION_SNAPSHOT_ROOT_RELOAD_INVALID_HYDRATOR_RESULT',
        'Snapshot root fresh-lifecycle hydrator returned an invalid result.',
      ),
    ],
    'unknown-after-hydrator-failure',
    decodedByteLength,
  );
}

export function invariantFailure<TMaterialized>(
  diagnostics: readonly SnapshotRootReloadDiagnostic[],
  decodedByteLength: number,
): Extract<SnapshotRootReloadResult<TMaterialized>, { readonly ok: false }> {
  const firstCode = diagnostics[0]?.code;
  if (firstCode === 'VERSION_SNAPSHOT_ROOT_RELOAD_WRONG_NAMESPACE') {
    return failure(
      'wrongSnapshotRootNamespace',
      'Snapshot root namespace does not match the reload target.',
      diagnostics,
      'not-started',
      decodedByteLength,
    );
  }
  return failure(
    'missingCommitRoot',
    'Snapshot root reload is missing a required commit-root proof.',
    diagnostics,
    'not-started',
    decodedByteLength,
  );
}

export function semanticIdentityFailure<TMaterialized>(
  diagnostics: readonly SnapshotRootReloadDiagnostic[],
  decodedByteLength: number,
): {
  readonly ok: false;
  readonly result: Extract<SnapshotRootReloadResult<TMaterialized>, { readonly ok: false }>;
} {
  return {
    ok: false,
    result: failure<TMaterialized>(
      'semanticIdentityUnproven',
      'Snapshot root fresh-lifecycle reload could not prove semantic identity.',
      diagnostics.length > 0
        ? diagnostics
        : [
            diagnostic(
              'VERSION_SNAPSHOT_ROOT_RELOAD_SEMANTIC_IDENTITY_UNPROVEN',
              'Snapshot root fresh-lifecycle reload could not prove semantic identity.',
            ),
          ],
      'fresh-lifecycle-rejected-after-materialization',
      decodedByteLength,
    ),
  };
}

export function invalidSnapshotRootDiagnostic(error: unknown): SnapshotRootReloadDiagnostic {
  if (error instanceof SnapshotRootCaptureError) {
    return diagnostic('VERSION_SNAPSHOT_ROOT_RELOAD_INVALID_ROOT', error.message, {
      path: error.path,
      details: { captureCode: error.code },
    });
  }

  return diagnostic(
    'VERSION_SNAPSHOT_ROOT_RELOAD_INVALID_ROOT',
    'Snapshot root validation failed.',
    { details: { cause: errorName(error) } },
  );
}

export function failure<TMaterialized>(
  code: SnapshotRootReloadErrorCode,
  message: string,
  diagnostics: readonly SnapshotRootReloadDiagnostic[],
  freshLifecycleMutationGuarantee: Exclude<
    SnapshotRootFreshLifecycleMutationGuarantee,
    'fresh-lifecycle-materialized'
  >,
  decodedByteLength?: number,
): Extract<SnapshotRootReloadResult<TMaterialized>, { readonly ok: false }> {
  const frozenDiagnostics = freezeDiagnostics(diagnostics);
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code,
      message,
      diagnostics: frozenDiagnostics,
    }),
    diagnostics: frozenDiagnostics,
    ...(decodedByteLength === undefined ? {} : { decodedByteLength }),
    mutationGuarantee: 'no-current-workbook-mutation',
    freshLifecycleMutationGuarantee,
  });
}

export function diagnostic(
  code: SnapshotRootReloadDiagnosticCode,
  message: string,
  options: Omit<SnapshotRootReloadDiagnostic, 'code' | 'severity' | 'message'> & {
    readonly severity?: SnapshotRootReloadDiagnostic['severity'];
  } = {},
): SnapshotRootReloadDiagnostic {
  const { severity = 'error', details, ...rest } = options;
  return Object.freeze({
    code,
    severity,
    message,
    ...rest,
    ...(details === undefined ? {} : { details: Object.freeze({ ...details }) }),
  });
}

export function freezeDiagnostics(
  diagnostics: readonly SnapshotRootReloadDiagnostic[],
): readonly SnapshotRootReloadDiagnostic[] {
  return Object.freeze(
    diagnostics.map((entry) =>
      diagnostic(entry.code, entry.message, {
        severity: entry.severity,
        ...(entry.path === undefined ? {} : { path: entry.path }),
        ...(entry.details === undefined ? {} : { details: entry.details }),
      }),
    ),
  );
}

export function wrongNamespaceDiagnostic(
  path: string,
  expected: VersionGraphNamespace,
  received?: VersionGraphNamespace,
): SnapshotRootReloadDiagnostic {
  return diagnostic(
    'VERSION_SNAPSHOT_ROOT_RELOAD_WRONG_NAMESPACE',
    'Snapshot root namespace does not match the reload target.',
    {
      path,
      details: {
        expectedDocumentId: expected.documentId,
        expectedGraphId: expected.graphId,
        expectedPrincipalScope: expected.principalScope ?? null,
        receivedDocumentId: received?.documentId ?? null,
        receivedGraphId: received?.graphId ?? null,
        receivedPrincipalScope: received?.principalScope ?? null,
      },
    },
  );
}

export function missingCommitRootDiagnostic(path: string): SnapshotRootReloadDiagnostic {
  return diagnostic(
    'VERSION_SNAPSHOT_ROOT_RELOAD_MISSING_COMMIT_ROOT',
    'Snapshot root reload is missing a required commit-root proof.',
    { path },
  );
}

export function errorName(error: unknown): string {
  if (error instanceof Error) return error.name;
  return typeof error;
}
