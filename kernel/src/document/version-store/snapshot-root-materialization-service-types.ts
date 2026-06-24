import type {
  CheckoutMaterializationDiagnostic,
  CheckoutMaterializationRequest,
} from './checkout-service';
import type { ObjectDigest, WorkbookCommitId } from './object-digest';
import type { VersionGraphNamespace, VersionObjectRecord } from './object-store';
import type { VersionStoreDiagnostic, VersionStoreProvider } from './provider';
import type {
  SnapshotRootFreshLifecycleHydrator,
  SnapshotRootReloadDiagnostic,
  SnapshotRootReloadService,
} from './snapshot-root-reload-service';

export type SnapshotRootMaterializationDiagnosticCode =
  | 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_PROVIDER_FAILED'
  | 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_CHECKOUT_PLAN_FAILED'
  | 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_COMMIT_READ_FAILED'
  | 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_OBJECT_READ_FAILED'
  | 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_MIRROR_SETTLE_FAILED'
  | 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_RELOAD_FAILED';

type SnapshotRootMaterializationSourceDiagnostic =
  | VersionStoreDiagnostic
  | CheckoutMaterializationDiagnostic
  | SnapshotRootReloadDiagnostic
  | SnapshotRootMaterializationDiagnostic
  | Readonly<Record<string, unknown>>;

export interface SnapshotRootMaterializationDiagnostic {
  readonly code: SnapshotRootMaterializationDiagnosticCode;
  readonly severity: 'error' | 'corruption';
  readonly message: string;
  readonly namespace?: VersionGraphNamespace;
  readonly commitId?: WorkbookCommitId;
  readonly objectDigest?: ObjectDigest;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
  readonly sourceDiagnostics?: readonly SnapshotRootMaterializationSourceDiagnostic[];
}

export type SnapshotRootMaterializationResult<TMaterialized = unknown> =
  | {
      readonly ok: true;
      readonly materialization: 'fresh-lifecycle';
      readonly commitId: WorkbookCommitId;
      readonly snapshotRootDigest: ObjectDigest;
      readonly snapshotRootRecord: VersionObjectRecord<unknown>;
      readonly materialized: TMaterialized;
      readonly decodedByteLength: number;
      readonly diagnostics: readonly SnapshotRootMaterializationDiagnostic[];
      readonly mutationGuarantee: 'no-current-workbook-mutation';
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: SnapshotRootMaterializationDiagnosticCode;
        readonly message: string;
        readonly diagnostics: readonly SnapshotRootMaterializationDiagnostic[];
      };
      readonly commitId?: WorkbookCommitId;
      readonly snapshotRootDigest?: ObjectDigest;
      readonly decodedByteLength?: number;
      readonly diagnostics: readonly SnapshotRootMaterializationDiagnostic[];
      readonly mutationGuarantee: 'no-current-workbook-mutation';
    };

export interface SnapshotRootMaterializationServiceOptions<TMaterialized = unknown> {
  readonly provider: VersionStoreProvider;
  readonly reloadService?: SnapshotRootReloadService<TMaterialized>;
  readonly hydrator?: SnapshotRootFreshLifecycleHydrator<TMaterialized>;
}

export type SnapshotRootMaterializationRequest = CheckoutMaterializationRequest;
