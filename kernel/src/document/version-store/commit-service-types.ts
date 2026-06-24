import type {
  VersionCommitExpectedHead,
  VersionCommitOptions,
  VersionMainRefName,
  VersionMergeChange,
  VersionRefName,
} from '@mog-sdk/contracts/api';

import type {
  VersionGraphCommitContentInput,
  VersionGraphCommitPageResult,
  VersionGraphCommitRef,
  VersionGraphReadHeadResult,
  VersionGraphReadRefResult,
  VersionGraphRef,
  VersionGraphSymbolicRef,
  VersionGraphWriteResult,
} from './graph';
import type { ObjectDigest, WorkbookCommitId } from './object-digest';
import type { VersionGraphNamespace } from './object-store';
import type {
  VersionAccessContext,
  VersionGraphRegistry,
  VersionGraphStore,
  VersionStoreDiagnostic,
  VersionStoreFailure,
  VersionStoreProvider,
} from './provider';
import type { SnapshotRootByteSyncPort } from './snapshot-root-capture';

export type VersionNormalCommitCaptureInput = {
  readonly provider: VersionStoreProvider;
  readonly graph: VersionGraphStore;
  readonly accessContext: VersionAccessContext;
  readonly namespace: VersionGraphNamespace;
  readonly registry: VersionGraphRegistry;
  readonly currentHead: VersionGraphSymbolicRef;
  readonly currentMain: VersionGraphRef;
  readonly currentRef: VersionGraphRef;
  readonly options: VersionCommitOptions;
};

export type VersionMergeCommitCaptureInput = {
  readonly provider: VersionStoreProvider;
  readonly graph: VersionGraphStore;
  readonly accessContext: VersionAccessContext;
  readonly namespace: VersionGraphNamespace;
  readonly registry: VersionGraphRegistry;
  readonly currentRef: VersionGraphRef;
  readonly base: WorkbookCommitId;
  readonly ours: WorkbookCommitId;
  readonly theirs: WorkbookCommitId;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly changes: readonly VersionMergeChange[];
  readonly resolutionCount: number;
  readonly resolvedMergeAttemptDigest?: ObjectDigest;
};

export type VersionNormalCommitCaptureFinalizeResult =
  | {
      readonly status: 'success';
      readonly commitId: WorkbookCommitId;
    }
  | {
      readonly status: 'failed';
      readonly diagnostics?: readonly VersionStoreDiagnostic[];
    };

export type VersionNormalCommitContentInput = Omit<
  VersionGraphCommitContentInput,
  'snapshotRootRecord'
> &
  Partial<Pick<VersionGraphCommitContentInput, 'snapshotRootRecord'>>;

export type VersionNormalCommitCaptureSuccess = {
  readonly status: 'success';
  readonly input: VersionNormalCommitContentInput;
  readonly diagnostics?: readonly VersionStoreDiagnostic[];
  readonly finalize?: (result: VersionNormalCommitCaptureFinalizeResult) => void;
};

export type VersionNormalCommitCaptureResult =
  | VersionNormalCommitCaptureSuccess
  | VersionStoreFailure;

export type VersionMergeCommitCaptureSuccess = {
  readonly status: 'success';
  readonly input: VersionGraphCommitContentInput;
  readonly diagnostics?: readonly VersionStoreDiagnostic[];
  readonly finalize?: (result: VersionNormalCommitCaptureFinalizeResult) => void;
};

export type VersionMergeCommitCaptureResult =
  | VersionMergeCommitCaptureSuccess
  | VersionStoreFailure;

export type VersionNormalCommitMaterializedCaptureSuccess = Omit<
  VersionNormalCommitCaptureSuccess,
  'input'
> & {
  readonly input: VersionGraphCommitContentInput;
};

export type VersionNormalCommitMaterializedCaptureResult =
  | VersionNormalCommitMaterializedCaptureSuccess
  | VersionStoreFailure;

export type VersionNormalCommitCapture = (
  input: VersionNormalCommitCaptureInput,
) => Promise<VersionNormalCommitCaptureResult> | VersionNormalCommitCaptureResult;

export type VersionMergeCommitCapture = (
  input: VersionMergeCommitCaptureInput,
) => Promise<VersionMergeCommitCaptureResult> | VersionMergeCommitCaptureResult;

export type WorkbookVersionCommitServiceMergeCommitInput = {
  readonly base: WorkbookCommitId;
  readonly ours: WorkbookCommitId;
  readonly theirs: WorkbookCommitId;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly changes: readonly VersionMergeChange[];
  readonly resolutionCount: number;
  readonly resolvedMergeAttemptDigest?: ObjectDigest;
};

export type WorkbookVersionCommitServiceFastForwardMergeInput = Omit<
  WorkbookVersionCommitServiceMergeCommitInput,
  'changes' | 'resolutionCount'
>;

export type WorkbookVersionCommitServiceOptions = {
  readonly provider: VersionStoreProvider;
  readonly captureNormalCommit?: VersionNormalCommitCapture;
  readonly captureMergeCommit?: VersionMergeCommitCapture;
  readonly snapshotRootByteSyncPort?: SnapshotRootByteSyncPort;
  readonly ensureInitialized?: () =>
    | readonly VersionStoreDiagnostic[]
    | Promise<readonly VersionStoreDiagnostic[]>;
};

export type WorkbookVersionCommitServiceCommitResult =
  | (Extract<VersionGraphWriteResult, { status: 'success' }> & {
      readonly commitRef: VersionGraphCommitRef;
    })
  | VersionGraphWriteResult
  | VersionStoreFailure;

export type WorkbookVersionCommitServiceReadHeadResult =
  | VersionGraphReadHeadResult
  | {
      readonly status: 'degraded';
      readonly head: null;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export type WorkbookVersionCommitServiceReadRefResult =
  | VersionGraphReadRefResult
  | {
      readonly status: 'degraded';
      readonly ref: null;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export type WorkbookVersionCommitServiceListCommitsResult =
  | VersionGraphCommitPageResult
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export type VersionCommitServiceGraphOperation =
  | 'readHead'
  | 'readRef'
  | 'listCommits'
  | 'commitGraphWrite';

export type VersionCommitServiceOpenVisibleGraphResult =
  | {
      readonly ok: true;
      readonly registry: VersionGraphRegistry;
      readonly namespace: VersionGraphNamespace;
      readonly graph: VersionGraphStore;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
      readonly retryable: boolean;
    };
