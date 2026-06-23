import type { ObjectDigest, WorkbookCommitId } from './object-digest';
import type { VersionGraphNamespace, VersionObjectRecord } from './object-store';
import type { WorkbookSnapshotRootPayload } from './snapshot-root-capture';

type MaybePromise<T> = T | Promise<T>;
type DiagnosticDetails = Readonly<Record<string, string | number | boolean | null>>;

export type SnapshotRootReloadSourceKind = 'record' | 'payload';

export type SnapshotRootReloadDiagnosticCode =
  | 'VERSION_SNAPSHOT_ROOT_RELOAD_INVALID_ROOT'
  | 'VERSION_SNAPSHOT_ROOT_RELOAD_WRONG_NAMESPACE'
  | 'VERSION_SNAPSHOT_ROOT_RELOAD_MISSING_COMMIT_ROOT'
  | 'VERSION_SNAPSHOT_ROOT_RELOAD_HYDRATOR_FAILED'
  | 'VERSION_SNAPSHOT_ROOT_RELOAD_HYDRATOR_REJECTED'
  | 'VERSION_SNAPSHOT_ROOT_RELOAD_SEMANTIC_IDENTITY_UNPROVEN'
  | 'VERSION_SNAPSHOT_ROOT_RELOAD_INVALID_HYDRATOR_RESULT';

export type SnapshotRootReloadErrorCode =
  | 'invalidSnapshotRoot'
  | 'wrongSnapshotRootNamespace'
  | 'missingCommitRoot'
  | 'hydratorFailed'
  | 'hydratorRejected'
  | 'semanticIdentityUnproven'
  | 'invalidHydratorResult';

export type SnapshotRootReloadInput = VersionObjectRecord<unknown> | WorkbookSnapshotRootPayload;

export type SnapshotRootCurrentWorkbookMutationGuarantee = 'no-current-workbook-mutation';

export type SnapshotRootFreshLifecycleMutationGuarantee =
  | 'not-started'
  | 'no-fresh-lifecycle-mutation'
  | 'fresh-lifecycle-materialized'
  | 'fresh-lifecycle-rejected-after-materialization'
  | 'unknown-after-hydrator-failure';

export interface SnapshotRootReloadDiagnostic {
  readonly code: SnapshotRootReloadDiagnosticCode;
  readonly severity: 'info' | 'warning' | 'error' | 'corruption';
  readonly message: string;
  readonly path?: string;
  readonly details?: DiagnosticDetails;
}

export interface SnapshotRootReloadError {
  readonly code: SnapshotRootReloadErrorCode;
  readonly message: string;
  readonly diagnostics: readonly SnapshotRootReloadDiagnostic[];
}

export interface SnapshotRootFreshLifecycleHydrationInput {
  readonly yrsFullStateBytes: Uint8Array;
  readonly byteLength: number;
  readonly source: SnapshotRootReloadSourceKind;
  readonly objectDigest?: ObjectDigest;
  readonly namespace?: VersionGraphNamespace;
  readonly requiredCommitRoots?: readonly SnapshotRootReloadCommitRootProof[];
}

export type SnapshotRootFreshLifecycleHydrationResult<TMaterialized = unknown> =
  | {
      readonly status: 'materialized';
      readonly materialized: TMaterialized;
      readonly semanticIdentityProof?: SnapshotRootSemanticIdentityProof;
      readonly diagnostics?: readonly SnapshotRootReloadDiagnostic[];
    }
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly SnapshotRootReloadDiagnostic[];
      readonly freshLifecycleMutationGuarantee?: Extract<
        SnapshotRootFreshLifecycleMutationGuarantee,
        'no-fresh-lifecycle-mutation' | 'unknown-after-hydrator-failure'
      >;
    };

export interface SnapshotRootFreshLifecycleHydrator<TMaterialized = unknown> {
  hydrateYrsFullState(
    input: SnapshotRootFreshLifecycleHydrationInput,
  ): MaybePromise<SnapshotRootFreshLifecycleHydrationResult<TMaterialized>>;
}

export interface SnapshotRootReloadCommitRootProof {
  readonly commitId: WorkbookCommitId | string;
  readonly namespace: VersionGraphNamespace;
  readonly snapshotRootDigest: ObjectDigest;
}

export interface SnapshotRootSemanticIdentityProof {
  readonly proofKind: string;
  readonly semanticIdentityDigest?: ObjectDigest;
  readonly details?: DiagnosticDetails;
}

export type SnapshotRootSemanticIdentityVerificationResult =
  | {
      readonly ok: true;
      readonly proof: SnapshotRootSemanticIdentityProof;
      readonly diagnostics?: readonly SnapshotRootReloadDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly SnapshotRootReloadDiagnostic[];
    };

export interface SnapshotRootSemanticIdentityVerificationInput<TMaterialized = unknown> {
  readonly materialized: TMaterialized;
  readonly yrsFullStateBytes: Uint8Array;
  readonly decodedByteLength: number;
  readonly source: SnapshotRootReloadSourceKind;
  readonly objectDigest?: ObjectDigest;
  readonly namespace?: VersionGraphNamespace;
  readonly requiredCommitRoots: readonly SnapshotRootReloadCommitRootProof[];
}

export type SnapshotRootSemanticIdentityVerifier<TMaterialized = unknown> = (
  input: SnapshotRootSemanticIdentityVerificationInput<TMaterialized>,
) => MaybePromise<SnapshotRootSemanticIdentityVerificationResult>;

export interface SnapshotRootReloadInvariants<TMaterialized = unknown> {
  readonly expectedNamespace?: VersionGraphNamespace;
  readonly requiredCommitRoots?: readonly SnapshotRootReloadCommitRootProof[];
  readonly requireCommitRootProof?: boolean;
  readonly requireSemanticIdentityProof?: boolean;
  readonly semanticIdentityVerifier?: SnapshotRootSemanticIdentityVerifier<TMaterialized>;
}

export interface SnapshotRootReloadServiceOptions<TMaterialized = unknown> {
  readonly hydrator: SnapshotRootFreshLifecycleHydrator<TMaterialized>;
  readonly invariants?: SnapshotRootReloadInvariants<TMaterialized>;
}

export type SnapshotRootReloadResult<TMaterialized = unknown> =
  | {
      readonly ok: true;
      readonly materialization: 'fresh-lifecycle';
      readonly materialized: TMaterialized;
      readonly decodedByteLength: number;
      readonly diagnostics: readonly SnapshotRootReloadDiagnostic[];
      readonly semanticIdentityProof?: SnapshotRootSemanticIdentityProof;
      readonly mutationGuarantee: SnapshotRootCurrentWorkbookMutationGuarantee;
      readonly freshLifecycleMutationGuarantee: Extract<
        SnapshotRootFreshLifecycleMutationGuarantee,
        'fresh-lifecycle-materialized'
      >;
    }
  | {
      readonly ok: false;
      readonly error: SnapshotRootReloadError;
      readonly diagnostics: readonly SnapshotRootReloadDiagnostic[];
      readonly decodedByteLength?: number;
      readonly mutationGuarantee: SnapshotRootCurrentWorkbookMutationGuarantee;
      readonly freshLifecycleMutationGuarantee: Exclude<
        SnapshotRootFreshLifecycleMutationGuarantee,
        'fresh-lifecycle-materialized'
      >;
    };
