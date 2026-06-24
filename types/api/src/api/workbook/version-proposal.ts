import type {
  PageCursor,
  Paged,
  RedactionPolicy,
  RedactionSummary,
  VersionAuthor,
  VersionDiagnostic,
  VersionResult,
  VerificationSummary,
} from './version-shared';
import type {
  VersionBranchName,
  VersionMainRefName,
  VersionRecordRevision,
  VersionRefName,
  WorkbookCommitId,
} from './version';
import type { WorkbookVersionReviewRecord } from './version-review';

export type AgentProposalId = string & {
  readonly __brand?: 'AgentProposalId';
};

export type AgentProposalStatus =
  | 'draft'
  | 'workspace_open'
  | 'committed'
  | 'verified'
  | 'ready_for_review'
  | 'rejected'
  | 'stale'
  | 'superseded'
  | 'merge_conflicted'
  | 'failed'
  | 'applied';

export interface AgentProposalSummary {
  readonly id: AgentProposalId;
  readonly documentId: string;
  readonly title: string;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly baseCommitId: WorkbookCommitId;
  readonly targetHeadIdAtCreation: WorkbookCommitId;
  readonly targetRefRevisionAtCreation?: VersionRecordRevision;
  readonly proposalBranchName: VersionBranchName;
  readonly proposalCommitId?: WorkbookCommitId;
  readonly status: AgentProposalStatus;
  readonly revision: number;
  readonly agentRunId: string;
  readonly agent: VersionAuthor;
  readonly updatedAt: string;
}

export interface AgentProposal extends AgentProposalSummary {
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly workspaceId?: string;
  readonly reviewId?: string;
  readonly verification?: VerificationSummary;
  readonly redaction: RedactionSummary;
  readonly diagnostics: readonly VersionDiagnostic[];
}

export interface AgentProposalWorkspaceHandle {
  readonly workspaceId: string;
  readonly proposalId: AgentProposalId;
  readonly proposalBranchName: VersionBranchName;
  readonly baseCommitId: WorkbookCommitId;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly targetHeadIdAtCreation?: WorkbookCommitId;
  readonly targetRefRevisionAtCreation?: VersionRecordRevision;
  readonly providerIdentity: string;
  readonly workbookSessionId: string;
}

export interface AgentProposalWorkspaceSession<
  WorkbookLike = unknown,
> extends AgentProposalWorkspaceHandle {
  getWorkbook(): WorkbookLike;
  dispose(): Promise<void>;
}

export type AgentProposalAcceptResolutionPolicy =
  | 'fastForwardOnly'
  | 'allowCleanMerge'
  | 'allowResolvedMerge';

export type AgentProposalAcceptResult =
  | {
      readonly status: 'fast_forwarded';
      readonly proposalId: AgentProposalId;
      readonly appliedCommitId: WorkbookCommitId;
      readonly targetRef: VersionMainRefName | VersionRefName;
      readonly newHeadId: WorkbookCommitId;
      readonly refUpdateReceiptId: string;
    }
  | {
      readonly status: 'merge_applied';
      readonly proposalId: AgentProposalId;
      readonly mergeCommitId: WorkbookCommitId;
      readonly targetRef: VersionMainRefName | VersionRefName;
      readonly newHeadId: WorkbookCommitId;
      readonly mergePreviewId: string;
      readonly refUpdateReceiptId: string;
    }
  | {
      readonly status: 'merge_conflicted';
      readonly proposalId: AgentProposalId;
      readonly mergePreviewId: string;
      readonly conflictIds: readonly string[];
    }
  | {
      readonly status: 'stale';
      readonly proposalId: AgentProposalId;
      readonly expectedTargetHeadId: WorkbookCommitId;
      readonly actualTargetHeadId: WorkbookCommitId;
    };

