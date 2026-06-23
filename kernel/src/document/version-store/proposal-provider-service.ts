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
  WorkbookVersionReviewRecord,
} from '@mog-sdk/contracts/api';

import {
  createProviderBackedAgentProposal,
  failProviderBackedAgentProposal,
  getProviderBackedAgentProposal,
  listProviderBackedAgentProposals,
  markProviderBackedAgentProposalVerified,
  rejectProviderBackedAgentProposal,
  supersedeProviderBackedAgentProposal,
} from './proposal-provider-service-basic-operations';
import {
  createProviderBackedAgentProposalServiceContext,
  type ProviderBackedAgentProposalServiceContext,
  type ProviderBackedAgentProposalServiceOptions,
} from './proposal-provider-service-context';
import {
  isProposalBranchService,
  isProposalGraphProvider,
  isWorkbookVersionReviewService,
} from './proposal-provider-service-guards';
import {
  acceptProviderBackedProposal,
  openProviderBackedProposalReview,
} from './proposal-provider-service-review-operations';
import type { ProposalBranchService, ResolvedBranchHead } from './proposal-provider-service-types';
import {
  commitProviderBackedProposalWorkspace,
  disposeProviderBackedAgentProposalWorkspace,
  getProviderBackedProposalWorkspace,
  startProviderBackedProposalWorkspace,
} from './proposal-provider-service-workspace-operations';
import {
  hasAgentProposalMetadataStoreProvider,
  type AgentProposalMetadataStoreProvider,
} from './proposal-store';
import { isProposalWorkspaceLifecycleService } from './proposal-workspace-lifecycle-service';

export type { ProposalBranchService, ResolvedBranchHead };

export class ProviderBackedAgentProposalService {
  private readonly context: ProviderBackedAgentProposalServiceContext;

  constructor(options: ProviderBackedAgentProposalServiceOptions) {
    this.context = createProviderBackedAgentProposalServiceContext(options);
  }

  get proposalWorkspaceLifecycleAvailable(): boolean {
    return Boolean(this.context.workspaceService);
  }

  async createProposal(input: CreateAgentProposalInput): Promise<VersionResult<AgentProposal>> {
    return createProviderBackedAgentProposal(this.context, input);
  }

  async startProposalWorkspace(
    input: StartProposalWorkspaceInput,
  ): Promise<VersionResult<AgentProposalWorkspaceHandle>> {
    return startProviderBackedProposalWorkspace(this.context, input);
  }

  async getProposalWorkspace(
    input: GetProposalWorkspaceInput,
  ): Promise<VersionResult<AgentProposalWorkspaceHandle>> {
    return getProviderBackedProposalWorkspace(this.context, input);
  }

  async disposeProposalWorkspace(
    input: DisposeProposalWorkspaceInput,
  ): Promise<VersionResult<{ readonly disposed: true }>> {
    return disposeProviderBackedAgentProposalWorkspace(this.context, input);
  }

  async commitProposalWorkspace(
    input: CommitProposalWorkspaceInput,
  ): Promise<VersionResult<AgentProposal>> {
    return commitProviderBackedProposalWorkspace(this.context, input);
  }

  async failProposal(input: FailAgentProposalInput): Promise<VersionResult<AgentProposal>> {
    return failProviderBackedAgentProposal(this.context, input);
  }

  async getProposal(input: GetAgentProposalInput): Promise<VersionResult<AgentProposal>> {
    return getProviderBackedAgentProposal(this.context, input);
  }

  async listProposals(
    input: ListAgentProposalsInput = {},
  ): Promise<VersionResult<Paged<PublicAgentProposalSummary>>> {
    return listProviderBackedAgentProposals(this.context, input);
  }

  async markProposalVerified(
    input: MarkAgentProposalVerifiedInput,
  ): Promise<VersionResult<AgentProposal>> {
    return markProviderBackedAgentProposalVerified(this.context, input);
  }

  async openProposalReview(
    input: OpenProposalReviewInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    return openProviderBackedProposalReview(this.context, input);
  }

  async acceptProposal(
    input: AcceptAgentProposalInput,
  ): Promise<VersionResult<AgentProposalAcceptResult>> {
    return acceptProviderBackedProposal(this.context, input);
  }

  async rejectProposal(input: RejectAgentProposalInput): Promise<VersionResult<AgentProposal>> {
    return rejectProviderBackedAgentProposal(this.context, input);
  }

  async supersedeProposal(
    input: SupersedeAgentProposalInput,
  ): Promise<VersionResult<AgentProposal>> {
    return supersedeProviderBackedAgentProposal(this.context, input);
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
