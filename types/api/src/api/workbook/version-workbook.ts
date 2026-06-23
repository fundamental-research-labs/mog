import type {
  CheckoutVersionResult,
  GetVersionHeadInput,
  ListVersionCommitsInput,
  ListVersionRefsInput,
  Paged,
  VersionApplyMergeInput,
  VersionApplyMergeOptions,
  VersionApplyMergeResult,
  VersionBranchName,
  VersionBranchRefReadResult,
  VersionCheckoutOptions,
  VersionCheckoutTarget,
  VersionCommitish,
  VersionCommitOptions,
  VersionCreateBranchOptions,
  VersionDeleteRefOptions,
  VersionDiffOptions,
  VersionFastForwardBranchOptions,
  VersionHead,
  VersionMainRefName,
  VersionMergeInput,
  VersionMergeOptions,
  VersionMergeResult,
  VersionPromotePendingRemoteOptions,
  VersionPromotePendingRemoteResult,
  VersionRef,
  VersionRefName,
  VersionRefReadResult,
  VersionRefSelector,
  VersionSemanticDiffPage,
  VersionSymbolicRefReadResult,
  VersionUpdateBranchOptions,
  WorkbookCommitSummary,
  WorkbookVersionStatus,
  VersionSurfaceStatus,
} from './version';
import type {
  VersionRevertInput,
  VersionRevertOptions,
  VersionRevertResult,
} from './version-revert';
import type { VersionResult } from './version-shared';
import type {
  VersionGetMergeConflictDetailRequest,
  VersionMergeConflictDetailResult,
  VersionPutMergeResolutionPayloadRequest,
  VersionPutMergeResolutionPayloadResult,
  VersionSaveMergeResolutionsRequest,
  VersionSaveMergeResolutionsResult,
} from './version-merge-review';
import type { VersionProposalApi } from './version-proposal';
import type { WorkbookVersionReviewApi } from './version-review';

export interface WorkbookVersion extends WorkbookVersionReviewApi, VersionProposalApi {
  getStatus(): Promise<WorkbookVersionStatus>;
  getSurfaceStatus(): Promise<VersionSurfaceStatus>;
  getHead(): Promise<VersionResult<VersionHead>>;
  getHead(options: GetVersionHeadInput): Promise<VersionResult<VersionHead>>;
  listCommits(
    options?: ListVersionCommitsInput,
  ): Promise<VersionResult<Paged<WorkbookCommitSummary>>>;
  commit(options?: VersionCommitOptions): Promise<VersionResult<WorkbookCommitSummary>>;
  promotePendingRemote(
    options?: VersionPromotePendingRemoteOptions,
  ): Promise<VersionResult<VersionPromotePendingRemoteResult>>;
  checkout(
    target: VersionCheckoutTarget,
    options?: VersionCheckoutOptions,
  ): Promise<VersionResult<CheckoutVersionResult>>;
  merge(
    input: VersionMergeInput,
    options?: VersionMergeOptions,
  ): Promise<VersionResult<VersionMergeResult>>;
  applyMerge(
    input: VersionApplyMergeInput,
    options?: VersionApplyMergeOptions,
  ): Promise<VersionResult<VersionApplyMergeResult>>;
  revert(
    input: VersionRevertInput,
    options?: VersionRevertOptions,
  ): Promise<VersionResult<VersionRevertResult>>;
  saveMergeResolutions(
    input: VersionSaveMergeResolutionsRequest,
  ): Promise<VersionResult<VersionSaveMergeResolutionsResult>>;
  getMergeConflictDetail(
    input: VersionGetMergeConflictDetailRequest,
  ): Promise<VersionResult<VersionMergeConflictDetailResult>>;
  putMergeResolutionPayload(
    input: VersionPutMergeResolutionPayloadRequest,
  ): Promise<VersionResult<VersionPutMergeResolutionPayloadResult>>;
  diff(
    base: VersionCommitish,
    target: VersionCommitish,
    options?: VersionDiffOptions,
  ): Promise<VersionResult<VersionSemanticDiffPage>>;
  readRef(name: 'HEAD'): Promise<VersionResult<VersionSymbolicRefReadResult>>;
  readRef(
    name: VersionMainRefName | VersionRefName | VersionBranchName,
  ): Promise<VersionResult<VersionBranchRefReadResult>>;
  readRef(
    name: VersionRefSelector | VersionBranchName,
  ): Promise<VersionResult<VersionRefReadResult>>;
  getRef(name: 'HEAD'): Promise<VersionResult<VersionSymbolicRefReadResult>>;
  getRef(
    name: VersionMainRefName | VersionRefName | VersionBranchName,
  ): Promise<VersionResult<VersionBranchRefReadResult>>;
  getRef(
    name: VersionRefSelector | VersionBranchName,
  ): Promise<VersionResult<VersionRefReadResult>>;
  listRefs(options?: ListVersionRefsInput): Promise<VersionResult<Paged<VersionRef>>>;
  createBranch(options: VersionCreateBranchOptions): Promise<VersionResult<VersionRef>>;
  fastForwardBranch(options: VersionFastForwardBranchOptions): Promise<VersionResult<VersionRef>>;
  updateBranch(options: VersionUpdateBranchOptions): Promise<VersionResult<VersionRef>>;
  deleteBranch(options: VersionDeleteRefOptions): Promise<VersionResult<VersionRef>>;
  deleteRef(options: VersionDeleteRefOptions): Promise<VersionResult<VersionRef>>;
}