export interface CreateAgentProposalInput {
  readonly clientRequestId: string;
  readonly title: string;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly baseCommitId?: WorkbookCommitId;
  readonly agentRunId: string;
  readonly agent: VersionAuthor;
  readonly proposalBranchNameHint?: VersionBranchName;
  readonly redactionPolicy: RedactionPolicy;
}

export interface StartProposalWorkspaceInput {
  readonly clientRequestId: string;
  readonly proposalId: AgentProposalId;
  readonly expectedRevision: number;
  readonly expectedTargetHeadId?: WorkbookCommitId;
  readonly expectedTargetRefRevision?: VersionRecordRevision;
  readonly actor: VersionAuthor;
}

export interface CommitProposalWorkspaceInput {
  readonly clientRequestId: string;
  readonly proposalId: AgentProposalId;
  readonly workspaceId: string;
  readonly expectedRevision: number;
  readonly expectedTargetHeadId?: WorkbookCommitId;
  readonly expectedTargetRefRevision?: VersionRecordRevision;
  readonly actor: VersionAuthor;
  readonly message: string;
  readonly verification?: VerificationSummary;
}

export interface GetProposalWorkspaceInput {
  readonly workspaceId: string;
  readonly expectedTargetHeadId?: WorkbookCommitId;
  readonly expectedTargetRefRevision?: VersionRecordRevision;
}

export interface DisposeProposalWorkspaceInput {
  readonly clientRequestId: string;
  readonly workspaceId: string;
  readonly expectedTargetHeadId?: WorkbookCommitId;
  readonly expectedTargetRefRevision?: VersionRecordRevision;
  readonly actor: VersionAuthor;
}

export interface FailAgentProposalInput {
  readonly clientRequestId: string;
  readonly proposalId: AgentProposalId;
  readonly expectedRevision: number;
  readonly actor: VersionAuthor;
  readonly diagnostics: readonly VersionDiagnostic[];
}

export interface GetAgentProposalInput {
  readonly proposalId: AgentProposalId;
}

export interface ListAgentProposalsInput {
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly status?: AgentProposalStatus;
  readonly agentRunId?: string;
  readonly cursor?: PageCursor;
  readonly limit?: number;
}

export interface MarkAgentProposalVerifiedInput {
  readonly clientRequestId: string;
  readonly proposalId: AgentProposalId;
  readonly expectedRevision: number;
  readonly verification: VerificationSummary;
  readonly actor: VersionAuthor;
}

export interface OpenProposalReviewInput {
  readonly clientRequestId: string;
  readonly proposalId: AgentProposalId;
  readonly expectedRevision: number;
  readonly actor: VersionAuthor;
}

export interface AcceptAgentProposalInput {
  readonly clientRequestId: string;
  readonly proposalId: AgentProposalId;
  readonly expectedRevision: number;
  readonly expectedTargetHeadId: WorkbookCommitId;
  readonly expectedTargetRefRevision?: VersionRecordRevision;
  readonly actor: VersionAuthor;
  readonly resolutionPolicy: AgentProposalAcceptResolutionPolicy;
}

export interface RejectAgentProposalInput {
  readonly clientRequestId: string;
  readonly proposalId: AgentProposalId;
  readonly expectedRevision: number;
  readonly actor: VersionAuthor;
  readonly reason?: string;
}

export interface SupersedeAgentProposalInput {
  readonly clientRequestId: string;
  readonly proposalId: AgentProposalId;
  readonly expectedRevision: number;
  readonly actor: VersionAuthor;
  readonly supersededByProposalId?: AgentProposalId;
  readonly reason?: string;
}

export interface VersionProposalApi {
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
  acceptProposal(
    input: AcceptAgentProposalInput,
  ): Promise<VersionResult<AgentProposalAcceptResult>>;
  rejectProposal(input: RejectAgentProposalInput): Promise<VersionResult<AgentProposal>>;
  supersedeProposal(input: SupersedeAgentProposalInput): Promise<VersionResult<AgentProposal>>;
}
