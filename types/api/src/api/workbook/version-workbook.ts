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
  VersionBranchNameInput,
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
  WorkbookCommitIdInput,
  WorkbookCommitSummary,
  WorkbookVersionStatus,
  VersionSurfaceStatus,
} from './version';
import type {
  VersionBranchSummary,
  VersionCheckoutBranchOptions,
  VersionCheckoutCommitOptions,
  VersionCommitCurrentOptions,
  VersionCreateBranchFromCurrentOptions,
  VersionCurrentCheckout,
  VersionDiffBranchOptions,
  VersionDiffPorcelainTarget,
  VersionListBranchesOptions,
} from './version-porcelain';
import type {
  VersionRevertInput,
  VersionRevertOptions,
  VersionRevertResult,
} from './version-revert';
import type { VersionResult } from './version-shared';
import type {
  VersionGetMergeReviewInput,
  VersionMergeReviewArtifactNamespace,
  VersionMergeReview,
  VersionPreviewMergeInput,
  VersionPreviewMergeOptions,
} from './version-merge-review';
import type { VersionProposalPorcelainApi } from './version-proposal';
import type { WorkbookVersionReviewNamespace } from './version-review';

export interface VersionGraphApi {
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

export interface WorkbookVersion {
  readonly graph: VersionGraphApi;
  readonly reviews: WorkbookVersionReviewNamespace;
  readonly artifacts: VersionMergeReviewArtifactNamespace;
  readonly proposals: VersionProposalPorcelainApi;
  getStatus(): Promise<WorkbookVersionStatus>;
  getSurfaceStatus(): Promise<VersionSurfaceStatus>;
  getCurrent(): Promise<VersionResult<VersionCurrentCheckout>>;
  commitCurrent(
    options?: VersionCommitCurrentOptions,
  ): Promise<VersionResult<WorkbookCommitSummary>>;
  createBranchFromCurrent(
    name: VersionBranchNameInput,
    options?: VersionCreateBranchFromCurrentOptions,
  ): Promise<VersionResult<VersionRef>>;
  checkoutBranch(
    name: VersionBranchNameInput,
    options?: VersionCheckoutBranchOptions,
  ): Promise<VersionResult<CheckoutVersionResult>>;
  checkoutCommit(
    commit: WorkbookCommitIdInput,
    options?: VersionCheckoutCommitOptions,
  ): Promise<VersionResult<CheckoutVersionResult>>;
  listBranches(options?: VersionListBranchesOptions): Promise<VersionResult<Paged<VersionBranchSummary>>>;
  diffCurrent(
    target?: VersionDiffPorcelainTarget,
    options?: VersionDiffOptions,
  ): Promise<VersionResult<VersionSemanticDiffPage>>;
  diffBranch(
    branch: VersionBranchNameInput,
    options?: VersionDiffBranchOptions,
  ): Promise<VersionResult<VersionSemanticDiffPage>>;
  previewMerge(
    input: VersionPreviewMergeInput,
    options?: VersionPreviewMergeOptions,
  ): Promise<VersionResult<VersionMergeReview>>;
  getMergeReview(input: VersionGetMergeReviewInput): Promise<VersionResult<VersionMergeReview>>;
}
