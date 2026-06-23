import type { CheckoutMaterializationRequest } from './checkout-service';
import type { ObjectDigest, WorkbookCommitId } from './object-digest';
import type { VersionObjectRecord } from './object-store';
import type { VersionStoreDiagnostic, VersionStoreProvider } from './provider';
import type {
  SnapshotRootFreshLifecycleHydrator,
  SnapshotRootReloadService,
} from './snapshot-root-reload-service';
import type {
  SnapshotRootMaterializationDiagnostic,
  SnapshotRootMaterializationResult,
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
