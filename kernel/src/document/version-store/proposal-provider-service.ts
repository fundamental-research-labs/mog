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
  VersionDiagnostic,
  VersionMainRefName,
  VersionRefName,
  VersionResult,
  WorkbookCommitId,
  WorkbookVersionReviewRecord,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor as GraphVersionAuthor } from '@mog-sdk/contracts/versioning';

import type { CreateBranchResult, ReadBranchResult } from './branch-service';
import {
  hasAgentProposalMetadataStoreProvider,
  type AgentProposalMetadataStore,
  type AgentProposalMetadataStoreProvider,
  type AgentProposalRecord,
} from './proposal-store';
import { VersionStoreProviderError, type VersionStoreProvider } from './provider';
import {
  branchCommitId,
  isWorkbookCommitId,
  parsePublicBranchName,
  proposalBranchNameFor,
  publicProposal,
  publicProposalSummary,
} from './proposal-provider-service-utils';
import { acceptProviderBackedAgentProposal } from './proposal-provider-accept-service';
import type { ProposalWorkspaceLifecycleService } from './proposal-workspace-lifecycle-service';
import { namespaceForRegistry } from './registry';
import type { WorkbookVersionReviewService } from './review-service';
import type { RefVersion } from './ref-store';

type MaybePromise<T> = T | Promise<T>;

type ProposalProviderOperation =
  | 'acceptProposal'
  | 'commitProposalWorkspace'
  | 'createProposal'
  | 'disposeProposalWorkspace'
  | 'failProposal'
  | 'getProposal'
  | 'getProposalWorkspace'
  | 'listProposals'
  | 'markProposalVerified'
  | 'openProposalReview'
  | 'rejectProposal'
  | 'startProposalWorkspace'
  | 'supersedeProposal';

export type ProposalBranchService = {
  readBranch(
    input: { readonly name: string } | string,
  ): Promise<ReadBranchResult> | ReadBranchResult;
  createBranch(input: {
    readonly name: string;
    readonly targetCommitId: WorkbookCommitId | string;
    readonly expectedAbsent: true;
    readonly baseCommitId?: WorkbookCommitId | string;
    readonly createdBy: GraphVersionAuthor;
    readonly protected?: boolean;
  }): Promise<CreateBranchResult> | CreateBranchResult;
};

type ProposalGraphProvider = Pick<
  VersionStoreProvider,
  'accessContext' | 'openGraph' | 'readGraphRegistry'
>;

export type ResolvedBranchHead = {
  readonly branchName: string;
  readonly refName: VersionMainRefName | VersionRefName;
  readonly commitId: WorkbookCommitId;
  readonly refVersion: RefVersion;
};

