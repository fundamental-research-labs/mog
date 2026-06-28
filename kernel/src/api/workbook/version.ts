import type {
  CheckoutVersionResult,
  Paged,
  VersionAppendReviewDecisionInput,
  VersionApplyMergeInput,
  VersionApplyMergeOptions,
  VersionApplyMergeResult,
  VersionBranchName,
  VersionBranchNameInput,
  VersionBranchSummary,
  VersionBranchRefReadResult,
  VersionCheckoutBranchOptions,
  VersionCheckoutCommitOptions,
  VersionCheckoutOptions,
  VersionCheckoutTarget,
  VersionCommitish,
  VersionCommitCurrentOptions,
  VersionCommitOptions,
  VersionCreateBranchFromCurrentOptions,
  VersionCreateBranchOptions,
  VersionCreateReviewInput,
  VersionCurrentCheckout,
  VersionDeleteRefOptions,
  VersionDiffBranchOptions,
  VersionDiffBranchOverviewOptions,
  VersionDiffGroupDetailOptions,
  VersionDiffOptions,
  VersionDiffOverview,
  VersionDiffOverviewOptions,
  VersionDiffPorcelainTarget,
  VersionFastForwardBranchOptions,
  VersionGetHeadOptions,
  VersionGetMergeConflictDetailRequest,
  VersionGetMergeReviewInput,
  VersionGetReviewDiffInput,
  VersionGetReviewInput,
  VersionHead,
  VersionListCommitsOptions,
  VersionListBranchesOptions,
  VersionListRefsOptions,
  VersionListReviewsInput,
  VersionMainRefName,
  VersionMergeConflictDetailResult,
  VersionMergeReviewArtifactApi,
  VersionMergeReviewArtifactNamespace,
  VersionMergeInput,
  VersionMergeOptions,
  VersionMergeResult,
  VersionMergeReview,
  VersionPreviewMergeInput,
  VersionPreviewMergeOptions,
  VersionProposalPorcelainApi,
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
  VersionWorkingTreeDiffOptions,
  VersionWorkingTreeDiffPage,
  WorkbookCommitSummary,
  WorkbookCommitIdInput,
  WorkbookVersion,
  WorkbookVersionReviewApi,
  WorkbookVersionReviewDiffPage,
  WorkbookVersionReviewNamespace,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewRecordSummary,
  WorkbookVersionStatus,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import type { VersionCheckoutTransactionGuard } from './version-checkout';
import {
  checkoutWorkbookVersionFacade,
  checkoutBranchWorkbookVersionFacade,
  checkoutCommitWorkbookVersionFacade,
  commitCurrentWorkbookVersionFacade,
  commitWorkbookVersionFacade,
  diffBranchOverviewWorkbookVersionFacade,
  diffBranchWorkbookVersionFacade,
  diffCurrentOverviewWorkbookVersionFacade,
  diffCurrentWorkbookVersionFacade,
  diffGroupDetailWorkbookVersionFacade,
  diffOverviewWorkbookVersionFacade,
  diffWorkingTreeWorkbookVersionFacade,
  diffWorkbookVersionFacade,
  getWorkbookVersionFacadeCurrent,
  getWorkbookVersionFacadeHead,
  getWorkbookVersionFacadeStatus,
  getWorkbookVersionFacadeSurfaceStatus,
  listWorkbookVersionFacadeCommits,
} from './version-facade-core';
import {
  applyMergeWorkbookVersionFacade,
  getMergeConflictDetailWorkbookVersionFacade,
  getMergeReviewWorkbookVersionFacade,
  mergeWorkbookVersionFacade,
  previewMergeWorkbookVersionFacade,
  promotePendingRemoteWorkbookVersionFacade,
  putMergeResolutionPayloadWorkbookVersionFacade,
  revertWorkbookVersionFacade,
  saveMergeResolutionsWorkbookVersionFacade,
} from './version-facade-merge';
import {
  createWorkbookVersionProposalPorcelainFacade,
} from './version-facade-proposals';
import {
  createWorkbookVersionFacadeBranch,
  createWorkbookVersionFacadeBranchFromCurrent,
  deleteWorkbookVersionFacadeBranch,
  deleteWorkbookVersionFacadeRef,
  fastForwardWorkbookVersionFacadeBranch,
  getWorkbookVersionFacadeRef,
  listWorkbookVersionFacadeBranches,
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

abstract class WorkbookVersionNamespaceBase {
  constructor(
    private readonly ctxSource: WorkbookVersionContextSource,
    protected readonly options: {
      readonly checkoutTransactionGuard?: VersionCheckoutTransactionGuard;
    } = {},
  ) {}

  protected get ctx(): DocumentContext {
    return typeof this.ctxSource === 'function' ? this.ctxSource() : this.ctxSource;
  }
}

class WorkbookVersionCoreImpl extends WorkbookVersionNamespaceBase {
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

  async promotePendingRemote(
    options: VersionPromotePendingRemoteOptions = {},
  ): Promise<VersionResult<VersionPromotePendingRemoteResult>> {
    return promotePendingRemoteWorkbookVersionFacade(this.ctx, options);
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

  async diff(
    base: VersionCommitish,
    target: VersionCommitish,
    options: VersionDiffOptions = {},
  ): Promise<VersionResult<VersionSemanticDiffPage>> {
    return diffWorkbookVersionFacade(this.ctx, base, target, options);
  }

  async diffOverview(
    base: VersionCommitish,
    target: VersionCommitish,
    options: VersionDiffOverviewOptions = {},
  ): Promise<VersionResult<VersionDiffOverview>> {
    return diffOverviewWorkbookVersionFacade(this.ctx, base, target, options);
  }

  async diffGroupDetail(
    base: VersionCommitish,
    target: VersionCommitish,
    options: VersionDiffGroupDetailOptions,
  ): Promise<VersionResult<VersionSemanticDiffPage>> {
    return diffGroupDetailWorkbookVersionFacade(this.ctx, base, target, options);
  }

  async diffWorkingTree(
    options: VersionWorkingTreeDiffOptions = {},
  ): Promise<VersionResult<VersionWorkingTreeDiffPage>> {
    return diffWorkingTreeWorkbookVersionFacade(this.ctx, options);
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

class WorkbookVersionArtifactAdvancedImpl
  extends WorkbookVersionNamespaceBase
  implements VersionMergeReviewArtifactApi
{
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
}

class WorkbookVersionReviewAdvancedImpl
  extends WorkbookVersionNamespaceBase
  implements WorkbookVersionReviewApi
{
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
}

class WorkbookVersionReviewNamespaceImpl implements WorkbookVersionReviewNamespace {
  constructor(
    private readonly ctxSource: WorkbookVersionContextSource,
    private readonly options: {
      readonly checkoutTransactionGuard?: VersionCheckoutTransactionGuard;
    } = {},
  ) {}

  get advanced(): WorkbookVersionReviewApi {
    return new WorkbookVersionReviewAdvancedImpl(this.ctxSource, this.options);
  }
}

class WorkbookVersionArtifactNamespaceImpl implements VersionMergeReviewArtifactNamespace {
  constructor(
    private readonly ctxSource: WorkbookVersionContextSource,
    private readonly options: {
      readonly checkoutTransactionGuard?: VersionCheckoutTransactionGuard;
    } = {},
  ) {}

  get advanced(): VersionMergeReviewArtifactApi {
    return new WorkbookVersionArtifactAdvancedImpl(this.ctxSource, this.options);
  }
}

export class WorkbookVersionImpl extends WorkbookVersionCoreImpl implements WorkbookVersion {
  constructor(
    ctx: WorkbookVersionContextSource,
    options: {
      readonly checkoutTransactionGuard?: VersionCheckoutTransactionGuard;
    } = {},
  ) {
    super(ctx, options);
  }

  get reviews(): WorkbookVersionReviewNamespace {
    return new WorkbookVersionReviewNamespaceImpl(() => this.ctx, this.options);
  }

  get artifacts(): VersionMergeReviewArtifactNamespace {
    return new WorkbookVersionArtifactNamespaceImpl(() => this.ctx, this.options);
  }

  get proposals(): VersionProposalPorcelainApi {
    return createWorkbookVersionProposalPorcelainFacade(this.ctx);
  }

  async getStatus(): Promise<WorkbookVersionStatus> {
    return getWorkbookVersionFacadeStatus(this.ctx);
  }

  async getSurfaceStatus() {
    return getWorkbookVersionFacadeSurfaceStatus(this.ctx, await this.getStatus());
  }

  async getCurrent(): Promise<VersionResult<VersionCurrentCheckout>> {
    return getWorkbookVersionFacadeCurrent(this.ctx);
  }

  async commitCurrent(
    options: VersionCommitCurrentOptions = {},
  ): Promise<VersionResult<WorkbookCommitSummary>> {
    return commitCurrentWorkbookVersionFacade(this.ctx, options);
  }

  async createBranchFromCurrent(
    name: VersionBranchNameInput,
    options: VersionCreateBranchFromCurrentOptions = {},
  ): Promise<VersionResult<VersionRef>> {
    return createWorkbookVersionFacadeBranchFromCurrent(this.ctx, name, options);
  }

  async checkoutBranch(
    name: VersionBranchNameInput,
    options: VersionCheckoutBranchOptions = {},
  ): Promise<VersionResult<CheckoutVersionResult>> {
    return checkoutBranchWorkbookVersionFacade(
      this.ctx,
      name,
      options,
      this.options.checkoutTransactionGuard,
    );
  }

  async checkoutCommit(
    commit: WorkbookCommitIdInput,
    options: VersionCheckoutCommitOptions = {},
  ): Promise<VersionResult<CheckoutVersionResult>> {
    return checkoutCommitWorkbookVersionFacade(
      this.ctx,
      commit,
      options,
      this.options.checkoutTransactionGuard,
    );
  }

  async previewMerge(
    input: VersionPreviewMergeInput,
    options: VersionPreviewMergeOptions = {},
  ): Promise<VersionResult<VersionMergeReview>> {
    return previewMergeWorkbookVersionFacade(
      this.ctx,
      input,
      options,
      this.options.checkoutTransactionGuard,
    );
  }

  async getMergeReview(
    input: VersionGetMergeReviewInput,
  ): Promise<VersionResult<VersionMergeReview>> {
    return getMergeReviewWorkbookVersionFacade(
      this.ctx,
      input,
      this.options.checkoutTransactionGuard,
    );
  }

  async diffCurrent(
    target: VersionDiffPorcelainTarget = 'main',
    options: VersionDiffOptions = {},
  ): Promise<VersionResult<VersionSemanticDiffPage>> {
    return diffCurrentWorkbookVersionFacade(this.ctx, target, options);
  }

  async diffCurrentOverview(
    target: VersionDiffPorcelainTarget = 'main',
    options: VersionDiffOverviewOptions = {},
  ): Promise<VersionResult<VersionDiffOverview>> {
    return diffCurrentOverviewWorkbookVersionFacade(this.ctx, target, options);
  }

  async diffBranch(
    branch: VersionBranchNameInput,
    options: VersionDiffBranchOptions = {},
  ): Promise<VersionResult<VersionSemanticDiffPage>> {
    return diffBranchWorkbookVersionFacade(this.ctx, branch, options);
  }

  async diffBranchOverview(
    branch: VersionBranchNameInput,
    options: VersionDiffBranchOverviewOptions = {},
  ): Promise<VersionResult<VersionDiffOverview>> {
    return diffBranchOverviewWorkbookVersionFacade(this.ctx, branch, options);
  }

  async listBranches(
    options: VersionListBranchesOptions = {},
  ): Promise<VersionResult<Paged<VersionBranchSummary>>> {
    return listWorkbookVersionFacadeBranches(this.ctx, options);
  }
}
