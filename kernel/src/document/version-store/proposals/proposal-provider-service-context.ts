import type { VersionResult, WorkbookCommitId } from '@mog-sdk/contracts/api';

import {
  createProviderBackedProposalBranch,
  ensureProviderBackedProposalBranch,
  ensureProviderBackedProposalCommitExists,
  openProviderBackedProposalStore,
  readOptionalProviderBackedProposalBranch,
  resolveProviderBackedProposalTargetHead,
} from './proposal-provider-service-branch-access';
import {
  sanitizeProposalProviderResult,
  targetUnavailable,
} from './proposal-provider-service-diagnostics';
import type {
  MaybePromise,
  ProposalBranchService,
  ProposalGraphProvider,
  ProposalProviderOperation,
  ResolvedBranchHead,
} from './proposal-provider-service-types';
import type { AgentProposalMetadataStore, AgentProposalRecord } from './proposal-store';
import type { ProposalWorkspaceLifecycleService } from './proposal-workspace-lifecycle-service';
import type { WorkbookVersionReviewService } from '../review-service';

export type ProviderBackedAgentProposalServiceOptions = {
  readonly openStore: () => Promise<AgentProposalMetadataStore>;
  readonly branchService?: ProposalBranchService;
  readonly graphProvider?: ProposalGraphProvider;
  readonly reviewService?: WorkbookVersionReviewService;
  readonly workspaceService?: ProposalWorkspaceLifecycleService;
};

export type ProviderBackedAgentProposalServiceContext =
  ProviderBackedAgentProposalServiceOptions & {
    openProposalStore(
      operation: ProposalProviderOperation,
    ): Promise<
      | { readonly ok: true; readonly value: AgentProposalMetadataStore }
      | { readonly ok: false; readonly result: VersionResult<never> }
    >;
    resolveTargetHead(
      targetRef: string,
      operation: ProposalProviderOperation,
    ): Promise<
      | { readonly ok: true; readonly head: ResolvedBranchHead }
      | { readonly ok: false; readonly result: VersionResult<never> }
    >;
    readOptionalProposalBranch(
      proposalBranchName: string,
      baseCommitId: WorkbookCommitId,
      operation: ProposalProviderOperation,
    ): Promise<
      | { readonly ok: true; readonly exists: boolean }
      | { readonly ok: false; readonly result: VersionResult<never> }
    >;
    createProposalBranch(
      proposalBranchName: string,
      baseCommitId: WorkbookCommitId,
      operation: ProposalProviderOperation,
    ): Promise<
      { readonly ok: true } | { readonly ok: false; readonly result: VersionResult<never> }
    >;
    ensureProposalBranch(
      proposal: AgentProposalRecord,
      operation: ProposalProviderOperation,
    ): Promise<
      { readonly ok: true } | { readonly ok: false; readonly result: VersionResult<never> }
    >;
    ensureCommitExists(
      commitId: WorkbookCommitId,
      operation: ProposalProviderOperation,
    ): Promise<
      { readonly ok: true } | { readonly ok: false; readonly result: VersionResult<never> }
    >;
    callWorkspaceService<T>(
      operation: ProposalProviderOperation,
      call: () => MaybePromise<VersionResult<T>>,
    ): Promise<VersionResult<T>>;
  };

export function createProviderBackedAgentProposalServiceContext(
  options: ProviderBackedAgentProposalServiceOptions,
): ProviderBackedAgentProposalServiceContext {
  const { openStore, branchService, graphProvider, reviewService, workspaceService } = options;

  return {
    openStore,
    branchService,
    graphProvider,
    reviewService,
    workspaceService,
    openProposalStore(operation) {
      return openProviderBackedProposalStore({ openStore, operation });
    },
    resolveTargetHead(targetRef, operation) {
      return resolveProviderBackedProposalTargetHead({
        branchService,
        targetRef,
        operation,
      });
    },
    readOptionalProposalBranch(proposalBranchName, baseCommitId, operation) {
      return readOptionalProviderBackedProposalBranch({
        branchService,
        proposalBranchName,
        baseCommitId,
        operation,
      });
    },
    createProposalBranch(proposalBranchName, baseCommitId, operation) {
      return createProviderBackedProposalBranch({
        branchService,
        proposalBranchName,
        baseCommitId,
        operation,
      });
    },
    ensureProposalBranch(proposal, operation) {
      return ensureProviderBackedProposalBranch({
        branchService,
        proposal,
        operation,
      });
    },
    ensureCommitExists(commitId, operation) {
      return ensureProviderBackedProposalCommitExists({
        graphProvider,
        commitId,
        operation,
      });
    },
    async callWorkspaceService<T>(
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
    },
  };
}
