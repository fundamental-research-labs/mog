import type { VersionAuthor } from '@mog-sdk/contracts/versioning';
import type { WorkbookCommitAnnotationSummary } from '@mog-sdk/contracts/api';

import type {
  CreateWorkbookCommitInput,
  InMemoryWorkbookCommitStore,
  WorkbookCommit,
  WorkbookCommitStoreDiagnostic,
} from '../commit-store';
import type { ObjectDigest, VersionDependencyRef, WorkbookCommitId } from '../object-digest';
import type {
  InMemoryVersionObjectStore,
  VersionGraphNamespace,
  VersionObjectStoreDiagnostic,
} from '../object-store';
import type {
  InMemoryRefStore,
  ProviderEpoch,
  RefVersion,
  VersionDiagnostic,
} from '../refs/ref-store';
import type { VersionGraphStoreOperation } from './graph-store-operation';
import type {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  VersionGraphBranchRefName,
} from './graph-store-refs';

export type VersionGraphCommitContentInput = Omit<
  CreateWorkbookCommitInput,
  'documentId' | 'parentCommitIds'
>;
export type InitializeVersionGraphInput = VersionGraphCommitContentInput;
export type CommitVersionGraphInput = VersionGraphCommitContentInput & {
  readonly targetRef?: VersionGraphBranchRefName | string;
  readonly expectedHeadCommitId: WorkbookCommitId | string;
  readonly expectedMainRefVersion?: RefVersion;
  readonly expectedTargetRefVersion?: RefVersion;
  readonly parentCommitIds?: readonly (WorkbookCommitId | string)[];
};
export type MergeVersionGraphInput = VersionGraphCommitContentInput & {
  readonly targetRef?: VersionGraphBranchRefName | string;
  readonly expectedHeadCommitId: WorkbookCommitId | string;
  readonly expectedMainRefVersion?: RefVersion;
  readonly expectedTargetRefVersion?: RefVersion;
  readonly mergeParentCommitId: WorkbookCommitId | string;
};

export type FastForwardVersionGraphInput = {
  readonly targetRef?: VersionGraphBranchRefName | string;
  readonly expectedHeadCommitId: WorkbookCommitId | string;
  readonly expectedMainRefVersion?: RefVersion;
  readonly expectedTargetRefVersion?: RefVersion;
  readonly nextCommitId: WorkbookCommitId | string;
  readonly updatedBy: VersionAuthor;
};

export type VersionGraphRef = {
  readonly name: VersionGraphBranchRefName;
  readonly commitId: WorkbookCommitId;
  readonly revision: RefVersion;
  readonly updatedAt: string;
  readonly providerRefId?: string;
  readonly providerEpoch?: ProviderEpoch;
  readonly refIncarnationId?: string;
  readonly protected?: boolean;
};

export type VersionGraphSymbolicRef = {
  readonly name: typeof VERSION_GRAPH_HEAD_REF;
  readonly target: typeof VERSION_GRAPH_MAIN_REF;
  readonly revision: RefVersion;
};

export type VersionGraphRefSelector = typeof VERSION_GRAPH_HEAD_REF | VersionGraphBranchRefName;

export type VersionGraphCommitRef = {
  readonly id: WorkbookCommitId;
  readonly refName: VersionGraphBranchRefName;
  readonly resolvedFrom: VersionGraphRefSelector;
  readonly refRevision: RefVersion;
};

export type VersionGraphCommitSummary = {
  readonly id: WorkbookCommitId;
  readonly parents: readonly WorkbookCommitId[];
  readonly createdAt: string;
  readonly author: WorkbookCommit['payload']['author'];
  readonly annotation?: WorkbookCommitAnnotationSummary;
};

export type VersionGraphReadHeadResult =
  | {
      readonly status: 'success';
      readonly head: VersionGraphCommitRef;
      readonly main: VersionGraphRef;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'degraded';
      readonly head: null;
      readonly main?: VersionGraphRef;
      readonly diagnostics: readonly VersionGraphStoreDiagnostic[];
    };

