import type {
  AcceptAgentProposalInput,
  AgentProposal,
  AgentProposalAcceptResult,
  AgentProposalSummary as PublicAgentProposalSummary,
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
  Paged,
  RejectAgentProposalInput,
  StartProposalWorkspaceInput,
  SupersedeAgentProposalInput,
  VersionResult,
  WorkbookCommitId,
  WorkbookVersionReviewRecord,
} from '@mog-sdk/contracts/api';

import { ensureProposalBranchHead } from './proposal-provider-branch-head-validation';
import {
  createProviderBackedProposalBranch,
  ensureProviderBackedProposalBranch,
  ensureProviderBackedProposalCommitExists,
  openProviderBackedProposalStore,
  readOptionalProviderBackedProposalBranch,
  resolveProviderBackedProposalTargetHead,
} from './proposal-provider-service-branch-access';
import {
  invalidState,
  ok,
  sanitizeProposalProviderDiagnostics,
  sanitizeProposalProviderResult,
  sanitizeProposalProviderValue,
  staleRevision,
  storeFailure,
  targetUnavailable,
  workspaceUnavailable,
} from './proposal-provider-service-diagnostics';
import type {
  MaybePromise,
  ProposalBranchService,
  ProposalGraphProvider,
  ProposalProviderOperation,
  ResolvedBranchHead,
} from './proposal-provider-service-types';
import {
  hasAgentProposalMetadataStoreProvider,
  type AgentProposalMetadataStore,
  type AgentProposalMetadataStoreProvider,
  type AgentProposalRecord,
} from './proposal-store';
import {
  isWorkbookCommitId,
  proposalBranchNameFor,
  publicProposal,
  publicProposalSummary,
} from './proposal-provider-service-utils';
import {
  isProposalBranchService,
  isProposalGraphProvider,
  isWorkbookVersionReviewService,
} from './proposal-provider-service-guards';
import {
  validateProposalWorkspaceCommitResult,
  validateProposalWorkspaceHandle,
} from './proposal-provider-workspace-binding';
import {
  disposeProviderBackedProposalWorkspace,
  getProviderBackedProposalWorkspace,
} from './proposal-provider-workspace-access-service';
import {
  acceptProviderBackedAgentProposalWithStaleRecovery,
  isProposalWorkspaceLifecycleService,
  type ProposalWorkspaceLifecycleService,
} from './proposal-workspace-lifecycle-service';
import type { WorkbookVersionReviewService } from './review-service';

export type { ProposalBranchService, ResolvedBranchHead };

export class ProviderBackedAgentProposalService {
  private readonly openStore: () => Promise<AgentProposalMetadataStore>;
  private readonly branchService?: ProposalBranchService;
  private readonly graphProvider?: ProposalGraphProvider;
  private readonly reviewService?: WorkbookVersionReviewService;
  private readonly workspaceService?: ProposalWorkspaceLifecycleService;

  constructor(options: {
    readonly openStore: () => Promise<AgentProposalMetadataStore>;
    readonly branchService?: ProposalBranchService;
    readonly graphProvider?: ProposalGraphProvider;
    readonly reviewService?: WorkbookVersionReviewService;
    readonly workspaceService?: ProposalWorkspaceLifecycleService;
  }) {
    this.openStore = options.openStore;
    this.branchService = options.branchService;
    this.graphProvider = options.graphProvider;
    this.reviewService = options.reviewService;
    this.workspaceService = options.workspaceService;
  }

  get proposalWorkspaceLifecycleAvailable(): boolean {
    return Boolean(this.workspaceService);
  }

