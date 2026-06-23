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
  Paged,
  VersionBranchName,
  VersionBranchRefReadResult,
  VersionCapability,
  VersionApplyMergeInput,
  VersionApplyMergeOptions,
  VersionApplyMergeResult,
  VersionCheckoutOptions,
  VersionCheckoutTarget,
  VersionCommitish,
  VersionCreateBranchOptions,
  VersionCommitOptions,
  VersionDeleteRefOptions,
  VersionDiffOptions,
  VersionFastForwardBranchOptions,
  VersionGetHeadOptions,
  VersionGetMergeConflictDetailRequest,
  VersionListCommitsOptions,
  VersionListRefsOptions,
  VersionMainRefName,
  VersionMergeInput,
  VersionMergeOptions,
  VersionMergeConflictDetailResult,
  VersionMergeResult,
  VersionPromotePendingRemoteOptions,
  VersionPromotePendingRemoteResult,
  VersionPutMergeResolutionPayloadRequest,
  VersionPutMergeResolutionPayloadResult,
  VersionRevertInput,
  VersionRevertOptions,
  VersionRevertResult,
  VersionRef,
  VersionRefName,
  VersionRefReadResult,
  VersionRefSelector,
  VersionAppendReviewDecisionInput,
  VersionCreateReviewInput,
  VersionGetReviewDiffInput,
  VersionGetReviewInput,
  ListAgentProposalsInput,
  MarkAgentProposalVerifiedInput,
  OpenProposalReviewInput,
  RejectAgentProposalInput,
  StartProposalWorkspaceInput,
  SupersedeAgentProposalInput,
  VersionListReviewsInput,
  WorkbookVersionReviewDiffPage,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewRecordSummary,
  VersionResult,
  VersionSaveMergeResolutionsRequest,
  VersionSaveMergeResolutionsResult,
  VersionSemanticDiffPage,
  VersionStoreDiagnostic,
  VersionSymbolicRefReadResult,
  VersionUpdateBranchOptions,
  VersionUpdateReviewStatusInput,
  VersionHead,
  WorkbookCommitSummary,
  WorkbookVersion,
  WorkbookVersionStatus,
} from '@mog-sdk/contracts/api';
import { VERSION_DIFF_DEFAULT_PAGE_LIMIT } from '@mog-sdk/contracts/versioning';

import type { DocumentContext } from '../../context';
import { applyMergeWorkbookVersion } from './version-apply-merge';
import {
  checkoutWorkbookVersion,
  type VersionCheckoutTransactionGuard,
} from './version-checkout';
import { commitWorkbookVersion } from './version-commit';
import { diffWorkbookVersion } from './version-diff';
import { listWorkbookVersionCommits } from './version-list-commits';
import { mergeWorkbookVersion } from './version-merge';
import {
  getMergeConflictDetailWorkbookVersion,
  putMergeResolutionPayloadWorkbookVersion,
  saveMergeResolutionsWorkbookVersion,
} from './version-merge-review-endpoints';
import {
  promotePendingRemoteWorkbookVersion,
} from './version-pending-remote';
import { revertWorkbookVersion } from './version-revert';
import {
  acceptWorkbookVersionProposal,
  commitWorkbookVersionProposalWorkspace,
  createWorkbookVersionProposal,
  disposeWorkbookVersionProposalWorkspace,
  failWorkbookVersionProposal,
  getWorkbookVersionProposal,
  getWorkbookVersionProposalWorkspace,
  listWorkbookVersionProposals,
  markWorkbookVersionProposalVerified,
  openWorkbookVersionProposalReview,
  rejectWorkbookVersionProposal,
  startWorkbookVersionProposalWorkspace,
  supersedeWorkbookVersionProposal,
} from './version-proposal';
import {
  appendWorkbookVersionReviewDecision,
  createWorkbookVersionReview,
  getWorkbookVersionReview,
  getWorkbookVersionReviewDiff,
  listWorkbookVersionReviews,
  updateWorkbookVersionReviewStatus,
} from './version-review';
import {
  versionResultFromApplyMerge,
  versionResultFromCheckout,
  versionResultFromDiffPage,
  versionFailureFromStoreDiagnostics,
  versionResultFromHead,
  versionResultFromMerge,
  versionResultFromRefList,
  versionResultFromRefMutation,
  versionResultFromRefRead,
} from './version-result';
import { getWorkbookVersionSurfaceStatus } from './version-surface-status';
import { validateVersionOperationGate } from './version-operation-gate';
import {
  VERSION_HEAD_REF,
  VERSION_MAIN_REF,
  degradedHead,
  degradedRef,
  mapHeadResult,
  mapLegacyHeadResult,
  mapRefResult,
  providerErrorDiagnostic,
  serviceUnavailableDiagnostic,
} from './version-public-read-mappers';
import {
  createWorkbookVersionBranch,
  deleteWorkbookVersionBranch,
  deleteWorkbookVersionRef,
  fastForwardWorkbookVersionBranch,
  getWorkbookVersionRef,
  listWorkbookVersionRefs,
  readWorkbookVersionRef,
  updateWorkbookVersionBranch,
} from './version-refs';
import { getAttachedVersionReadService } from './version-service-attachments';
import { getWorkbookVersionStatus } from './version-status';

