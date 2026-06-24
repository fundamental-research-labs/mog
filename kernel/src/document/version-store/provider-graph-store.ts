import type { ReadWorkbookCommitResult } from './commit-store';
import type {
  CreateBranchInput,
  CreateBranchResult,
  DeleteBranchInput,
  DeleteBranchResult,
  FastForwardBranchInput,
  FastForwardBranchResult,
  GetBranchHeadResult,
  ListBranchesInput,
  ListBranchesResult,
  ReadBranchInput,
  ReadBranchResult,
} from './branch-service';
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
} from './graph';
import type { VersionDependencyRef, WorkbookCommitId } from './object-digest';
import type {
  VersionGraphNamespace,
  VersionObjectPutBatchResult,
  VersionObjectRecord,
} from './object-store';

export interface VersionGraphStore {
  readonly namespace: VersionGraphNamespace;
  initializeGraph(input: InitializeVersionGraphInput): Promise<VersionGraphWriteResult>;
  commit(input: CommitVersionGraphInput): Promise<VersionGraphWriteResult>;
  mergeCommit(input: MergeVersionGraphInput): Promise<VersionGraphWriteResult>;
  fastForwardRef(input: FastForwardVersionGraphInput): Promise<VersionGraphWriteResult>;
  putObjects(batch: readonly VersionObjectRecord<unknown>[]): Promise<VersionObjectPutBatchResult>;
  readCommit(commitId: WorkbookCommitId | string): Promise<ReadWorkbookCommitResult>;
  getObjectRecord<TPayload>(ref: VersionDependencyRef): Promise<VersionObjectRecord<TPayload>>;
  hasObject(ref: VersionDependencyRef): Promise<boolean>;
  readHead(): Promise<VersionGraphReadHeadResult>;
  readRef(name: VersionGraphRefSelector | string): Promise<VersionGraphReadRefResult>;
  createBranch(input: CreateBranchInput): Promise<CreateBranchResult>;
  readBranch(input: ReadBranchInput | string): Promise<ReadBranchResult>;
  listBranches(input?: ListBranchesInput): Promise<ListBranchesResult>;
  fastForwardBranch(input: FastForwardBranchInput): Promise<FastForwardBranchResult>;
  deleteBranch(input: DeleteBranchInput): Promise<DeleteBranchResult>;
  getHead(): Promise<GetBranchHeadResult>;
  listCommits(options?: VersionGraphListCommitsOptions): Promise<VersionGraphCommitPageResult>;
  readCommitClosure(commitId: WorkbookCommitId | string): Promise<VersionGraphClosureReadResult>;
}
