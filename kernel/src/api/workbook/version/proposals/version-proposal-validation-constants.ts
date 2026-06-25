import type { AcceptAgentProposalInput, AgentProposalStatus } from './version-proposal-types';

export const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
export const PROPOSAL_ID_RE = /^proposal:sha256:[0-9a-f]{64}$/;
export const AUTHOR_KINDS: ReadonlySet<string> = new Set(['user', 'agent', 'system', 'unknown']);
export const AUTHOR_TRUST_LEVELS: ReadonlySet<string> = new Set(['trusted', 'unknown', 'redacted']);

export const PROPOSAL_STATUSES: ReadonlySet<AgentProposalStatus> = new Set([
  'draft',
  'workspace_open',
  'committed',
  'verified',
  'ready_for_review',
  'rejected',
  'stale',
  'superseded',
  'merge_conflicted',
  'failed',
  'applied',
]);

export const ACCEPT_RESOLUTION_POLICIES: ReadonlySet<AcceptAgentProposalInput['resolutionPolicy']> =
  new Set(['fastForwardOnly', 'allowCleanMerge', 'allowResolvedMerge']);

export const CREATE_PROPOSAL_KEYS: ReadonlySet<string> = new Set([
  'clientRequestId',
  'title',
  'targetRef',
  'baseCommitId',
  'agentRunId',
  'agent',
  'proposalBranchNameHint',
  'redactionPolicy',
]);
export const START_PROPOSAL_WORKSPACE_KEYS: ReadonlySet<string> = new Set([
  'clientRequestId',
  'proposalId',
  'expectedRevision',
  'expectedTargetHeadId',
  'expectedTargetRefRevision',
  'actor',
]);
export const GET_PROPOSAL_WORKSPACE_KEYS: ReadonlySet<string> = new Set([
  'workspaceId',
  'expectedTargetHeadId',
  'expectedTargetRefRevision',
]);
export const DISPOSE_PROPOSAL_WORKSPACE_KEYS: ReadonlySet<string> = new Set([
  'clientRequestId',
  'workspaceId',
  'expectedTargetHeadId',
  'expectedTargetRefRevision',
  'actor',
]);
export const COMMIT_PROPOSAL_WORKSPACE_KEYS: ReadonlySet<string> = new Set([
  'clientRequestId',
  'proposalId',
  'workspaceId',
  'expectedRevision',
  'expectedTargetHeadId',
  'expectedTargetRefRevision',
  'actor',
  'message',
  'verification',
]);
export const FAIL_PROPOSAL_KEYS: ReadonlySet<string> = new Set([
  'clientRequestId',
  'proposalId',
  'expectedRevision',
  'actor',
  'diagnostics',
]);
export const GET_PROPOSAL_KEYS: ReadonlySet<string> = new Set(['proposalId']);
export const LIST_PROPOSALS_KEYS: ReadonlySet<string> = new Set([
  'targetRef',
  'status',
  'agentRunId',
  'cursor',
  'limit',
]);
export const MARK_PROPOSAL_VERIFIED_KEYS: ReadonlySet<string> = new Set([
  'clientRequestId',
  'proposalId',
  'expectedRevision',
  'verification',
  'actor',
]);
export const OPEN_PROPOSAL_REVIEW_KEYS: ReadonlySet<string> = new Set([
  'clientRequestId',
  'proposalId',
  'expectedRevision',
  'actor',
]);
export const ACCEPT_PROPOSAL_KEYS: ReadonlySet<string> = new Set([
  'clientRequestId',
  'proposalId',
  'expectedRevision',
  'expectedTargetHeadId',
  'expectedTargetRefRevision',
  'actor',
  'resolutionPolicy',
]);
export const REJECT_PROPOSAL_KEYS: ReadonlySet<string> = new Set([
  'clientRequestId',
  'proposalId',
  'expectedRevision',
  'actor',
  'reason',
]);
export const SUPERSEDE_PROPOSAL_KEYS: ReadonlySet<string> = new Set([
  'clientRequestId',
  'proposalId',
  'expectedRevision',
  'actor',
  'supersededByProposalId',
  'reason',
]);
