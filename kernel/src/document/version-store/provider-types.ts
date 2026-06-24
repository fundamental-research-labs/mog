import type {
  InitializeVersionGraphInput,
  VersionGraphCommitRef,
  VersionGraphRef,
  VersionGraphStoreDiagnostic,
  VersionGraphStoreDiagnosticCode,
  VersionGraphSymbolicRef,
} from './graph';
import type { WorkbookCommitId } from './object-digest';
import type { VersionGraphNamespace } from './object-store';
import type { VersionGraphStore } from './provider-graph-store';
import type { VersionDocumentScope, VersionGraphRegistry, VersionRecordRevision } from './registry';

export type VersionAccessContext = {
  readonly principalScope?: string;
  readonly capabilityIds?: readonly string[];
  readonly diagnosticsAllowed?: boolean;
};

export type VersionStoreCapabilities = {
  readonly durableGraphRegistry: boolean;
  readonly durableObjects: boolean;
  readonly atomicObjectBatch: boolean;
  readonly casRefs: boolean;
  readonly casGraphRegistry: boolean;
  readonly multiProcessCasGraphRegistry: boolean;
  readonly multiProcessCasRefs: boolean;
  readonly readOnlyHistory: boolean;
  readonly integrityScan: boolean;
  readonly corruptionQuarantine: boolean;
  readonly reads: {
    readonly graphRegistry: boolean;
    readonly objects: boolean;
    readonly refs: boolean;
    readonly commits: boolean;
    readonly snapshots: boolean;
    readonly integrityReports: boolean;
  };
  readonly writes: {
    readonly initializeGraph: boolean;
    readonly putObjects: boolean;
    readonly updateRefs: boolean;
    readonly updateSymbolicRefs: boolean;
    readonly commitGraphWrite: boolean;
    readonly repairIndexes: boolean;
    readonly quarantineCorruptRecords: boolean;
  };
};

export type VersionStoreCloseReason = 'workbook-close' | 'dispose' | 'error' | 'test-teardown';
export type VersionStoreLifecycleState =
  | 'open'
  | 'closing'
  | 'close-failed'
  | 'closed'
  | 'disposing'
  | 'dispose-failed'
  | 'disposed';

export type VersionStoreOperation =
  | 'readGraphRegistry'
  | 'initializeGraph'
  | 'openGraph'
  | 'commitGraphWrite'
  | 'scanDocumentIntegrity'
  | 'close'
  | 'dispose';

export type VersionStoreMutationGuarantee =
  | 'ref-not-mutated'
  | 'registry-not-visible'
  | 'no-write-attempted'
  | 'unknown-after-crash';

export type VersionStoreDiagnosticCode =
  | VersionGraphStoreDiagnosticCode
  | 'VERSION_STORE_READ_ONLY'
  | 'VERSION_STORE_UNAVAILABLE'
  | 'VERSION_UNSUPPORTED_DURABLE_PERSISTENCE'
  | 'VERSION_UNSUPPORTED_REGISTRY'
  | 'VERSION_CORRUPT_REGISTRY'
  | 'VERSION_MISSING_CHANGE_SET'
  | 'VERSION_HISTORY_ROOT_POLICY_BLOCKED'
  | 'VERSION_PROVIDER_FAILED';

export type VersionDiagnosticMessageId =
  | 'version.store.unavailable'
  | 'version.provider.failed'
  | 'version.store.read-only'
  | 'version.graph.uninitialized'
  | 'version.graph.conflict'
  | 'version.registry.unsupported'
  | 'version.registry.corrupt'
  | 'version.integrity.wrong-namespace'
  | 'version.integrity.missing-object'
  | 'version.integrity.missing-parent'
  | 'version.integrity.missing-change-set'
  | 'version.history-root-policy.blocked'
  | 'version.ref.conflict'
  | 'version.ref.dangling'
  | 'version.options.invalid'
  | 'version.page-cursor.stale'
  | 'version.unsupported';

export type VersionStoreDiagnostic = {
  readonly code: VersionStoreDiagnosticCode;
  readonly issueCode: VersionStoreDiagnosticCode;
  readonly severity: 'info' | 'warning' | 'error' | 'fatal';
  readonly recoverability: 'retry' | 'repair' | 'unsupported' | 'none';
  readonly messageTemplateId: VersionDiagnosticMessageId;
  readonly safeMessage: string;
  readonly message: string;
  readonly operation: VersionStoreOperation;
  readonly redacted: true;
  readonly documentScope?: VersionDocumentScope;
  readonly namespace?: VersionGraphNamespace;
  readonly refName?: string;
  readonly commitId?: WorkbookCommitId;
  readonly mutationGuarantee?: VersionStoreMutationGuarantee;
  readonly lifecycleState?: VersionStoreLifecycleState;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
  readonly sourceDiagnostics?: readonly VersionGraphStoreDiagnostic[];
};

export type VersionStoreFailure = {
  readonly status: 'failed';
  readonly diagnostics: readonly VersionStoreDiagnostic[];
  readonly mutationGuarantee: Extract<
    VersionStoreMutationGuarantee,
    'ref-not-mutated' | 'registry-not-visible' | 'no-write-attempted'
  >;
  readonly retryable: boolean;
};

export type VersionGraphRegistryReadResult =
  | {
      readonly status: 'ok';
      readonly registry: VersionGraphRegistry;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    }
  | {
      readonly status: 'absent';
      readonly registry: null;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    }
  | {
      readonly status: 'unsupported';
      readonly registry: null;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
      readonly mutationGuarantee: 'no-write-attempted';
    }
  | {
      readonly status: 'corrupt';
      readonly registry: null;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
      readonly mutationGuarantee: 'no-write-attempted';
    };

export type VersionGraphInitializeInput = {
  readonly expectedRegistryRevision: VersionRecordRevision | null;
  readonly graphId: string;
  readonly rootWrite: InitializeVersionGraphInput;
  readonly requireDurablePersistence?: boolean;
};

export type VersionGraphInitializeResult =
  | {
      readonly status: 'success';
      readonly registry: VersionGraphRegistry;
      readonly rootCommit: VersionGraphCommitRef;
      readonly initialHead: VersionGraphRef;
      readonly symbolicHead: VersionGraphSymbolicRef;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    }
  | VersionStoreFailure;

export type VersionDocumentIntegrityScanOptions = {
  readonly includeOrphanGraphs?: boolean;
  readonly quarantineCorruptRecords?: boolean;
};

export type VersionIntegrityReport = {
  readonly status: 'ok' | 'degraded' | 'corrupt';
  readonly checkedAt: string;
  readonly scanScope: 'document';
  readonly diagnostics: readonly VersionStoreDiagnostic[];
};

export interface VersionStoreProvider {
  readonly documentScope: VersionDocumentScope;
  readonly accessContext: VersionAccessContext;
  readonly capabilities: VersionStoreCapabilities;
  readGraphRegistry(): Promise<VersionGraphRegistryReadResult>;
  initializeGraph(input: VersionGraphInitializeInput): Promise<VersionGraphInitializeResult>;
  openGraph(
    namespace: VersionGraphNamespace,
    accessContext?: VersionAccessContext,
  ): Promise<VersionGraphStore>;
  scanDocumentIntegrity(
    options?: VersionDocumentIntegrityScanOptions,
  ): Promise<VersionIntegrityReport>;
  close(reason?: VersionStoreCloseReason): Promise<void>;
  dispose(reason?: VersionStoreCloseReason): Promise<void>;
}