  async createProposal(input: CreateAgentProposalInput): Promise<VersionResult<AgentProposal>> {
    const store = await this.openProposalStore('createProposal');
    if (!store.ok) return store.result;

    const target = await this.resolveTargetHead(input.targetRef, 'createProposal');
    if (!target.ok) return target.result;

    const baseCommitId = input.baseCommitId ?? target.head.commitId;
    if (!isWorkbookCommitId(baseCommitId)) {
      return invalidState(
        'invalid_proposal_base_commit',
        ['valid_baseCommitId', 'omitted_baseCommitId'],
        'Proposal baseCommitId must be a public workbook commit id.',
      );
    }
    if (baseCommitId !== target.head.commitId) {
      return invalidState(
        'proposal_base_mismatch',
        ['current_target_head'],
        'Proposal baseCommitId must match the current target ref head.',
      );
    }

    const proposalBranchName = await proposalBranchNameFor(input);
    if (!proposalBranchName.ok) return proposalBranchName.result;

    const existingBranch = await this.readOptionalProposalBranch(
      proposalBranchName.branchName,
      baseCommitId,
      'createProposal',
    );
    if (!existingBranch.ok) return existingBranch.result;

    if (!existingBranch.exists) {
      const branchCreated = await this.createProposalBranch(
        proposalBranchName.branchName,
        baseCommitId,
        'createProposal',
      );
      if (!branchCreated.ok) return branchCreated.result;
    }

    const created = await store.value.createProposal({
      clientRequestId: input.clientRequestId,
      title: input.title,
      targetRef: target.head.refName,
      baseCommitId,
      targetHeadIdAtCreation: target.head.commitId,
      proposalBranchName: proposalBranchName.branchName,
      redactionPolicy: input.redactionPolicy,
      trustedIdentity: {
        actor: input.agent,
        agent: input.agent,
        agentRunId: input.agentRunId,
      },
    });
    if (!created.ok) return storeFailure(created);

    return ok(publicProposal(created.value));
  }

  async startProposalWorkspace(
    input: StartProposalWorkspaceInput,
  ): Promise<VersionResult<AgentProposalWorkspaceHandle>> {
    const store = await this.openProposalStore('startProposalWorkspace');
    if (!store.ok) return store.result;
    const proposal = await store.value.getProposal(input.proposalId);
    if (!proposal.ok) return storeFailure(proposal);
    if (proposal.value.revision !== input.expectedRevision) {
      return staleRevision(input.expectedRevision, proposal.value.revision);
    }
    if (proposal.value.status !== 'draft') {
      return invalidState(
        'proposal_workspace_not_draft',
        ['draft'],
        'Only draft proposals can open a proposal workspace.',
      );
    }

    const branchReady = await this.ensureProposalBranch(proposal.value, 'startProposalWorkspace');
    if (!branchReady.ok) return sanitizeProposalProviderResult(branchReady.result);

    if (!this.workspaceService) return workspaceUnavailable('startProposalWorkspace');
    const started = await this.callWorkspaceService('startProposalWorkspace', () =>
      this.workspaceService!.startProposalWorkspace({
        ...input,
        proposal: publicProposal(proposal.value),
        proposalRecord: proposal.value,
      }),
    );
    if (!started.ok) return started;
    const workspaceBinding = validateProposalWorkspaceHandle({
      proposal: proposal.value,
      handle: started.value,
    });
    if (!workspaceBinding.ok) return sanitizeProposalProviderResult(workspaceBinding.result);

    const updated = await store.value.updateProposal({
      clientRequestId: input.clientRequestId,
      proposalId: input.proposalId,
      expectedRevision: input.expectedRevision,
      status: 'workspace_open',
      trustedActor: input.actor,
      workspaceId: started.value.workspaceId,
    });
    if (!updated.ok) return storeFailure(updated);
    return started;
  }

  async getProposalWorkspace(
    input: GetProposalWorkspaceInput,
  ): Promise<VersionResult<AgentProposalWorkspaceHandle>> {
    return sanitizeProposalProviderResult(
      await getProviderBackedProposalWorkspace({
        input,
        openStore: this.openStore,
        ...(this.workspaceService ? { workspaceService: this.workspaceService } : {}),
      }),
    );
  }

  async disposeProposalWorkspace(
    input: DisposeProposalWorkspaceInput,
  ): Promise<VersionResult<{ readonly disposed: true }>> {
    return sanitizeProposalProviderResult(
      await disposeProviderBackedProposalWorkspace({
        input,
        openStore: this.openStore,
        ...(this.workspaceService ? { workspaceService: this.workspaceService } : {}),
      }),
    );
  }

