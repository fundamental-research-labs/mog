import type {
  AgentProposal,
  AgentProposalWorkspaceHandle,
  CommitProposalWorkspaceInput,
  DisposeProposalWorkspaceInput,
  GetProposalWorkspaceInput,
  StartProposalWorkspaceInput,
  VersionDiagnostic,
  VersionResult,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { AgentProposalRecord } from './proposal-store';

type MaybePromise<T> = T | Promise<T>;

export type ProviderBackedProposalWorkspaceInput = {
  readonly proposal: AgentProposal;
  readonly proposalRecord: AgentProposalRecord;
};

export type ProviderBackedStartProposalWorkspaceInput = StartProposalWorkspaceInput &
  ProviderBackedProposalWorkspaceInput;

export type ProviderBackedCommitProposalWorkspaceInput = CommitProposalWorkspaceInput &
  ProviderBackedProposalWorkspaceInput;

export type ProviderBackedProposalWorkspaceCommitResult = {
  readonly workspaceId: string;
  readonly proposalCommitId: WorkbookCommitId;
  readonly diagnostics?: readonly VersionDiagnostic[];
};

export type ProposalWorkspaceLifecycleService = {
  startProposalWorkspace(
    input: ProviderBackedStartProposalWorkspaceInput,
  ): MaybePromise<VersionResult<AgentProposalWorkspaceHandle>>;
  getProposalWorkspace(
    input: GetProposalWorkspaceInput,
  ): MaybePromise<VersionResult<AgentProposalWorkspaceHandle>>;
  disposeProposalWorkspace(
    input: DisposeProposalWorkspaceInput,
  ): MaybePromise<VersionResult<{ readonly disposed: true }>>;
  commitProposalWorkspace(
    input: ProviderBackedCommitProposalWorkspaceInput,
  ): MaybePromise<VersionResult<ProviderBackedProposalWorkspaceCommitResult>>;
};