export type VersionGraphReadRefResult =
  | {
      readonly status: 'success';
      readonly ref: VersionGraphRef | VersionGraphSymbolicRef;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'degraded';
      readonly ref: VersionGraphRef | VersionGraphSymbolicRef | null;
      readonly diagnostics: readonly VersionGraphStoreDiagnostic[];
    };

export type VersionGraphListCommitsOptions = {
  readonly ref?: VersionGraphRefSelector | string;
  readonly from?: WorkbookCommitId | string;
  readonly pageSize?: number;
  readonly pageToken?: string;
};

export type VersionGraphCommitPageResult =
  | {
      readonly status: 'success';
      readonly commits: readonly VersionGraphCommitSummary[];
      readonly nextPageToken?: string;
      readonly readRevision: RefVersion;
      readonly order: 'topological-newest';
      readonly pageSize: number;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly VersionGraphStoreDiagnostic[];
    };

export type VersionGraphStoreDiagnosticCode =
  | 'VERSION_WRONG_NAMESPACE'
  | 'VERSION_MISSING_PARENT'
  | 'VERSION_MISSING_OBJECT'
  | 'VERSION_REF_CONFLICT'
  | 'VERSION_DANGLING_REF'
  | 'VERSION_UNSUPPORTED_PARENT_COMMIT'
  | 'VERSION_UNSUPPORTED_PAGE_TOKEN'
  | 'VERSION_INVALID_OPTIONS'
  | 'VERSION_STALE_PAGE_CURSOR'
  | 'VERSION_OBJECT_STORE_FAILURE'
  | 'VERSION_GRAPH_CONFLICT'
  | 'VERSION_GRAPH_UNINITIALIZED'
  | 'VERSION_INVALID_COMMIT_ID'
  | 'VERSION_INVALID_COMMIT_PAYLOAD'
  | 'VERSION_WRONG_DOCUMENT'
  | 'VERSION_MISSING_DEPENDENCY';

export type VersionGraphStoreDiagnostic = {
  readonly code: VersionGraphStoreDiagnosticCode;
  readonly severity: 'error' | 'corruption';
  readonly message: string;
  readonly refName?: string;
  readonly commitId?: WorkbookCommitId;
  readonly objectDigest?: ObjectDigest;
  readonly dependency?: VersionDependencyRef;
  readonly objectKind?: 'commit';
  readonly operation?: VersionGraphStoreOperation;
  readonly option?: 'pageSize' | 'pageToken' | 'ref' | 'from';
  readonly namespace?: VersionGraphNamespace;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
  readonly sourceDiagnostics?: readonly (
    | WorkbookCommitStoreDiagnostic
    | VersionDiagnostic
    | VersionObjectStoreDiagnostic
  )[];
};

export type VersionGraphWriteSuccess = {
  readonly status: 'success';
  readonly commit: WorkbookCommit;
  readonly ref: VersionGraphRef;
  readonly main: VersionGraphRef;
  readonly diagnostics: readonly [];
};

export type VersionGraphWriteFailure = {
  readonly status: 'failed';
  readonly diagnostics: readonly VersionGraphStoreDiagnostic[];
  readonly mutationGuarantee: 'no-write-attempted' | 'ref-not-mutated';
};

export type VersionGraphWriteResult = VersionGraphWriteSuccess | VersionGraphWriteFailure;

export type VersionGraphClosureReadResult =
  | {
      readonly status: 'success';
      readonly commits: readonly WorkbookCommit[];
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly VersionGraphStoreDiagnostic[];
    };

export type InMemoryVersionGraphStoreOptions = {
  readonly namespace: VersionGraphNamespace;
  readonly objectStore?: InMemoryVersionObjectStore;
  readonly commitStore?: InMemoryWorkbookCommitStore;
  readonly refStore?: InMemoryRefStore;
};
