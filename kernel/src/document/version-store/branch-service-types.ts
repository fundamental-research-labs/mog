import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { WorkbookCommitId } from './object-digest';
import { REF_NAME_STORAGE_PREFIX, type RefName, type RefNamePrefix } from './refs/ref-name';
import type {
  CreateBranchResult as RefStoreCreateBranchResult,
  DeleteRefResult as RefStoreDeleteRefResult,
  GetRefResult as RefStoreGetRefResult,
  ListRefsResult as RefStoreListRefsResult,
  LiveRefRecord,
  RefMutationConflict,
  RefMutationResult as RefStoreMutationResult,
  RefVersion,
  TombstoneRefRecord,
  VersionDiagnostic,
} from './refs/ref-store';

export type BranchRefName = `${typeof REF_NAME_STORAGE_PREFIX}${string}`;

export type BranchServiceErrorCode =
  | 'invalidRefName'
  | 'invalidCommitId'
  | 'invalidRefVersion'
  | 'invalidRefPrefix'
  | 'activeRef'
  | 'reservedNamespace'
  | 'unsupportedDetachedHead'
  | 'unsupportedRefOption'
  | 'missingExpectedHead'
  | 'missingExpectedRefVersion'
  | 'casConflict'
  | 'protectedRef'
  | 'refAlreadyExists'
  | 'refNotFound'
  | 'refTombstoned'
  | 'lastLiveRef'
  | 'unsupportedRefMetadataMutation'
  | 'versionCapabilityDisabled';

export interface BranchServiceError {
  readonly code: BranchServiceErrorCode;
  readonly message: string;
  readonly diagnostics?: readonly VersionDiagnostic[];
}

export interface BranchFailureResult {
  readonly ok: false;
  readonly error: BranchServiceError;
  readonly conflict?: RefMutationConflict;
  readonly diagnostics: readonly VersionDiagnostic[];
}

export interface BranchRecord {
  readonly name: RefName;
  readonly refName: BranchRefName;
  readonly ref: LiveRefRecord;
}

export interface DeletedBranchRecord {
  readonly name: RefName;
  readonly refName: BranchRefName;
  readonly ref: TombstoneRefRecord;
}

export interface CreateBranchInput {
  readonly name: RefName | BranchRefName | string;
  readonly targetCommitId: WorkbookCommitId | string;
  readonly expectedAbsent: true;
  readonly baseCommitId?: WorkbookCommitId | string;
  readonly createdBy: VersionAuthor;
  readonly protected?: boolean;
}

export interface ReadBranchInput {
  readonly name: RefName | BranchRefName | string;
}

export interface ListBranchesInput {
  readonly prefix?: RefNamePrefix | string;
}

export interface FastForwardBranchInput {
  readonly name: RefName | BranchRefName | string;
  readonly nextCommitId: WorkbookCommitId | string;
  readonly expectedOldCommitId?: WorkbookCommitId | string;
  readonly expectedRefVersion?: RefVersion;
  readonly updatedBy: VersionAuthor;
}

export interface DeleteBranchInput {
  readonly name: RefName | BranchRefName | string;
  readonly expectedHead?: WorkbookCommitId | string;
  readonly expectedRefVersion?: RefVersion;
  readonly deletedBy: VersionAuthor;
  readonly deleteReason?: string;
}

export interface CreateDetachedHeadInput {
  readonly commitId: WorkbookCommitId | string;
}

export type CreateBranchResult =
  | {
      readonly ok: true;
      readonly branch: BranchRecord;
      readonly diagnostics: readonly [];
    }
  | BranchFailureResult;

export type ReadBranchResult =
  | {
      readonly ok: true;
      readonly branch: BranchRecord | null;
      readonly diagnostics: readonly [];
    }
  | BranchFailureResult;

export type ListBranchesResult =
  | {
      readonly ok: true;
      readonly branches: readonly BranchRecord[];
      readonly diagnostics: readonly VersionDiagnostic[];
    }
  | BranchFailureResult;

export type FastForwardBranchResult =
  | {
      readonly ok: true;
      readonly branch: BranchRecord;
      readonly diagnostics: readonly [];
    }
  | BranchFailureResult;

export type DeleteBranchResult =
  | {
      readonly ok: true;
      readonly branch: DeletedBranchRecord;
      readonly diagnostics: readonly [];
    }
  | BranchFailureResult;

export type CreateDetachedHeadResult = BranchFailureResult;

export type BranchHead =
  | {
      readonly mode: 'attached';
      readonly refName: BranchRefName;
      readonly branchName: RefName;
      readonly commitId: WorkbookCommitId;
      readonly refVersion: RefVersion;
      readonly refIncarnationId: string;
    }
  | {
      readonly mode: 'detached';
      readonly commitId: WorkbookCommitId;
      readonly materializationId: string;
    };

export type GetBranchHeadResult =
  | {
      readonly ok: true;
      readonly head: BranchHead | null;
      readonly diagnostics: readonly VersionDiagnostic[];
    }
  | BranchFailureResult;

export interface BranchRefStore {
  createBranch(input: {
    readonly name: RefName;
    readonly targetCommitId: WorkbookCommitId;
    readonly expectedAbsent: true;
    readonly baseCommitId?: WorkbookCommitId;
    readonly createdBy: VersionAuthor;
    readonly protected?: boolean;
  }): RefStoreCreateBranchResult;
  getRef(name: RefName): RefStoreGetRefResult;
  listRefs(input?: {
    readonly includeTombstones?: false;
    readonly prefix?: RefNamePrefix | string;
  }):
    | RefStoreListRefsResult
    | {
        readonly ok: true;
        readonly includeTombstones: false;
        readonly refs: readonly LiveRefRecord[];
        readonly diagnostics: readonly VersionDiagnostic[];
      };
  updateRef(input: {
    readonly name: RefName;
    readonly nextCommitId: WorkbookCommitId;
    readonly expectedHead: WorkbookCommitId;
    readonly expectedRefVersion: RefVersion;
    readonly updatedBy: VersionAuthor;
  }): RefStoreMutationResult;
  deleteRef(input: {
    readonly name: RefName;
    readonly expectedHead?: WorkbookCommitId;
    readonly expectedRefVersion: RefVersion;
    readonly deletedBy: VersionAuthor;
    readonly deleteReason?: string;
  }): RefStoreDeleteRefResult;
}

export interface InMemoryBranchServiceOptions {
  readonly refStore?: BranchRefStore;
  readonly headRefName?: RefName | BranchRefName | string | null;
}
