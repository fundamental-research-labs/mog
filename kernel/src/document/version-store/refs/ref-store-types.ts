import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { ObjectDigest, WorkbookCommitId } from '../object-digest';
import type { RefName, RefNamePrefix } from './ref-name';
import type { InMemoryRefStoreSnapshot } from './ref-store-snapshot';

export type ProviderEpoch =
  | { readonly kind: 'counter'; readonly value: string }
  | { readonly kind: 'opaque'; readonly value: string };

export type RefVersion = { readonly kind: 'counter'; readonly value: string };

export type VersionDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface VersionDiagnostic {
  readonly code: string;
  readonly severity: VersionDiagnosticSeverity;
  readonly message: string;
  readonly refName?: string;
  readonly commitId?: WorkbookCommitId;
  readonly refVersion?: RefVersion;
  readonly refIncarnationId?: string;
  readonly previousRefIncarnationId?: string;
  readonly tombstoneRefVersion?: RefVersion;
  readonly operationId?: string;
  readonly objectDigest?: ObjectDigest;
  readonly details?: Record<string, string | boolean>;
}

export type VersionErrorCode =
  | 'invalidRefName'
  | 'invalidRefPrefix'
  | 'invalidCommitId'
  | 'invalidRefVersion'
  | 'unsupportedRefOption'
  | 'protectedRef'
  | 'refAlreadyExists'
  | 'refNotFound'
  | 'refTombstoned'
  | 'expectedHeadMismatch'
  | 'expectedRefVersionMismatch'
  | 'expectedPreviousRefIncarnationIdMismatch'
  | 'unsupportedRefMetadataMutation'
  | 'lastLiveRef'
  | 'versionCapabilityDisabled';

export interface VersionApiError {
  readonly code: VersionErrorCode;
  readonly message: string;
  readonly diagnostics?: readonly VersionDiagnostic[];
}

export interface RefMutationConflict {
  readonly code:
    | 'expectedHeadMismatch'
    | 'expectedRefVersionMismatch'
    | 'expectedPreviousRefIncarnationIdMismatch'
    | 'refAlreadyExists'
    | 'refTombstoned';
  readonly expectedHead?: WorkbookCommitId;
  readonly actualHead?: WorkbookCommitId;
  readonly expectedRefVersion?: RefVersion;
  readonly actualRefVersion?: RefVersion;
  readonly actualRefIncarnationId?: string;
  readonly expectedPreviousRefIncarnationId?: string;
  readonly actualPreviousRefIncarnationId?: string;
  readonly tombstoneRefVersion?: RefVersion;
  readonly previousRefIncarnationId?: string;
}

export interface RefFailureResult {
  readonly ok: false;
  readonly error: VersionApiError;
  readonly conflict?: RefMutationConflict;
  readonly diagnostics: readonly VersionDiagnostic[];
}

export interface LiveRefRecord {
  readonly state: 'live';
  readonly schemaVersion: 1;
  readonly versionDocumentId: string;
  readonly name: RefName;
  readonly kind: 'branch';
  readonly targetCommitId: WorkbookCommitId;
  readonly baseCommitId?: WorkbookCommitId;
  readonly providerRefId: string;
  readonly providerEpoch: ProviderEpoch;
  readonly refIncarnationId: string;
  readonly protected: boolean;
  readonly createdAt: string;
  readonly createdBy: VersionAuthor;
  readonly updatedAt: string;
  readonly updatedBy: VersionAuthor;
  readonly refVersion: RefVersion;
}

export interface TombstoneRefRecord {
  readonly state: 'tombstone';
  readonly schemaVersion: 1;
  readonly versionDocumentId: string;
  readonly name: RefName;
  readonly previousTargetCommitId: WorkbookCommitId;
  readonly previousProviderRefId: string;
  readonly previousProviderEpoch: ProviderEpoch;
  readonly previousRefIncarnationId: string;
  readonly deletedAt: string;
  readonly deletedBy: VersionAuthor;
  readonly deleteReason?: string;
  readonly deleteDiagnostics?: readonly VersionDiagnostic[];
  readonly refVersion: RefVersion;
}

export type RefRecord = LiveRefRecord | TombstoneRefRecord;

export interface InitializeMainInput {
  readonly targetCommitId: WorkbookCommitId | string;
  readonly createdBy: VersionAuthor;
  readonly baseCommitId?: WorkbookCommitId | string;
  readonly protected?: boolean;
}

export interface CreateBranchInput {
  readonly name: RefName | string;
  readonly targetCommitId: WorkbookCommitId | string;
  readonly expectedAbsent: true;
  readonly baseCommitId?: WorkbookCommitId | string;
  readonly createdBy: VersionAuthor;
  readonly protected?: boolean;
  readonly reuseTombstone?: TombstoneRefReuseMetadata;
}

export interface TombstoneRefReuseMetadata {
  readonly expectedTombstoneRefVersion: RefVersion;
  readonly expectedPreviousRefIncarnationId: string;
}

export interface UpdateRefInput {
  readonly name: RefName | string;
  readonly nextCommitId: WorkbookCommitId | string;
  readonly expectedRefVersion: RefVersion;
  readonly expectedHead?: WorkbookCommitId | string;
  readonly updatedBy: VersionAuthor;
}

export interface DeleteRefInput {
  readonly name: RefName | string;
  readonly expectedRefVersion: RefVersion;
  readonly expectedHead?: WorkbookCommitId | string;
  readonly deletedBy: VersionAuthor;
  readonly deleteReason?: string;
  readonly deleteDiagnostics?: readonly VersionDiagnostic[];
}

export interface ListRefsInput {
  readonly includeTombstones?: boolean;
  readonly prefix?: RefNamePrefix | string;
}

export interface GetRefOptions {
  readonly includeTombstone?: false;
}

export interface GetRefWithTombstoneOptions {
  readonly includeTombstone: true;
}

export type GetRefResult =
  | { readonly ok: true; readonly ref: LiveRefRecord | null; readonly diagnostics: readonly [] }
  | RefFailureResult;

export type GetRefWithTombstoneResult =
  | {
      readonly ok: true;
      readonly includeTombstone: true;
      readonly ref: RefRecord | null;
      readonly diagnostics: readonly [];
    }
  | RefFailureResult;

export type ListRefsResult =
  | {
      readonly ok: true;
      readonly includeTombstones: false;
      readonly refs: readonly LiveRefRecord[];
      readonly diagnostics: readonly [];
    }
  | {
      readonly ok: true;
      readonly includeTombstones: true;
      readonly refs: readonly RefRecord[];
      readonly diagnostics: readonly [];
    }
  | {
      readonly ok: false;
      readonly error: VersionApiError;
      readonly diagnostics: readonly VersionDiagnostic[];
    };

export type RefMutationResult =
  | { readonly ok: true; readonly ref: LiveRefRecord; readonly diagnostics: readonly [] }
  | RefFailureResult;

export type CreateBranchResult =
  | {
      readonly ok: true;
      readonly ref: LiveRefRecord;
      readonly attached: false;
      readonly diagnostics: readonly [];
    }
  | RefFailureResult;

export type DeleteRefResult =
  | { readonly ok: true; readonly ref: TombstoneRefRecord; readonly diagnostics: readonly [] }
  | RefFailureResult;

export interface InMemoryRefStoreOptions {
  readonly versionDocumentId: string;
  readonly now?: () => Date | string;
  readonly snapshot?: InMemoryRefStoreSnapshot;
}
