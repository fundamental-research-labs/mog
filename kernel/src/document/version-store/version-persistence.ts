import type { CheckoutMaterializationRequest } from './checkout-service';
import { parseWorkbookCommitId, type ObjectDigest, type WorkbookCommitId } from './object-digest';
import type { VersionObjectRecord } from './object-store';
import { namespaceForRegistry } from './registry';
import type { VersionStoreDiagnostic, VersionStoreProvider } from './provider';
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

export type VersionPersistenceBoundaryKind = 'segment-written-ref-not-advanced';

export type VersionPersistenceBoundaryDiagnosticCode =
  | 'VERSION_PERSISTENCE_BOUNDARY_INVALID_REQUEST'
  | 'VERSION_PERSISTENCE_BOUNDARY_PROVIDER_UNAVAILABLE'
  | 'VERSION_PERSISTENCE_BOUNDARY_REF_NOT_ADVANCED';

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

export type VersionPersistenceBoundaryDiagnosticSource =
  | VersionStoreDiagnostic
  | Readonly<Record<string, unknown>>;

export interface VersionPersistenceBoundaryDiagnostic {
  readonly code: VersionPersistenceBoundaryDiagnosticCode;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly boundary?: VersionPersistenceBoundaryKind;
  readonly commitId?: WorkbookCommitId;
  readonly graphId?: string;
  readonly recoveryAction?: 'reload-visible-graph';
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
  readonly sourceDiagnostics?: readonly VersionPersistenceBoundaryDiagnosticSource[];
}

export interface VersionPersistenceBoundaryRequest {
  readonly boundary: VersionPersistenceBoundaryKind;
  readonly commitId?: WorkbookCommitId | string;
}