const PROPOSAL_BRANCH_AUTHOR: GraphVersionAuthor = Object.freeze({
  authorId: 'version-proposal-service',
  actorKind: 'system',
  displayName: 'Version Proposal Service',
});

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
    if (!branchReady.ok) return branchReady.result;

    if (!this.workspaceService) return workspaceUnavailable('startProposalWorkspace');
    const started = await this.callWorkspaceService('startProposalWorkspace', () =>
      this.workspaceService!.startProposalWorkspace({
        ...input,
        proposal: publicProposal(proposal.value),
        proposalRecord: proposal.value,
      }),
    );
    if (!started.ok) return started;

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
    if (!this.workspaceService) return workspaceUnavailable('getProposalWorkspace');
    return this.callWorkspaceService('getProposalWorkspace', () =>
      this.workspaceService!.getProposalWorkspace(input),
    );
  }

  async disposeProposalWorkspace(
    input: DisposeProposalWorkspaceInput,
  ): Promise<VersionResult<{ readonly disposed: true }>> {
    if (!this.workspaceService) return workspaceUnavailable('disposeProposalWorkspace');
    return this.callWorkspaceService('disposeProposalWorkspace', () =>
      this.workspaceService!.disposeProposalWorkspace(input),
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

    if (!this.workspaceService) return workspaceUnavailable('commitProposalWorkspace');
    const committed = await this.callWorkspaceService('commitProposalWorkspace', () =>
      this.workspaceService!.commitProposalWorkspace({
        ...input,
        proposal: publicProposal(proposal.value),
        proposalRecord: proposal.value,
      }),
    );
    if (!committed.ok) return committed;
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
    if (!commitExists.ok) return commitExists.result;

    return proposalStoreUpdateResult(
      await store.value.updateProposal({
        clientRequestId: input.clientRequestId,
        proposalId: input.proposalId,
        expectedRevision: input.expectedRevision,
        status: 'committed',
        trustedActor: input.actor,
        proposalCommitId: committed.value.proposalCommitId,
        ...(input.verification === undefined ? {} : { verification: input.verification }),
        ...(committed.value.diagnostics === undefined
          ? {}
          : { diagnostics: committed.value.diagnostics }),
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
        diagnostics: input.diagnostics,
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
        verification: input.verification,
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
      return this.reviewService.getReview({ reviewId: proposal.reviewId });
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
    if (!commitExists.ok) return commitExists.result;

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
    if (!review.ok) return review;

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
    return acceptProviderBackedAgentProposal({
      input,
      openStore: this.openStore,
      ...(this.graphProvider ? { graphProvider: this.graphProvider } : {}),
      ensureCommitExists: (commitId) => this.ensureCommitExists(commitId, 'acceptProposal'),
      resolveTargetHead: (targetRef) => this.resolveTargetHead(targetRef, 'acceptProposal'),
    });
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
    try {
      return { ok: true, value: await this.openStore() };
    } catch {
      return {
        ok: false,
        result: targetUnavailable(
          operation,
          'VERSION_PROVIDER_ERROR',
          'Version proposal metadata store could not be opened.',
        ),
      };
    }
  }

  private async resolveTargetHead(
    targetRef: string,
    operation: ProposalProviderOperation,
  ): Promise<
    | { readonly ok: true; readonly head: ResolvedBranchHead }
    | { readonly ok: false; readonly result: VersionResult<never> }
  > {
    const branchName = parsePublicBranchName(targetRef);
    if (!branchName.ok) return { ok: false, result: branchName.result };
    if (!this.branchService?.readBranch) {
      return {
        ok: false,
        result: targetUnavailable(
          operation,
          'VERSION_REF_WRITE_UNAVAILABLE',
          'Provider-backed proposal creation requires an attached branch/ref service.',
        ),
      };
    }

    let read: ReadBranchResult;
    try {
      read = await this.branchService.readBranch({ name: branchName.branchName });
    } catch {
      return {
        ok: false,
        result: targetUnavailable(
          operation,
          'VERSION_PROVIDER_ERROR',
          'Version branch service failed while resolving the proposal target ref.',
        ),
      };
    }

    if (!read.ok) {
      return { ok: false, result: branchFailure(operation, read.diagnostics) };
    }
    if (!read.branch) {
      return {
        ok: false,
        result: targetUnavailable(
          operation,
          'VERSION_DANGLING_REF',
          'Proposal target ref does not resolve to a live branch.',
        ),
      };
    }

    const commitId = branchCommitId(read.branch);
    if (!commitId) {
      return {
        ok: false,
        result: targetUnavailable(
          operation,
          'VERSION_INVALID_COMMIT_PAYLOAD',
          'Proposal target ref did not expose a public commit id.',
        ),
      };
    }

    return {
      ok: true,
      head: {
        branchName: branchName.branchName,
        refName: branchName.refName,
        commitId,
        refVersion: read.branch.ref.refVersion,
      },
    };
  }

  private async readOptionalProposalBranch(
    proposalBranchName: string,
    baseCommitId: WorkbookCommitId,
    operation: ProposalProviderOperation,
  ): Promise<
    | { readonly ok: true; readonly exists: boolean }
    | { readonly ok: false; readonly result: VersionResult<never> }
  > {
    if (!this.branchService?.readBranch) {
      return {
        ok: false,
        result: targetUnavailable(
          operation,
          'VERSION_REF_WRITE_UNAVAILABLE',
          'Provider-backed proposal creation requires an attached branch/ref service.',
        ),
      };
    }

    let read: ReadBranchResult;
    try {
      read = await this.branchService.readBranch({ name: proposalBranchName });
    } catch {
      return {
        ok: false,
        result: targetUnavailable(
          operation,
          'VERSION_PROVIDER_ERROR',
          'Version branch service failed while checking the proposal branch.',
        ),
      };
    }

    if (!read.ok) return { ok: false, result: branchFailure(operation, read.diagnostics) };
    if (!read.branch) return { ok: true, exists: false };

    const currentHead = branchCommitId(read.branch);
    if (currentHead === baseCommitId) return { ok: true, exists: true };
    return {
      ok: false,
      result: invalidBranchName(
        proposalBranchName,
        'Proposal branch name already exists at a different commit.',
      ),
    };
  }

  private async createProposalBranch(
    proposalBranchName: string,
    baseCommitId: WorkbookCommitId,
    operation: ProposalProviderOperation,
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly result: VersionResult<never> }
  > {
    if (!this.branchService?.createBranch) {
      return {
        ok: false,
        result: targetUnavailable(
          operation,
          'VERSION_REF_WRITE_UNAVAILABLE',
          'Provider-backed proposal creation requires branch/ref writes.',
        ),
      };
    }

    let created: CreateBranchResult;
    try {
      created = await this.branchService.createBranch({
        name: proposalBranchName,
        targetCommitId: baseCommitId,
        expectedAbsent: true,
        baseCommitId,
        createdBy: PROPOSAL_BRANCH_AUTHOR,
      });
    } catch {
      return {
        ok: false,
        result: targetUnavailable(
          operation,
          'VERSION_PROVIDER_ERROR',
          'Version branch service failed while creating the proposal branch.',
        ),
      };
    }

    if (created.ok) return { ok: true };

    if (created.error.code === 'refAlreadyExists') {
      return this.readOptionalProposalBranch(proposalBranchName, baseCommitId, operation);
    }
    return { ok: false, result: branchFailure(operation, created.diagnostics) };
  }

  private async ensureProposalBranch(
    proposal: AgentProposalRecord,
    operation: ProposalProviderOperation,
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly result: VersionResult<never> }
  > {
    const existingBranch = await this.readOptionalProposalBranch(
      proposal.proposalBranchName,
      proposal.baseCommitId,
      operation,
    );
    if (!existingBranch.ok) return existingBranch;
    if (existingBranch.exists) return { ok: true };
    return this.createProposalBranch(proposal.proposalBranchName, proposal.baseCommitId, operation);
  }

  private async ensureCommitExists(
    commitId: WorkbookCommitId,
    operation: ProposalProviderOperation,
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly result: VersionResult<never> }
  > {
    if (!this.graphProvider) {
      return {
        ok: false,
        result: targetUnavailable(
          operation,
          'VERSION_GRAPH_UNAVAILABLE',
          'Provider-backed proposal commit validation requires a visible version graph provider.',
        ),
      };
    }

    try {
      const registryRead = await this.graphProvider.readGraphRegistry();
      if (registryRead.status !== 'ok') {
        return { ok: false, result: branchFailure(operation, registryRead.diagnostics) };
      }
      const graph = await this.graphProvider.openGraph(
        namespaceForRegistry(registryRead.registry),
        this.graphProvider.accessContext,
      );
      const read = await graph.readCommit(commitId);
      if (read.status === 'success') return { ok: true };
      return { ok: false, result: branchFailure(operation, read.diagnostics) };
    } catch (error) {
      return {
        ok: false,
        result: targetUnavailable(
          operation,
          'VERSION_PROVIDER_ERROR',
          'Visible version graph could not validate the proposal commit.',
          'error',
          diagnosticsFromProviderError(error),
        ),
      };
    }
  }

  private async callWorkspaceService<T>(
    operation: ProposalProviderOperation,
    call: () => MaybePromise<VersionResult<T>>,
  ): Promise<VersionResult<T>> {
    try {
      return await call();
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

function ok<T>(value: T): VersionResult<T> {
  return { ok: true, value };
}

function storeFailure<T>(
  result: Extract<VersionResult<unknown>, { readonly ok: false }>,
): VersionResult<T> {
  return { ok: false, error: result.error };
}

function staleRevision<T>(expectedRevision: number, actualRevision: number): VersionResult<T> {
  return {
    ok: false,
    error: { code: 'stale_revision', expectedRevision, actualRevision },
  };
}

function workspaceUnavailable<T>(operation: ProposalProviderOperation): VersionResult<T> {
  return unsupported(
    operation,
    'VERSION_PROPOSAL_WORKSPACE_UNAVAILABLE',
    'Provider-backed proposal workspace sessions require an attached branch-isolated workspace lifecycle service.',
  );
}

function unsupported<T>(
  operation: ProposalProviderOperation,
  code: string,
  message: string,
): VersionResult<T> {
  return targetUnavailable(operation, code, message, 'warning');
}

function targetUnavailable<T>(
  operation: ProposalProviderOperation,
  code: string,
  message: string,
  severity: VersionDiagnostic['severity'] = 'error',
  sourceDiagnostics: readonly VersionDiagnostic[] = [],
): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: [
        diagnostic(code, severity, message, { operation }),
        ...sourceDiagnostics.map(cloneDiagnostic),
      ],
    },
  };
}

function branchFailure<T>(
  operation: ProposalProviderOperation,
  diagnostics: readonly unknown[],
): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: diagnostics.length
        ? diagnostics.map((item) => branchDiagnostic(item, operation))
        : [
            diagnostic(
              'VERSION_PROVIDER_ERROR',
              'error',
              'Version branch service failed without public diagnostics.',
              { operation },
            ),
          ],
    },
  };
}

