import type {
  AcceptAgentProposalInput,
  AgentProposal,
  AgentProposalAcceptResult,
  AgentProposalSummary,
  AgentProposalWorkspaceHandle,
  CheckoutVersionResult,
  CommitProposalWorkspaceInput,
  CreateAgentProposalInput,
  DisposeProposalWorkspaceInput,
  FailAgentProposalInput,
  GetAgentProposalInput,
  GetProposalWorkspaceInput,
  ListAgentProposalsInput,
  MarkAgentProposalVerifiedInput,
  OpenProposalReviewInput,
  Paged,
  RejectAgentProposalInput,
  StartProposalWorkspaceInput,
  SupersedeAgentProposalInput,
  VersionAppendReviewDecisionInput,
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
  VersionCreateReviewInput,
  VersionDeleteRefOptions,
  VersionDiffOptions,
  VersionFastForwardBranchOptions,
  VersionGetHeadOptions,
  VersionGetMergeConflictDetailRequest,
  VersionGetReviewDiffInput,
  VersionGetReviewInput,
  VersionHead,
  VersionListCommitsOptions,
  VersionListRefsOptions,
  VersionListReviewsInput,
  VersionMainRefName,
  VersionMergeConflictDetailResult,
  VersionMergeInput,
  VersionMergeOptions,
  VersionMergeResult,
  VersionPromotePendingRemoteOptions,
  VersionPromotePendingRemoteResult,
  VersionPutMergeResolutionPayloadRequest,
  VersionPutMergeResolutionPayloadResult,
  VersionRef,
  VersionRefName,
  VersionRefReadResult,
  VersionRefSelector,
  VersionResult,
  VersionRevertInput,
  VersionRevertOptions,
  VersionRevertResult,
  VersionSaveMergeResolutionsRequest,
  VersionSaveMergeResolutionsResult,
  VersionSemanticDiffPage,
  VersionSymbolicRefReadResult,
  VersionUpdateBranchOptions,
  VersionUpdateReviewStatusInput,
  WorkbookCommitSummary,
  WorkbookVersion,
  WorkbookVersionReviewDiffPage,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewRecordSummary,
  WorkbookVersionStatus,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import type { VersionCheckoutTransactionGuard } from './version-checkout';
import {
  checkoutWorkbookVersionFacade,
  commitWorkbookVersionFacade,
  diffWorkbookVersionFacade,
  getWorkbookVersionFacadeHead,
  getWorkbookVersionFacadeStatus,
  getWorkbookVersionFacadeSurfaceStatus,
  listWorkbookVersionFacadeCommits,
} from './version-facade-core';
import {
  applyMergeWorkbookVersionFacade,
  getMergeConflictDetailWorkbookVersionFacade,
  mergeWorkbookVersionFacade,
  promotePendingRemoteWorkbookVersionFacade,
  putMergeResolutionPayloadWorkbookVersionFacade,
  revertWorkbookVersionFacade,
  saveMergeResolutionsWorkbookVersionFacade,
} from './version-facade-merge';
import {
  acceptWorkbookVersionProposalFacade,
  commitWorkbookVersionProposalWorkspaceFacade,
  createWorkbookVersionProposalFacade,
  disposeWorkbookVersionProposalWorkspaceFacade,
  failWorkbookVersionProposalFacade,
  getWorkbookVersionProposalFacade,
  getWorkbookVersionProposalWorkspaceFacade,
  listWorkbookVersionProposalsFacade,
  markWorkbookVersionProposalVerifiedFacade,
  openWorkbookVersionProposalReviewFacade,
  rejectWorkbookVersionProposalFacade,
  startWorkbookVersionProposalWorkspaceFacade,
  supersedeWorkbookVersionProposalFacade,
} from './version-facade-proposals';
import {
  createWorkbookVersionFacadeBranch,
  deleteWorkbookVersionFacadeBranch,
  deleteWorkbookVersionFacadeRef,
  fastForwardWorkbookVersionFacadeBranch,
  getWorkbookVersionFacadeRef,
  listWorkbookVersionFacadeRefs,
  readWorkbookVersionFacadeRef,
  updateWorkbookVersionFacadeBranch,
} from './version-facade-refs';
import {
  appendWorkbookVersionFacadeReviewDecision,
  createWorkbookVersionFacadeReview,
  getWorkbookVersionFacadeReview,
  getWorkbookVersionFacadeReviewDiff,
  listWorkbookVersionFacadeReviews,
  updateWorkbookVersionFacadeReviewStatus,
} from './version-facade-reviews';

type WorkbookVersionContextSource = DocumentContext | (() => DocumentContext);

export class WorkbookVersionImpl implements WorkbookVersion {
  private readonly ctxSource: WorkbookVersionContextSource;

  constructor(
    ctx: WorkbookVersionContextSource,
    private readonly options: {
      readonly checkoutTransactionGuard?: VersionCheckoutTransactionGuard;
    } = {},
  ) {
    this.ctxSource = ctx;
  }

  private get ctx(): DocumentContext {
    return typeof this.ctxSource === 'function' ? this.ctxSource() : this.ctxSource;
  }

  async getStatus(): Promise<WorkbookVersionStatus> {
    return getWorkbookVersionFacadeStatus(this.ctx);
  }

  async getSurfaceStatus() {
    return getWorkbookVersionFacadeSurfaceStatus(this.ctx, await this.getStatus());
  }

  async getHead(): Promise<VersionResult<VersionHead>>;
  async getHead(options: VersionGetHeadOptions): Promise<VersionResult<VersionHead>>;
  async getHead(options: VersionGetHeadOptions = {}): Promise<VersionResult<VersionHead>> {
    return getWorkbookVersionFacadeHead(this.ctx, options);
  }

  async listCommits(
    options: VersionListCommitsOptions = {},
  ): Promise<VersionResult<Paged<WorkbookCommitSummary>>> {
    return listWorkbookVersionFacadeCommits(this.ctx, options);
  }

  async commit(options: VersionCommitOptions = {}): Promise<VersionResult<WorkbookCommitSummary>> {
    return commitWorkbookVersionFacade(this.ctx, options);
  }

  async checkout(
    target: VersionCheckoutTarget,
    options: VersionCheckoutOptions = {},
  ): Promise<VersionResult<CheckoutVersionResult>> {
    return checkoutWorkbookVersionFacade(
      this.ctx,
      target,
      options,
      this.options.checkoutTransactionGuard,
    );
  }

  async merge(
    input: VersionMergeInput,
    options: VersionMergeOptions = {},
  ): Promise<VersionResult<VersionMergeResult>> {
    return mergeWorkbookVersionFacade(this.ctx, input, options);
  }

  async applyMerge(
    input: VersionApplyMergeInput,
    options: VersionApplyMergeOptions = {},
  ): Promise<VersionResult<VersionApplyMergeResult>> {
    return applyMergeWorkbookVersionFacade(
      this.ctx,
      input,
      options,
      this.options.checkoutTransactionGuard,
    );
  }

  async revert(
    input: VersionRevertInput,
    options: VersionRevertOptions = {},
  ): Promise<VersionResult<VersionRevertResult>> {
    return revertWorkbookVersionFacade(this.ctx, input, options);
  }

  async promotePendingRemote(
    options: VersionPromotePendingRemoteOptions = {},
  ): Promise<VersionResult<VersionPromotePendingRemoteResult>> {
    return promotePendingRemoteWorkbookVersionFacade(this.ctx, options);
  }

  async saveMergeResolutions(
    input: VersionSaveMergeResolutionsRequest,
  ): Promise<VersionResult<VersionSaveMergeResolutionsResult>> {
    return saveMergeResolutionsWorkbookVersionFacade(this.ctx, input);
  }

  async getMergeConflictDetail(
    input: VersionGetMergeConflictDetailRequest,
  ): Promise<VersionResult<VersionMergeConflictDetailResult>> {
    return getMergeConflictDetailWorkbookVersionFacade(this.ctx, input);
  }

  async putMergeResolutionPayload(
    input: VersionPutMergeResolutionPayloadRequest,
  ): Promise<VersionResult<VersionPutMergeResolutionPayloadResult>> {
    return putMergeResolutionPayloadWorkbookVersionFacade(this.ctx, input);
  }

  async listReviews(
    input: VersionListReviewsInput = {},
  ): Promise<VersionResult<Paged<WorkbookVersionReviewRecordSummary>>> {
    return listWorkbookVersionFacadeReviews(this.ctx, input);
  }

  async getReview(
    input: VersionGetReviewInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    return getWorkbookVersionFacadeReview(this.ctx, input);
  }

  async createReview(
    input: VersionCreateReviewInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    return createWorkbookVersionFacadeReview(this.ctx, input);
  }

  async appendReviewDecision(
    input: VersionAppendReviewDecisionInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    return appendWorkbookVersionFacadeReviewDecision(this.ctx, input);
  }

  async updateReviewStatus(
    input: VersionUpdateReviewStatusInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    return updateWorkbookVersionFacadeReviewStatus(this.ctx, input);
  }

  async getReviewDiff(
    input: VersionGetReviewDiffInput,
  ): Promise<VersionResult<WorkbookVersionReviewDiffPage>> {
    return getWorkbookVersionFacadeReviewDiff(this.ctx, input);
  }

  async createProposal(input: CreateAgentProposalInput): Promise<VersionResult<AgentProposal>> {
    return createWorkbookVersionProposalFacade(this.ctx, input);
  }

  async startProposalWorkspace(
    input: StartProposalWorkspaceInput,
  ): Promise<VersionResult<AgentProposalWorkspaceHandle>> {
    return startWorkbookVersionProposalWorkspaceFacade(this.ctx, input);
  }

  async getProposalWorkspace(
    input: GetProposalWorkspaceInput,
  ): Promise<VersionResult<AgentProposalWorkspaceHandle>> {
    return getWorkbookVersionProposalWorkspaceFacade(this.ctx, input);
  }

  async disposeProposalWorkspace(
    input: DisposeProposalWorkspaceInput,
  ): Promise<VersionResult<{ readonly disposed: true }>> {
    return disposeWorkbookVersionProposalWorkspaceFacade(this.ctx, input);
  }

  async commitProposalWorkspace(
    input: CommitProposalWorkspaceInput,
  ): Promise<VersionResult<AgentProposal>> {
    return commitWorkbookVersionProposalWorkspaceFacade(this.ctx, input);
  }

  async failProposal(input: FailAgentProposalInput): Promise<VersionResult<AgentProposal>> {
    return failWorkbookVersionProposalFacade(this.ctx, input);
  }

  async getProposal(input: GetAgentProposalInput): Promise<VersionResult<AgentProposal>> {
    return getWorkbookVersionProposalFacade(this.ctx, input);
  }

  async listProposals(
    input: ListAgentProposalsInput = {},
  ): Promise<VersionResult<Paged<AgentProposalSummary>>> {
    return listWorkbookVersionProposalsFacade(this.ctx, input);
  }

  async markProposalVerified(
    input: MarkAgentProposalVerifiedInput,
  ): Promise<VersionResult<AgentProposal>> {
    return markWorkbookVersionProposalVerifiedFacade(this.ctx, input);
  }

  async openProposalReview(
    input: OpenProposalReviewInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    return openWorkbookVersionProposalReviewFacade(this.ctx, input);
  }

  async acceptProposal(
    input: AcceptAgentProposalInput,
  ): Promise<VersionResult<AgentProposalAcceptResult>> {
    return acceptWorkbookVersionProposalFacade(this.ctx, input);
  }

  async rejectProposal(input: RejectAgentProposalInput): Promise<VersionResult<AgentProposal>> {
    return rejectWorkbookVersionProposalFacade(this.ctx, input);
  }

  async supersedeProposal(
    input: SupersedeAgentProposalInput,
  ): Promise<VersionResult<AgentProposal>> {
    return supersedeWorkbookVersionProposalFacade(this.ctx, input);
  }

  async diff(
    base: VersionCommitish,
    target: VersionCommitish,
    options: VersionDiffOptions = {},
  ): Promise<VersionResult<VersionSemanticDiffPage>> {
    return diffWorkbookVersionFacade(this.ctx, base, target, options);
  }

  async readRef(name: 'HEAD'): Promise<VersionResult<VersionSymbolicRefReadResult>>;
  async readRef(
    name: VersionMainRefName | VersionRefName | VersionBranchName,
  ): Promise<VersionResult<VersionBranchRefReadResult>>;
  async readRef(
    name: VersionRefSelector | VersionBranchName,
  ): Promise<VersionResult<VersionRefReadResult>>;
  async readRef(
    name: VersionRefSelector | VersionBranchName,
  ): Promise<VersionResult<VersionRefReadResult>> {
    return readWorkbookVersionFacadeRef(this.ctx, name);
  }

  async getRef(name: 'HEAD'): Promise<VersionResult<VersionSymbolicRefReadResult>>;
  async getRef(
    name: VersionMainRefName | VersionRefName | VersionBranchName,
  ): Promise<VersionResult<VersionBranchRefReadResult>>;
  async getRef(
    name: VersionRefSelector | VersionBranchName,
  ): Promise<VersionResult<VersionRefReadResult>>;
  async getRef(
    name: VersionRefSelector | VersionBranchName,
  ): Promise<VersionResult<VersionRefReadResult>> {
    return getWorkbookVersionFacadeRef(this.ctx, name);
  }

  async listRefs(options: VersionListRefsOptions = {}): Promise<VersionResult<Paged<VersionRef>>> {
    return listWorkbookVersionFacadeRefs(this.ctx, options);
  }

  async createBranch(options: VersionCreateBranchOptions): Promise<VersionResult<VersionRef>> {
    return createWorkbookVersionFacadeBranch(this.ctx, options);
  }

  async fastForwardBranch(
    options: VersionFastForwardBranchOptions,
  ): Promise<VersionResult<VersionRef>> {
    return fastForwardWorkbookVersionFacadeBranch(this.ctx, options);
  }

  async updateBranch(options: VersionUpdateBranchOptions): Promise<VersionResult<VersionRef>> {
    return updateWorkbookVersionFacadeBranch(this.ctx, options);
  }

  async deleteBranch(options: VersionDeleteRefOptions): Promise<VersionResult<VersionRef>> {
    return deleteWorkbookVersionFacadeBranch(this.ctx, options);
  }

  async deleteRef(options: VersionDeleteRefOptions): Promise<VersionResult<VersionRef>> {
    return deleteWorkbookVersionFacadeRef(this.ctx, options);
  }
}