const VERSION_LIST_REFS_DEFAULT_PAGE_SIZE = 50;

export class WorkbookVersionImpl implements WorkbookVersion {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly options: {
      readonly checkoutTransactionGuard?: VersionCheckoutTransactionGuard;
    } = {},
  ) {}

  async getStatus(): Promise<WorkbookVersionStatus> {
    return getWorkbookVersionStatus(this.ctx);
  }
  async getSurfaceStatus() {
    return getWorkbookVersionSurfaceStatus(this.ctx, await this.getStatus());
  }
  async getHead(): Promise<VersionResult<VersionHead>>;
  async getHead(options: VersionGetHeadOptions): Promise<VersionResult<VersionHead>>;
  async getHead(_options: VersionGetHeadOptions = {}): Promise<VersionResult<VersionHead>> {
    const gateDiagnostics = this.readGate('getHead', 'version:read');
    if (gateDiagnostics) return versionFailureFromStoreDiagnostics('getHead', gateDiagnostics);

    const failHead = (diagnostics: readonly VersionStoreDiagnostic[]) =>
      versionResultFromHead(degradedHead(diagnostics));
    const readService = getAttachedVersionReadService(this.ctx);
    if (!readService) return failHead([serviceUnavailableDiagnostic('getHead')]);

    try {
      if (readService.readHead) {
        return versionResultFromHead(mapHeadResult(await readService.readHead()));
      }
      if (readService.getHead) {
        return versionResultFromHead(mapLegacyHeadResult(await readService.getHead()));
      }
    } catch {
      return failHead([providerErrorDiagnostic('getHead')]);
    }
    return failHead([serviceUnavailableDiagnostic('getHead')]);
  }

  async listCommits(
    options: VersionListCommitsOptions = {},
  ): Promise<VersionResult<Paged<WorkbookCommitSummary>>> {
    const gateDiagnostics = this.readGate('listCommits', 'version:read');
    if (gateDiagnostics) return versionFailureFromStoreDiagnostics('listCommits', gateDiagnostics);
    return listWorkbookVersionCommits(this.ctx, options);
  }
  async commit(options: VersionCommitOptions = {}): Promise<VersionResult<WorkbookCommitSummary>> {
    return commitWorkbookVersion(this.ctx, options);
  }
  async checkout(
    target: VersionCheckoutTarget,
    options: VersionCheckoutOptions = {},
  ): Promise<VersionResult<CheckoutVersionResult>> {
    return versionResultFromCheckout(
      await checkoutWorkbookVersion(
        this.ctx,
        target,
        options,
        this.options.checkoutTransactionGuard,
      ),
    );
  }
  async merge(
    input: VersionMergeInput,
    options: VersionMergeOptions = {},
  ): Promise<VersionResult<VersionMergeResult>> {
    return versionResultFromMerge(await mergeWorkbookVersion(this.ctx, input, options));
  }
  async applyMerge(
    input: VersionApplyMergeInput,
    options: VersionApplyMergeOptions = {},
  ): Promise<VersionResult<VersionApplyMergeResult>> {
    return versionResultFromApplyMerge(await applyMergeWorkbookVersion(this.ctx, input, options));
  }
  async revert(
    input: VersionRevertInput,
    options: VersionRevertOptions = {},
  ): Promise<VersionResult<VersionRevertResult>> {
    return revertWorkbookVersion(this.ctx, input, options);
  }
  async promotePendingRemote(
    options: VersionPromotePendingRemoteOptions = {},
  ): Promise<VersionResult<VersionPromotePendingRemoteResult>> {
    return promotePendingRemoteWorkbookVersion(this.ctx, options);
  }
  async saveMergeResolutions(
    input: VersionSaveMergeResolutionsRequest,
  ): Promise<VersionResult<VersionSaveMergeResolutionsResult>> {
    return saveMergeResolutionsWorkbookVersion(this.ctx, input);
  }
  async getMergeConflictDetail(
    input: VersionGetMergeConflictDetailRequest,
  ): Promise<VersionResult<VersionMergeConflictDetailResult>> {
    return getMergeConflictDetailWorkbookVersion(this.ctx, input);
  }
  async putMergeResolutionPayload(
    input: VersionPutMergeResolutionPayloadRequest,
  ): Promise<VersionResult<VersionPutMergeResolutionPayloadResult>> {
    return putMergeResolutionPayloadWorkbookVersion(this.ctx, input);
  }
  async listReviews(
    input: VersionListReviewsInput = {},
  ): Promise<VersionResult<Paged<WorkbookVersionReviewRecordSummary>>> {
    const gateDiagnostics = this.readGate('listReviews', 'version:reviewRead');
    if (gateDiagnostics) return versionFailureFromStoreDiagnostics('listReviews', gateDiagnostics);
    return listWorkbookVersionReviews(this.ctx, input);
  }
  async getReview(
    input: VersionGetReviewInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    const gateDiagnostics = this.readGate('getReview', 'version:reviewRead');
    if (gateDiagnostics) return versionFailureFromStoreDiagnostics('getReview', gateDiagnostics);
    return getWorkbookVersionReview(this.ctx, input);
  }
  async createReview(
    input: VersionCreateReviewInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    return createWorkbookVersionReview(this.ctx, input);
  }
  async appendReviewDecision(
    input: VersionAppendReviewDecisionInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    return appendWorkbookVersionReviewDecision(this.ctx, input);
  }
  async updateReviewStatus(
    input: VersionUpdateReviewStatusInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    return updateWorkbookVersionReviewStatus(this.ctx, input);
  }
  async getReviewDiff(
    input: VersionGetReviewDiffInput,
  ): Promise<VersionResult<WorkbookVersionReviewDiffPage>> {
    const gateDiagnostics = this.readGate('getReviewDiff', 'version:reviewRead');
    if (gateDiagnostics)
      return versionFailureFromStoreDiagnostics('getReviewDiff', gateDiagnostics);
    return getWorkbookVersionReviewDiff(this.ctx, input);
  }
  async createProposal(input: CreateAgentProposalInput): Promise<VersionResult<AgentProposal>> {
    return createWorkbookVersionProposal(this.ctx, input);
  }
  async startProposalWorkspace(
    input: StartProposalWorkspaceInput,
  ): Promise<VersionResult<AgentProposalWorkspaceHandle>> {
    return startWorkbookVersionProposalWorkspace(this.ctx, input);
  }
  async getProposalWorkspace(
    input: GetProposalWorkspaceInput,
  ): Promise<VersionResult<AgentProposalWorkspaceHandle>> {
    return getWorkbookVersionProposalWorkspace(this.ctx, input);
  }
  async disposeProposalWorkspace(
    input: DisposeProposalWorkspaceInput,
  ): Promise<VersionResult<{ readonly disposed: true }>> {
    return disposeWorkbookVersionProposalWorkspace(this.ctx, input);
  }
  async commitProposalWorkspace(
    input: CommitProposalWorkspaceInput,
  ): Promise<VersionResult<AgentProposal>> {
    return commitWorkbookVersionProposalWorkspace(this.ctx, input);
  }
  async failProposal(input: FailAgentProposalInput): Promise<VersionResult<AgentProposal>> {
    return failWorkbookVersionProposal(this.ctx, input);
  }
  async getProposal(input: GetAgentProposalInput): Promise<VersionResult<AgentProposal>> {
    return getWorkbookVersionProposal(this.ctx, input);
  }
  async listProposals(
    input: ListAgentProposalsInput = {},
  ): Promise<VersionResult<Paged<AgentProposalSummary>>> {
    return listWorkbookVersionProposals(this.ctx, input);
  }
  async markProposalVerified(
    input: MarkAgentProposalVerifiedInput,
  ): Promise<VersionResult<AgentProposal>> {
    return markWorkbookVersionProposalVerified(this.ctx, input);
  }
  async openProposalReview(
    input: OpenProposalReviewInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    return openWorkbookVersionProposalReview(this.ctx, input);
  }
  async acceptProposal(
    input: AcceptAgentProposalInput,
  ): Promise<VersionResult<AgentProposalAcceptResult>> {
    return acceptWorkbookVersionProposal(this.ctx, input);
  }
  async rejectProposal(input: RejectAgentProposalInput): Promise<VersionResult<AgentProposal>> {
    return rejectWorkbookVersionProposal(this.ctx, input);
  }
  async supersedeProposal(
    input: SupersedeAgentProposalInput,
  ): Promise<VersionResult<AgentProposal>> {
    return supersedeWorkbookVersionProposal(this.ctx, input);
  }
  async diff(
    base: VersionCommitish,
    target: VersionCommitish,
    options: VersionDiffOptions = {},
  ): Promise<VersionResult<VersionSemanticDiffPage>> {
    const gateDiagnostics = this.readGate('diff', 'version:diff');
    if (gateDiagnostics) return versionFailureFromStoreDiagnostics('diff', gateDiagnostics);
    return versionResultFromDiffPage(
      await diffWorkbookVersion(this.ctx, base, target, options),
      options.pageSize ?? VERSION_DIFF_DEFAULT_PAGE_LIMIT,
    );
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
    const gateDiagnostics = this.readGate('readRef', 'version:read');
    if (gateDiagnostics) return versionFailureFromStoreDiagnostics('readRef', gateDiagnostics);

    if (name !== VERSION_HEAD_REF && name !== VERSION_MAIN_REF) {
      return versionResultFromRefRead('readRef', await readWorkbookVersionRef(this.ctx, name));
    }

    const publicReadName = name as VersionRefSelector;
    const readService = getAttachedVersionReadService(this.ctx);
    if (!readService?.readRef) {
      return versionResultFromRefRead(
        'readRef',
        degradedRef(null, [serviceUnavailableDiagnostic('readRef', { refName: publicReadName })]),
      );
    }

    try {
      return versionResultFromRefRead(
        'readRef',
        mapRefResult(await readService.readRef(publicReadName), publicReadName),
      );
    } catch {
      return versionResultFromRefRead(
        'readRef',
        degradedRef(null, [providerErrorDiagnostic('readRef', { refName: publicReadName })]),
      );
    }
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
    const gateDiagnostics = this.readGate('getRef', 'version:read');
    if (gateDiagnostics) return versionFailureFromStoreDiagnostics('getRef', gateDiagnostics);
    return versionResultFromRefRead('getRef', await getWorkbookVersionRef(this.ctx, name));
  }

  async listRefs(options: VersionListRefsOptions = {}): Promise<VersionResult<Paged<VersionRef>>> {
    const gateDiagnostics = this.readGate('listRefs', 'version:read');
    if (gateDiagnostics) return versionFailureFromStoreDiagnostics('listRefs', gateDiagnostics);
    return versionResultFromRefList(
      await listWorkbookVersionRefs(this.ctx, options),
      VERSION_LIST_REFS_DEFAULT_PAGE_SIZE,
    );
  }

  async createBranch(options: VersionCreateBranchOptions): Promise<VersionResult<VersionRef>> {
    return versionResultFromRefMutation(
      'createBranch',
      await createWorkbookVersionBranch(this.ctx, options),
    );
  }

  async fastForwardBranch(
    options: VersionFastForwardBranchOptions,
  ): Promise<VersionResult<VersionRef>> {
    return versionResultFromRefMutation(
      'fastForwardBranch',
      await fastForwardWorkbookVersionBranch(this.ctx, options),
    );
  }

  async updateBranch(options: VersionUpdateBranchOptions): Promise<VersionResult<VersionRef>> {
    return versionResultFromRefMutation(
      'updateBranch',
      await updateWorkbookVersionBranch(this.ctx, options),
    );
  }

  async deleteBranch(options: VersionDeleteRefOptions): Promise<VersionResult<VersionRef>> {
    return versionResultFromRefMutation(
      'deleteBranch',
      await deleteWorkbookVersionBranch(this.ctx, options),
    );
  }

  async deleteRef(options: VersionDeleteRefOptions): Promise<VersionResult<VersionRef>> {
    return versionResultFromRefMutation(
      'deleteRef',
      await deleteWorkbookVersionRef(this.ctx, options),
    );
  }

  private readGate(
    operation: string,
    capability: VersionCapability,
  ): readonly VersionStoreDiagnostic[] | null {
    const diagnostics = validateVersionOperationGate(this.ctx, operation, capability, {
      mutates: false,
    });
    return diagnostics.length > 0 ? diagnostics : null;
  }
}