  async commitProposalWorkspace(
    input: CommitProposalWorkspaceInput,
  ): Promise<VersionResult<AgentProposal>> {
    const store = await this.openProposalStore('commitProposalWorkspace');
    if (!store.ok) return store.result;
    const proposal = await store.value.getProposal(input.proposalId);
    if (!proposal.ok) return storeFailure(proposal);
    if (proposal.value.revision !== input.expectedRevision) {
      return staleRevision(input.expectedRevision, proposal.value.revision);
    }
    if (proposal.value.status !== 'workspace_open') {
      return invalidState(
        'proposal_workspace_not_open',
        ['workspace_open'],
        'Only workspace-open proposals can be committed.',
      );
    }
    if (proposal.value.workspaceId !== input.workspaceId) {
      return invalidState(
        'proposal_workspace_mismatch',
        ['matching_workspace_id'],
        'Proposal workspace commits must use the workspace opened for the proposal.',
      );
    }

    if (!this.workspaceService) return workspaceUnavailable('commitProposalWorkspace');
    const committed = await this.callWorkspaceService('commitProposalWorkspace', () =>
      this.workspaceService!.commitProposalWorkspace({
        ...input,
        proposal: publicProposal(proposal.value),
        proposalRecord: proposal.value,
      }),
    );
    if (!committed.ok) return committed;
    const workspaceBinding = validateProposalWorkspaceCommitResult({
      workspaceId: input.workspaceId,
      result: committed.value,
    });
    if (!workspaceBinding.ok) return sanitizeProposalProviderResult(workspaceBinding.result);
    if (!isWorkbookCommitId(committed.value.proposalCommitId)) {
      return invalidState(
        'invalid_proposal_commit',
        ['valid_proposalCommitId'],
        'Proposal workspace commits must return a public workbook commit id.',
      );
    }
    const commitExists = await this.ensureCommitExists(
      committed.value.proposalCommitId,
      'commitProposalWorkspace',
    );
    if (!commitExists.ok) return sanitizeProposalProviderResult(commitExists.result);
    const branchHead = await ensureProposalBranchHead({
      branchService: this.branchService,
      operation: 'commitProposalWorkspace',
      proposalBranchName: proposal.value.proposalBranchName,
      expectedHeadCommitId: committed.value.proposalCommitId,
    });
    if (!branchHead.ok) return sanitizeProposalProviderResult(branchHead.result);

    return proposalStoreUpdateResult(
      await store.value.updateProposal({
        clientRequestId: input.clientRequestId,
        proposalId: input.proposalId,
        expectedRevision: input.expectedRevision,
        status: 'committed',
        trustedActor: input.actor,
        proposalCommitId: committed.value.proposalCommitId,
        ...(input.verification === undefined
          ? {}
          : { verification: sanitizeProposalProviderValue(input.verification) }),
        ...(committed.value.diagnostics === undefined
          ? {}
          : { diagnostics: sanitizeProposalProviderDiagnostics(committed.value.diagnostics) }),
      }),
    );
  }

  async failProposal(input: FailAgentProposalInput): Promise<VersionResult<AgentProposal>> {
    const store = await this.openProposalStore('failProposal');
    if (!store.ok) return store.result;
    return proposalStoreUpdateResult(
      await store.value.updateProposal({
        clientRequestId: input.clientRequestId,
        proposalId: input.proposalId,
        expectedRevision: input.expectedRevision,
        status: 'failed',
        trustedActor: input.actor,
        diagnostics: sanitizeProposalProviderDiagnostics(input.diagnostics),
      }),
    );
  }

  async getProposal(input: GetAgentProposalInput): Promise<VersionResult<AgentProposal>> {
    const store = await this.openProposalStore('getProposal');
    if (!store.ok) return store.result;
    return proposalStoreResult(await store.value.getProposal(input.proposalId));
  }

  async listProposals(
    input: ListAgentProposalsInput = {},
  ): Promise<VersionResult<Paged<PublicAgentProposalSummary>>> {
    const store = await this.openProposalStore('listProposals');
    if (!store.ok) return store.result;
    const listed = await store.value.listProposals(input);
    if (!listed.ok) return storeFailure(listed);
    return {
      ok: true,
      value: {
        items: listed.value.items.map(publicProposalSummary),
        ...(listed.value.nextCursor ? { nextCursor: listed.value.nextCursor } : {}),
        limit: listed.value.limit,
        ...(listed.value.totalEstimate === undefined
          ? {}
          : { totalEstimate: listed.value.totalEstimate }),
      },
    };
  }

  async markProposalVerified(
    input: MarkAgentProposalVerifiedInput,
  ): Promise<VersionResult<AgentProposal>> {
    const store = await this.openProposalStore('markProposalVerified');
    if (!store.ok) return store.result;
    return proposalStoreUpdateResult(
      await store.value.updateProposal({
        clientRequestId: input.clientRequestId,
        proposalId: input.proposalId,
        expectedRevision: input.expectedRevision,
        status: 'verified',
        trustedActor: input.actor,
        verification: sanitizeProposalProviderValue(input.verification),
      }),
    );
  }

