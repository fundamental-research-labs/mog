import type { ReadWorkbookCommitResult } from './commit-store';
import type {
  CommitVersionGraphInput,
  FastForwardVersionGraphInput,
  InitializeVersionGraphInput,
  MergeVersionGraphInput,
  VersionGraphClosureReadResult,
  VersionGraphCommitPageResult,
  VersionGraphListCommitsOptions,
  VersionGraphReadHeadResult,
  VersionGraphReadRefResult,
  VersionGraphRefSelector,
  VersionGraphWriteResult,
} from './graph-store';
import type { VersionDependencyRef, WorkbookCommitId } from './object-digest';
import type { VersionGraphNamespace, VersionObjectRecord } from './object-store';

export interface VersionGraphStore {
  readonly namespace: VersionGraphNamespace;
  initializeGraph(input: InitializeVersionGraphInput): Promise<VersionGraphWriteResult>;
  commit(input: CommitVersionGraphInput): Promise<VersionGraphWriteResult>;
  mergeCommit(input: MergeVersionGraphInput): Promise<VersionGraphWriteResult>;
  fastForwardRef(input: FastForwardVersionGraphInput): Promise<VersionGraphWriteResult>;
  readCommit(commitId: WorkbookCommitId | string): Promise<ReadWorkbookCommitResult>;
  getObjectRecord<TPayload>(ref: VersionDependencyRef): Promise<VersionObjectRecord<TPayload>>;
  hasObject(ref: VersionDependencyRef): Promise<boolean>;
  readHead(): Promise<VersionGraphReadHeadResult>;
  readRef(name: VersionGraphRefSelector | string): Promise<VersionGraphReadRefResult>;
  listCommits(options?: VersionGraphListCommitsOptions): Promise<VersionGraphCommitPageResult>;
  readCommitClosure(commitId: WorkbookCommitId | string): Promise<VersionGraphClosureReadResult>;
}
