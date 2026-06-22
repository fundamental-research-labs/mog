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
  VersionAppendReviewDecisionInput,
  VersionCreateReviewInput,
  VersionGetReviewDiffInput,
  VersionGetReviewInput,
  VersionListReviewsInput,
  WorkbookVersionReviewDiffPage,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewRecordSummary,
  VersionUpdateReviewStatusInput,
  WorkbookCommitSummary,
  WorkbookVersionStatus,
  VersionSurfaceStatus,
} from './version';
import type { VersionResult } from './version-shared';
import type {
  VersionGetMergeConflictDetailRequest,
  VersionMergeConflictDetailResult,
  VersionPutMergeResolutionPayloadRequest,
  VersionPutMergeResolutionPayloadResult,
  VersionSaveMergeResolutionsRequest,
  VersionSaveMergeResolutionsResult,
} from './version-merge-review';
import type {
  AcceptAgentProposalInput,
  AgentProposal,
  AgentProposalAcceptResult,
  AgentProposalSummary,
  AgentProposalWorkspaceHandle,
  CommitProposalWorkspaceInput,
  CreateAgentProposalInput,
  DisposeProposalWorkspaceInput,
  FailAgentProposalInput,
  GetAgentProposalInput,
  GetProposalWorkspaceInput,
  ListAgentProposalsInput,
  MarkAgentProposalVerifiedInput,
  OpenProposalReviewInput,
  RejectAgentProposalInput,
  StartProposalWorkspaceInput,
  SupersedeAgentProposalInput,
} from './version-proposal';

export interface WorkbookVersion {
  getStatus(): Promise<WorkbookVersionStatus>;
  getSurfaceStatus(): Promise<VersionSurfaceStatus>;
  getHead(): Promise<VersionResult<VersionHead>>;
  getHead(options: GetVersionHeadInput): Promise<VersionResult<VersionHead>>;
  listCommits(options?: ListVersionCommitsInput): Promise<VersionResult<Paged<WorkbookCommitSummary>>>;
  commit(options?: VersionCommitOptions): Promise<VersionResult<WorkbookCommitSummary>>;
  promotePendingRemote(
    options?: VersionPromotePendingRemoteOptions,
  ): Promise<VersionResult<VersionPromotePendingRemoteResult>>;
  checkout(
    target: VersionCheckoutTarget,
    options?: VersionCheckoutOptions,
  ): Promise<VersionResult<CheckoutVersionResult>>;
  merge(input: VersionMergeInput, options?: VersionMergeOptions): Promise<VersionResult<VersionMergeResult>>;
  applyMerge(
    input: VersionApplyMergeInput,
    options?: VersionApplyMergeOptions,
  ): Promise<VersionResult<VersionApplyMergeResult>>;
  saveMergeResolutions(
    input: VersionSaveMergeResolutionsRequest,
  ): Promise<VersionResult<VersionSaveMergeResolutionsResult>>;
  getMergeConflictDetail(
    input: VersionGetMergeConflictDetailRequest,
  ): Promise<VersionResult<VersionMergeConflictDetailResult>>;
  putMergeResolutionPayload(
    input: VersionPutMergeResolutionPayloadRequest,
  ): Promise<VersionResult<VersionPutMergeResolutionPayloadResult>>;
  listReviews(
    input?: VersionListReviewsInput,
  ): Promise<VersionResult<Paged<WorkbookVersionReviewRecordSummary>>>;
  getReview(input: VersionGetReviewInput): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  createReview(input: VersionCreateReviewInput): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  appendReviewDecision(
    input: VersionAppendReviewDecisionInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  updateReviewStatus(
    input: VersionUpdateReviewStatusInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  getReviewDiff(input: VersionGetReviewDiffInput): Promise<VersionResult<WorkbookVersionReviewDiffPage>>;
  createProposal(input: CreateAgentProposalInput): Promise<VersionResult<AgentProposal>>;
  startProposalWorkspace(
    input: StartProposalWorkspaceInput,
  ): Promise<VersionResult<AgentProposalWorkspaceHandle>>;
  getProposalWorkspace(
    input: GetProposalWorkspaceInput,
  ): Promise<VersionResult<AgentProposalWorkspaceHandle>>;
  disposeProposalWorkspace(
    input: DisposeProposalWorkspaceInput,
  ): Promise<VersionResult<{ readonly disposed: true }>>;
  commitProposalWorkspace(
    input: CommitProposalWorkspaceInput,
  ): Promise<VersionResult<AgentProposal>>;
  failProposal(input: FailAgentProposalInput): Promise<VersionResult<AgentProposal>>;
  getProposal(input: GetAgentProposalInput): Promise<VersionResult<AgentProposal>>;
  listProposals(
    input: ListAgentProposalsInput,
  ): Promise<VersionResult<Paged<AgentProposalSummary>>>;
  markProposalVerified(
    input: MarkAgentProposalVerifiedInput,
  ): Promise<VersionResult<AgentProposal>>;
  openProposalReview(
    input: OpenProposalReviewInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  acceptProposal(input: AcceptAgentProposalInput): Promise<VersionResult<AgentProposalAcceptResult>>;
  rejectProposal(input: RejectAgentProposalInput): Promise<VersionResult<AgentProposal>>;
  supersedeProposal(input: SupersedeAgentProposalInput): Promise<VersionResult<AgentProposal>>;
  diff(
    base: VersionCommitish,
    target: VersionCommitish,
    options?: VersionDiffOptions,
  ): Promise<VersionResult<VersionSemanticDiffPage>>;
  readRef(name: 'HEAD'): Promise<VersionResult<VersionSymbolicRefReadResult>>;
  readRef(name: VersionMainRefName | VersionRefName | VersionBranchName): Promise<VersionResult<VersionBranchRefReadResult>>;
  readRef(name: VersionRefSelector | VersionBranchName): Promise<VersionResult<VersionRefReadResult>>;
  getRef(name: 'HEAD'): Promise<VersionResult<VersionSymbolicRefReadResult>>;
  getRef(name: VersionMainRefName | VersionRefName | VersionBranchName): Promise<VersionResult<VersionBranchRefReadResult>>;
  getRef(name: VersionRefSelector | VersionBranchName): Promise<VersionResult<VersionRefReadResult>>;
  listRefs(options?: ListVersionRefsInput): Promise<VersionResult<Paged<VersionRef>>>;
  createBranch(options: VersionCreateBranchOptions): Promise<VersionResult<VersionRef>>;
  fastForwardBranch(options: VersionFastForwardBranchOptions): Promise<VersionResult<VersionRef>>;
  updateBranch(options: VersionUpdateBranchOptions): Promise<VersionResult<VersionRef>>;
  deleteBranch(options: VersionDeleteRefOptions): Promise<VersionResult<VersionRef>>;
  deleteRef(options: VersionDeleteRefOptions): Promise<VersionResult<VersionRef>>;
}
