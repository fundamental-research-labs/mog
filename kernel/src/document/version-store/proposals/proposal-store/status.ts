export const AGENT_PROPOSAL_STATUSES = Object.freeze([
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
] as const);

export type AgentProposalStatus = (typeof AGENT_PROPOSAL_STATUSES)[number];

export function isAgentProposalStatus(value: unknown): value is AgentProposalStatus {
  return AGENT_PROPOSAL_STATUSES.includes(value as AgentProposalStatus);
}