export type VersionPersistenceBoundaryResult =
  | {
      readonly ok: true;
      readonly status: 'diagnosed';
      readonly boundary: VersionPersistenceBoundaryKind;
      readonly commitId?: WorkbookCommitId;
      readonly graphId: string;
      readonly recoveryAction: 'reload-visible-graph';
      readonly diagnostics: readonly VersionPersistenceBoundaryDiagnostic[];
      readonly mutationGuarantee: 'ref-not-mutated';
      readonly retryable: false;
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: VersionPersistenceBoundaryDiagnosticCode;
        readonly message: string;
        readonly diagnostics: readonly VersionPersistenceBoundaryDiagnostic[];
      };
      readonly boundary?: VersionPersistenceBoundaryKind;
      readonly commitId?: WorkbookCommitId;
      readonly diagnostics: readonly VersionPersistenceBoundaryDiagnostic[];
      readonly mutationGuarantee: 'no-write-attempted';
      readonly retryable: false;
    };

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
  private readonly provider?: VersionStoreProvider;
  private readonly materializationService?: VersionPersistenceSnapshotRootMaterializer<TMaterialized>;

  constructor(options: VersionPersistenceOptions<TMaterialized> = {}) {
    this.provider = options.provider;
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

  async persistBoundary(
    request: VersionPersistenceBoundaryRequest,
  ): Promise<VersionPersistenceBoundaryResult> {
    const parsed = parseBoundaryRequest(request);
    if (!parsed.ok) return boundaryFailure(parsed.code, parsed.message, parsed.options);

    if (!this.provider) {
      return boundaryFailure(
        'VERSION_PERSISTENCE_BOUNDARY_PROVIDER_UNAVAILABLE',
        'VersionPersistence.persistBoundary requires a version-store provider.',
        { boundary: parsed.boundary, commitId: parsed.commitId },
      );
    }

    try {
      const registryRead = await this.provider.readGraphRegistry();
      if (registryRead.status !== 'ok') {
        return boundaryFailure(
          'VERSION_PERSISTENCE_BOUNDARY_PROVIDER_UNAVAILABLE',
          'Visible version graph registry is unavailable for persistence-boundary recovery diagnostics.',
          {
            boundary: parsed.boundary,
            commitId: parsed.commitId,
            sourceDiagnostics: registryRead.diagnostics,
          },
        );
      }

      const namespace = namespaceForRegistry(registryRead.registry);
      const diagnostic = boundaryDiagnostic(
        'VERSION_PERSISTENCE_BOUNDARY_REF_NOT_ADVANCED',
        'Version persistence observed object writes before ref advancement; reload the visible graph before retrying writes.',
        {
          boundary: parsed.boundary,
          ...(parsed.commitId ? { commitId: parsed.commitId } : {}),
          graphId: namespace.graphId,
          recoveryAction: 'reload-visible-graph',
          details: { registryRevision: registryRead.registry.registryRevision.value },
        },
      );
      return Object.freeze({
        ok: true as const,
        status: 'diagnosed' as const,
        boundary: parsed.boundary,
        ...(parsed.commitId ? { commitId: parsed.commitId } : {}),
        graphId: namespace.graphId,
        recoveryAction: 'reload-visible-graph' as const,
        diagnostics: Object.freeze([diagnostic]),
        mutationGuarantee: 'ref-not-mutated' as const,
        retryable: false as const,
      });
    } catch (error) {
      return boundaryFailure(
        'VERSION_PERSISTENCE_BOUNDARY_PROVIDER_UNAVAILABLE',
        'Visible version graph registry could not be read for persistence-boundary recovery diagnostics.',
        {
          boundary: parsed.boundary,
          commitId: parsed.commitId,
          sourceDiagnostics: [{ cause: errorName(error) }],
        },
      );
    }
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

function parseBoundaryRequest(
  request: VersionPersistenceBoundaryRequest,
):
  | {
      readonly ok: true;
      readonly boundary: VersionPersistenceBoundaryKind;
      readonly commitId?: WorkbookCommitId;
    }
  | {
      readonly ok: false;
      readonly code: VersionPersistenceBoundaryDiagnosticCode;
      readonly message: string;
      readonly options?: {
        readonly boundary?: VersionPersistenceBoundaryKind;
        readonly commitId?: WorkbookCommitId;
        readonly details?: VersionPersistenceBoundaryDiagnostic['details'];
      };
    } {
  if (!isRecord(request)) {
    return {
      ok: false,
      code: 'VERSION_PERSISTENCE_BOUNDARY_INVALID_REQUEST',
      message: 'Persistence boundary request must be an object.',
    };
  }

  if (request.boundary !== 'segment-written-ref-not-advanced') {
    return {
      ok: false,
      code: 'VERSION_PERSISTENCE_BOUNDARY_INVALID_REQUEST',
      message: 'Persistence boundary request names an unsupported boundary.',
      options: {
        details: { boundary: formatUnknown(request.boundary) },
      },
    };
  }

  if (request.commitId === undefined) {
    return { ok: true, boundary: request.boundary };
  }

  try {
    return {
      ok: true,
      boundary: request.boundary,
      commitId: parseWorkbookCommitId(request.commitId),
    };
  } catch {
    return {
      ok: false,
      code: 'VERSION_PERSISTENCE_BOUNDARY_INVALID_REQUEST',
      message: 'Persistence boundary commitId must be commit:sha256:<64 lowercase hex>.',
      options: {
        boundary: request.boundary,
        details: { field: 'commitId' },
      },
    };
  }
}

function boundaryFailure(
  code: VersionPersistenceBoundaryDiagnosticCode,
  message: string,
  options: {
    readonly boundary?: VersionPersistenceBoundaryKind;
    readonly commitId?: WorkbookCommitId;
    readonly details?: VersionPersistenceBoundaryDiagnostic['details'];
    readonly sourceDiagnostics?: VersionPersistenceBoundaryDiagnostic['sourceDiagnostics'];
  } = {},
): Extract<VersionPersistenceBoundaryResult, { ok: false }> {
  const diagnostics = [
    boundaryDiagnostic(code, message, {
      ...(options.boundary ? { boundary: options.boundary } : {}),
      ...(options.commitId ? { commitId: options.commitId } : {}),
      ...(options.details ? { details: options.details } : {}),
      ...(options.sourceDiagnostics ? { sourceDiagnostics: options.sourceDiagnostics } : {}),
    }),
  ];
  return Object.freeze({
    ok: false as const,
    error: Object.freeze({ code, message, diagnostics }),
    ...(options.boundary ? { boundary: options.boundary } : {}),
    ...(options.commitId ? { commitId: options.commitId } : {}),
    diagnostics,
    mutationGuarantee: 'no-write-attempted' as const,
    retryable: false as const,
  });
}

function boundaryDiagnostic(
  code: VersionPersistenceBoundaryDiagnosticCode,
  message: string,
  options: Omit<VersionPersistenceBoundaryDiagnostic, 'code' | 'severity' | 'message'> = {},
): VersionPersistenceBoundaryDiagnostic {
  return Object.freeze({
    code,
    severity:
      code === 'VERSION_PERSISTENCE_BOUNDARY_REF_NOT_ADVANCED' ? 'warning' : 'error',
    message,
    ...options,
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function formatUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  return typeof value;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