  async openProposalReview(
    input: OpenProposalReviewInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    if (!this.reviewService) {
      return targetUnavailable(
        'openProposalReview',
        'VERSION_REVIEW_SERVICE_UNAVAILABLE',
        'Provider-backed proposal review creation requires an attached review service.',
      );
    }

    const store = await this.openProposalStore('openProposalReview');
    if (!store.ok) return store.result;

    const proposalResult = await store.value.getProposal(input.proposalId);
    if (!proposalResult.ok) return storeFailure(proposalResult);
    const proposal = proposalResult.value;

    if (proposal.status === 'ready_for_review' && proposal.reviewId) {
      if (proposal.revision !== input.expectedRevision) {
        return staleRevision(input.expectedRevision, proposal.revision);
      }
      return sanitizeProposalProviderResult(
        await this.reviewService.getReview({ reviewId: proposal.reviewId }),
      );
    }

    if (proposal.status !== 'verified') {
      return invalidState(
        'proposal_not_verified',
        ['verified'],
        'Only verified proposals can be opened for review.',
      );
    }
    if (proposal.revision !== input.expectedRevision) {
      return {
        ok: false,
        error: {
          code: 'stale_revision',
          expectedRevision: input.expectedRevision,
          actualRevision: proposal.revision,
        },
      };
    }
    if (!proposal.proposalCommitId) {
      return invalidState(
        'proposal_commit_required',
        ['committed_proposal'],
        'Proposal review requires a proposal commit id.',
      );
    }
    const commitExists = await this.ensureCommitExists(
      proposal.proposalCommitId,
      'openProposalReview',
    );
    if (!commitExists.ok) return sanitizeProposalProviderResult(commitExists.result);

    const review = await this.reviewService.createReview({
      clientRequestId: input.clientRequestId,
      subject: {
        kind: 'proposal',
        proposalId: proposal.id,
        baseCommitId: proposal.baseCommitId,
        headCommitId: proposal.proposalCommitId,
      },
      title: proposal.title,
      createdBy: input.actor,
      baseCommitId: proposal.baseCommitId,
      headCommitId: proposal.proposalCommitId,
      redactionPolicy: proposal.redaction.policy,
    });
    if (!review.ok) return sanitizeProposalProviderResult(review);

    const updated = await store.value.updateProposal({
      clientRequestId: input.clientRequestId,
      proposalId: input.proposalId,
      expectedRevision: input.expectedRevision,
      status: 'ready_for_review',
      trustedActor: input.actor,
      reviewId: review.value.id,
    });
    if (!updated.ok) return storeFailure(updated);

    return review;
  }

  async acceptProposal(
    input: AcceptAgentProposalInput,
  ): Promise<VersionResult<AgentProposalAcceptResult>> {
    return sanitizeProposalProviderResult(
      await acceptProviderBackedAgentProposalWithStaleRecovery({
        input,
        openStore: this.openStore,
        ...(this.graphProvider ? { graphProvider: this.graphProvider } : {}),
        ensureCommitExists: (commitId) => this.ensureCommitExists(commitId, 'acceptProposal'),
        resolveTargetHead: (targetRef) => this.resolveTargetHead(targetRef, 'acceptProposal'),
        ...(this.reviewService
          ? { getReview: (reviewId) => this.reviewService!.getReview({ reviewId }) }
          : {}),
        ...(this.reviewService?.markReviewApplied
          ? {
              markReviewApplied: (reviewInput) =>
                this.reviewService!.markReviewApplied!(reviewInput),
            }
          : {}),
      }),
    );
  }

  async rejectProposal(input: RejectAgentProposalInput): Promise<VersionResult<AgentProposal>> {
    const store = await this.openProposalStore('rejectProposal');
    if (!store.ok) return store.result;
    return proposalStoreUpdateResult(
      await store.value.updateProposal({
        clientRequestId: input.clientRequestId,
        proposalId: input.proposalId,
        expectedRevision: input.expectedRevision,
        status: 'rejected',
        trustedActor: input.actor,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      }),
    );
  }

