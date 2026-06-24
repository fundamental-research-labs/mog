import type {
  PageCursor,
  Paged,
  RedactionPolicy,
  RedactionSummary,
  VersionAuthor,
  VersionDiagnostic,
  VersionResult,
  VerificationSummary,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { AgentProposalStatus } from './status';
import type { RefVersion } from '../../refs/ref-store';
import type { VersionDocumentScope } from '../../registry';

export type { AgentProposalStatus } from './status';

export type AgentProposalId = `proposal:sha256:${string}`;

export type AgentProposalAcceptance = {
  readonly targetRef: string;
  readonly appliedCommitId: WorkbookCommitId;
  readonly expectedTargetHeadId?: string;
  readonly refUpdateReceiptId?: string;
};

export type AgentProposalTrustedIdentity = {
  readonly actor: VersionAuthor;
  readonly agent: VersionAuthor;
  readonly agentRunId: string;
};

export type AgentProposalSummary = {
  readonly id: AgentProposalId;
  readonly documentId: string;
  readonly title: string;
  readonly targetRef: string;
  readonly baseCommitId: WorkbookCommitId;
  readonly targetHeadIdAtCreation: string;
  readonly targetRefVersionAtCreation?: RefVersion;
  readonly proposalBranchName: string;
  readonly proposalCommitId?: WorkbookCommitId;
  readonly status: AgentProposalStatus;
  readonly revision: number;
  readonly agentRunId: string;
  readonly agent: VersionAuthor;
  readonly updatedAt: string;
};

export type AgentProposalRecord = AgentProposalSummary & {
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly createdBy: VersionAuthor;
  readonly lastActor?: VersionAuthor;
  readonly workspaceId?: string;
  readonly reviewId?: string;
  readonly verification?: VerificationSummary;
  readonly accepted?: AgentProposalAcceptance;
  readonly supersededByProposalId?: string;
  readonly rejectionReason?: string;
  readonly failureReason?: string;
  readonly supersedeReason?: string;
  readonly redaction: RedactionSummary;
  readonly diagnostics: readonly VersionDiagnostic[];
};

export type CreateAgentProposalStoreInput = {
  readonly clientRequestId: string;
  readonly title: string;
  readonly targetRef: string;
  readonly baseCommitId: WorkbookCommitId;
  readonly targetHeadIdAtCreation: string;
  readonly targetRefVersionAtCreation: RefVersion;
  readonly proposalBranchName: string;
  readonly redactionPolicy: RedactionPolicy;
  readonly trustedIdentity: AgentProposalTrustedIdentity;
  readonly createdAt?: string;
};

export type UpdateAgentProposalStoreInput = {
  readonly clientRequestId: string;
  readonly proposalId: AgentProposalId | string;
  readonly expectedRevision: number;
  readonly status: AgentProposalStatus;
  readonly trustedActor: VersionAuthor;
  readonly workspaceId?: string;
  readonly proposalCommitId?: WorkbookCommitId;
  readonly reviewId?: string;
  readonly verification?: VerificationSummary;
  readonly accepted?: AgentProposalAcceptance;
  readonly supersededByProposalId?: AgentProposalId | string;
  readonly diagnostics?: readonly VersionDiagnostic[];
  readonly reason?: string;
  readonly updatedAt?: string;
};

export type ListAgentProposalsStoreInput = {
  readonly targetRef?: string;
  readonly baseCommitId?: WorkbookCommitId;
  readonly proposalCommitId?: WorkbookCommitId;
  readonly proposalBranchName?: string;
  readonly status?: AgentProposalStatus;
  readonly agentRunId?: string;
  readonly cursor?: PageCursor;
  readonly limit?: number;
};

export interface AgentProposalMetadataStore {
  readonly documentScope: VersionDocumentScope;
  createProposal(input: CreateAgentProposalStoreInput): Promise<VersionResult<AgentProposalRecord>>;
  getProposal(proposalId: AgentProposalId | string): Promise<VersionResult<AgentProposalRecord>>;
  getProposalByWorkspaceId(workspaceId: string): Promise<VersionResult<AgentProposalRecord>>;
  listProposals(
    input: ListAgentProposalsStoreInput,
  ): Promise<VersionResult<Paged<AgentProposalSummary>>>;
  updateProposal(input: UpdateAgentProposalStoreInput): Promise<VersionResult<AgentProposalRecord>>;
}

export type AgentProposalMetadataStoreProvider = {
  openAgentProposalMetadataStore(): Promise<AgentProposalMetadataStore>;
};

export type AgentProposalMutationOperation = 'createProposal' | 'updateProposal';

export type AgentProposalMutationLogEntry = {
  readonly schemaVersion: 1;
  readonly operation: AgentProposalMutationOperation;
  readonly clientRequestId: string;
  readonly fingerprint: string;
  readonly resultRecord: AgentProposalRecord;
  readonly recordedAt: string;
};

export type AgentProposalStoreRow = {
  readonly schemaVersion: 1;
  readonly operation: 'agent-proposal-record';
  readonly documentScopeKey: string;
  readonly proposalId: AgentProposalId;
  readonly documentId: string;
  readonly targetRef: string;
  readonly baseCommitId: WorkbookCommitId;
  readonly proposalCommitId?: WorkbookCommitId;
  readonly proposalBranchName: string;
  readonly agentRunId: string;
  readonly status: AgentProposalStatus;
  readonly updatedAt: string;
  readonly createClientRequestId: string;
  readonly record: AgentProposalRecord;
  readonly mutationLog: readonly AgentProposalMutationLogEntry[];
};

export type AgentProposalMetadataMemoryBackendSnapshot = {
  readonly rows: readonly AgentProposalStoreRow[];
};

export type AgentProposalStoreAdapter = {
  readRow(proposalId: AgentProposalId | string): Promise<AgentProposalStoreRow | undefined>;
  listRows(): Promise<readonly AgentProposalStoreRow[]>;
  mutateRow<T>(
    proposalId: AgentProposalId | string,
    mutator: (row: AgentProposalStoreRow | undefined) => AgentProposalRowMutation<T>,
  ): Promise<VersionResult<T>>;
  mutateRows<T>(
    mutator: (rows: readonly AgentProposalStoreRow[]) => AgentProposalRowMutation<T>,
  ): Promise<VersionResult<T>>;
};

export type AgentProposalRowMutation<T> =
  | {
      readonly action: 'put';
      readonly row: AgentProposalStoreRow;
      readonly result: VersionResult<T>;
    }
  | { readonly action: 'none'; readonly result: VersionResult<T> };