function invalidState<T>(
  state: string,
  allowed: readonly string[],
  reason: string,
): VersionResult<T> {
  return { ok: false, error: { code: 'invalid_state', state, allowed, reason } };
}

function invalidBranchName<T>(branchName: string, reason: string): VersionResult<T> {
  return { ok: false, error: { code: 'invalid_branch_name', branchName, reason } };
}

function branchDiagnostic(value: unknown, operation: ProposalProviderOperation): VersionDiagnostic {
  if (!isRecord(value)) {
    return diagnostic(
      'VERSION_PROVIDER_ERROR',
      'error',
      'Version branch service returned an invalid diagnostic.',
      { operation },
    );
  }
  return diagnostic(
    typeof value.code === 'string' ? value.code : 'VERSION_PROVIDER_ERROR',
    publicSeverity(value.severity),
    typeof value.message === 'string'
      ? value.message
      : 'Version branch service returned a diagnostic without a public message.',
    branchDiagnosticData(value, operation),
  );
}

function branchDiagnosticData(
  value: Readonly<Record<string, unknown>>,
  operation: ProposalProviderOperation,
): Readonly<Record<string, string | number | boolean | null>> {
  const data: Record<string, string | number | boolean | null> = { operation };
  const details = isRecord(value.details) ? value.details : null;
  if (details && typeof details.cause === 'string') data.cause = details.cause;
  if (details && typeof details.missingField === 'string') data.option = details.missingField;
  return data;
}