  async supersedeProposal(
    input: SupersedeAgentProposalInput,
  ): Promise<VersionResult<AgentProposal>> {
    const store = await this.openProposalStore('supersedeProposal');
    if (!store.ok) return store.result;
    return proposalStoreUpdateResult(
      await store.value.updateProposal({
        clientRequestId: input.clientRequestId,
        proposalId: input.proposalId,
        expectedRevision: input.expectedRevision,
        status: 'superseded',
        trustedActor: input.actor,
        ...(input.supersededByProposalId === undefined
          ? {}
          : { supersededByProposalId: input.supersededByProposalId }),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      }),
    );
  }

  private async openProposalStore(
    operation: ProposalProviderOperation,
  ): Promise<
    | { readonly ok: true; readonly value: AgentProposalMetadataStore }
    | { readonly ok: false; readonly result: VersionResult<never> }
  > {
    return openProviderBackedProposalStore({ openStore: this.openStore, operation });
  }

  private async resolveTargetHead(
    targetRef: string,
    operation: ProposalProviderOperation,
  ): Promise<
    | { readonly ok: true; readonly head: ResolvedBranchHead }
    | { readonly ok: false; readonly result: VersionResult<never> }
  > {
    return resolveProviderBackedProposalTargetHead({
      branchService: this.branchService,
      targetRef,
      operation,
    });
  }

  private async readOptionalProposalBranch(
    proposalBranchName: string,
    baseCommitId: WorkbookCommitId,
    operation: ProposalProviderOperation,
  ): Promise<
    | { readonly ok: true; readonly exists: boolean }
    | { readonly ok: false; readonly result: VersionResult<never> }
  > {
    return readOptionalProviderBackedProposalBranch({
      branchService: this.branchService,
      proposalBranchName,
      baseCommitId,
      operation,
    });
  }

  private async createProposalBranch(
    proposalBranchName: string,
    baseCommitId: WorkbookCommitId,
    operation: ProposalProviderOperation,
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly result: VersionResult<never> }
  > {
    return createProviderBackedProposalBranch({
      branchService: this.branchService,
      proposalBranchName,
      baseCommitId,
      operation,
    });
  }

  private async ensureProposalBranch(
    proposal: AgentProposalRecord,
    operation: ProposalProviderOperation,
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly result: VersionResult<never> }
  > {
    return ensureProviderBackedProposalBranch({
      branchService: this.branchService,
      proposal,
      operation,
    });
  }

  private async ensureCommitExists(
    commitId: WorkbookCommitId,
    operation: ProposalProviderOperation,
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly result: VersionResult<never> }
  > {
    return ensureProviderBackedProposalCommitExists({
      graphProvider: this.graphProvider,
      commitId,
      operation,
    });
  }

  private async callWorkspaceService<T>(
    operation: ProposalProviderOperation,
    call: () => MaybePromise<VersionResult<T>>,
  ): Promise<VersionResult<T>> {
    try {
      return sanitizeProposalProviderResult(await call());
    } catch {
      return targetUnavailable(
        operation,
        'VERSION_PROPOSAL_WORKSPACE_ERROR',
        'The attached proposal workspace service failed before returning a public result.',
      );
    }
  }
}

export function createProviderBackedAgentProposalService(options: {
  readonly provider: AgentProposalMetadataStoreProvider;
  readonly branchService?: unknown;
  readonly graphProvider?: unknown;
  readonly reviewService?: unknown;
  readonly workspaceService?: unknown;
}): ProviderBackedAgentProposalService {
  return new ProviderBackedAgentProposalService({
    openStore: () => options.provider.openAgentProposalMetadataStore(),
    ...(isProposalBranchService(options.branchService)
      ? { branchService: options.branchService }
      : {}),
    ...(isProposalGraphProvider(options.graphProvider)
      ? { graphProvider: options.graphProvider }
      : {}),
    ...(isWorkbookVersionReviewService(options.reviewService)
      ? { reviewService: options.reviewService }
      : {}),
    ...(isProposalWorkspaceLifecycleService(options.workspaceService)
      ? { workspaceService: options.workspaceService }
      : {}),
  });
}

export { hasAgentProposalMetadataStoreProvider };

function proposalStoreResult(
  result: VersionResult<AgentProposalRecord>,
): VersionResult<AgentProposal> {
  return result.ok ? ok(publicProposal(result.value)) : storeFailure(result);
}

function proposalStoreUpdateResult(
  result: VersionResult<AgentProposalRecord>,
): VersionResult<AgentProposal> {
  return proposalStoreResult(result);
}
