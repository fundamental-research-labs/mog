import type { CheckoutMaterializationRequest } from './checkout-service';
import type { ObjectDigest, WorkbookCommitId } from './object-digest';
import type { VersionObjectRecord } from './object-store';
import type { VersionStoreProvider } from './provider';
import type {
  SnapshotRootFreshLifecycleHydrator,
  SnapshotRootReloadService,
} from './snapshot-root-reload-service';
import {
  createSnapshotRootMaterializationService,
  type SnapshotRootMaterializationDiagnostic,
  type SnapshotRootMaterializationResult,
} from './snapshot-root-materialization-service';

export type VersionPersistenceReloadDiagnosticCode =
  | 'VERSION_PERSISTENCE_RELOAD_SERVICE_UNAVAILABLE'
  | 'VERSION_PERSISTENCE_RELOAD_MATERIALIZATION_FAILED';

export type VersionPersistenceReloadDiagnosticSource =
  | SnapshotRootMaterializationDiagnostic
  | Readonly<Record<string, unknown>>;

export interface VersionPersistenceReloadDiagnostic {
  readonly code: VersionPersistenceReloadDiagnosticCode;
  readonly severity: 'error' | 'corruption';
  readonly message: string;
  readonly commitId?: WorkbookCommitId;
  readonly snapshotRootDigest?: ObjectDigest;
  readonly decodedByteLength?: number;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
  readonly sourceDiagnostics?: readonly VersionPersistenceReloadDiagnosticSource[];
}

export type VersionPersistenceReloadRequest = CheckoutMaterializationRequest;

export type VersionPersistenceReloadResult<TMaterialized = unknown> =
  | {
      readonly ok: true;
      readonly reload: 'fresh-lifecycle';
      readonly materialization: 'fresh-lifecycle';
      readonly commitId: WorkbookCommitId;
      readonly snapshotRootDigest: ObjectDigest;
      readonly snapshotRootRecord: VersionObjectRecord<unknown>;
      readonly materialized: TMaterialized;
      readonly decodedByteLength: number;
      readonly diagnostics: readonly VersionPersistenceReloadDiagnostic[];
      readonly mutationGuarantee: 'no-current-workbook-mutation';
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: VersionPersistenceReloadDiagnosticCode;
        readonly message: string;
        readonly diagnostics: readonly VersionPersistenceReloadDiagnostic[];
      };
      readonly commitId?: WorkbookCommitId;
      readonly snapshotRootDigest?: ObjectDigest;
      readonly decodedByteLength?: number;
      readonly diagnostics: readonly VersionPersistenceReloadDiagnostic[];
      readonly mutationGuarantee: 'no-current-workbook-mutation';
    };

export interface VersionPersistenceSnapshotRootMaterializer<TMaterialized = unknown> {
  materializeSnapshotRoot(
    request: CheckoutMaterializationRequest,
  ): Promise<SnapshotRootMaterializationResult<TMaterialized>>;
}

export interface VersionPersistenceOptions<TMaterialized = unknown> {
  readonly materializationService?: VersionPersistenceSnapshotRootMaterializer<TMaterialized>;
  readonly provider?: VersionStoreProvider;
  readonly reloadService?: SnapshotRootReloadService<TMaterialized>;
  readonly hydrator?: SnapshotRootFreshLifecycleHydrator<TMaterialized>;
}

export class VersionPersistence<TMaterialized = unknown> {
  private readonly materializationService?: VersionPersistenceSnapshotRootMaterializer<TMaterialized>;

  constructor(options: VersionPersistenceOptions<TMaterialized> = {}) {
    this.materializationService =
      options.materializationService ??
      (options.provider
        ? createSnapshotRootMaterializationService({
            provider: options.provider,
            ...(options.reloadService ? { reloadService: options.reloadService } : {}),
            ...(options.hydrator ? { hydrator: options.hydrator } : {}),
          })
        : undefined);
  }

  async reload(
    request: VersionPersistenceReloadRequest,
  ): Promise<VersionPersistenceReloadResult<TMaterialized>> {
    if (!this.materializationService) return serviceUnavailable();

    const materialized = await this.materializationService.materializeSnapshotRoot(request);
    if (!materialized.ok) return materializationFailure(materialized);

    return Object.freeze({
      ok: true as const,
      reload: 'fresh-lifecycle' as const,
      materialization: materialized.materialization,
      commitId: materialized.commitId,
      snapshotRootDigest: materialized.snapshotRootDigest,
      snapshotRootRecord: materialized.snapshotRootRecord,
      materialized: materialized.materialized,
      decodedByteLength: materialized.decodedByteLength,
      diagnostics: [],
      mutationGuarantee: 'no-current-workbook-mutation' as const,
    });
  }
}

export function createVersionPersistence<TMaterialized = unknown>(
  options: VersionPersistenceOptions<TMaterialized> = {},
): VersionPersistence<TMaterialized> {
  return new VersionPersistence(options);
}

function serviceUnavailable<TMaterialized>(): Extract<
  VersionPersistenceReloadResult<TMaterialized>,
  { ok: false }
> {
  return failure(
    'VERSION_PERSISTENCE_RELOAD_SERVICE_UNAVAILABLE',
    'VersionPersistence.reload requires a snapshot-root materialization service or version-store provider.',
  );
}

function materializationFailure<TMaterialized>(
  materialized: Extract<SnapshotRootMaterializationResult<TMaterialized>, { ok: false }>,
): Extract<VersionPersistenceReloadResult<TMaterialized>, { ok: false }> {
  return failure(
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

function failure<TMaterialized>(
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
    diagnostic(code, message, {
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

function diagnostic(
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