function cloneDiagnostic(diagnostic: VersionDiagnostic): VersionDiagnostic {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    ...(diagnostic.owner === undefined ? {} : { owner: diagnostic.owner }),
    ...(diagnostic.dependency === undefined ? {} : { dependency: diagnostic.dependency }),
    ...(diagnostic.data === undefined ? {} : { data: { ...diagnostic.data } }),
  };
}

function diagnostic(
  code: string,
  severity: VersionDiagnostic['severity'],
  message: string,
  data?: Readonly<Record<string, string | number | boolean | null>>,
): VersionDiagnostic {
  return {
    code,
    severity,
    message,
    owner: 'version-store',
    ...(data === undefined ? {} : { data }),
  };
}

function publicSeverity(value: unknown): VersionDiagnostic['severity'] {
  return value === 'info' || value === 'warning' || value === 'error' ? value : 'error';
}

function diagnosticsFromProviderError(error: unknown): readonly VersionDiagnostic[] {
  if (!(error instanceof VersionStoreProviderError)) return [];
  return error.diagnostics.map((item) =>
    diagnostic(item.issueCode, publicSeverity(item.severity), item.safeMessage, {
      operation: item.operation,
    }),
  );
}

function isProposalBranchService(value: unknown): value is ProposalBranchService {
  return (
    isRecord(value) &&
    typeof value.readBranch === 'function' &&
    typeof value.createBranch === 'function'
  );
}

function isProposalGraphProvider(value: unknown): value is ProposalGraphProvider {
  return (
    isRecord(value) &&
    typeof value.readGraphRegistry === 'function' &&
    typeof value.openGraph === 'function' &&
    isRecord(value.accessContext)
  );
}

function isWorkbookVersionReviewService(value: unknown): value is WorkbookVersionReviewService {
  return (
    isRecord(value) &&
    typeof value.createReview === 'function' &&
    typeof value.getReview === 'function'
  );
}

function isProposalWorkspaceLifecycleService(
  value: unknown,
): value is ProposalWorkspaceLifecycleService {
  return (
    isRecord(value) &&
    typeof value.startProposalWorkspace === 'function' &&
    typeof value.getProposalWorkspace === 'function' &&
    typeof value.disposeProposalWorkspace === 'function' &&
    typeof value.commitProposalWorkspace === 'function'
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
