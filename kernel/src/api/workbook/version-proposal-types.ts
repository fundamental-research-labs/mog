import type {
  AcceptAgentProposalInput,
  AgentProposal,
  AgentProposalAcceptResult,
  AgentProposalStatus,
  AgentProposalSummary,
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
  RejectAgentProposalInput,
  StartProposalWorkspaceInput,
  SupersedeAgentProposalInput,
} from '@mog-sdk/contracts/api';

export type {
  AcceptAgentProposalInput,
  AgentProposal,
  AgentProposalAcceptResult,
  AgentProposalStatus,
  AgentProposalSummary,
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
  RejectAgentProposalInput,
  StartProposalWorkspaceInput,
  SupersedeAgentProposalInput,
} from '@mog-sdk/contracts/api';

export const PROPOSAL_OPERATIONS = [
  'createProposal',
  'startProposalWorkspace',
  'getProposalWorkspace',
  'disposeProposalWorkspace',
  'commitProposalWorkspace',
  'failProposal',
  'getProposal',
  'listProposals',
  'markProposalVerified',
  'openProposalReview',
  'acceptProposal',
  'rejectProposal',
  'supersedeProposal',
] as const;

export type VersionProposalPublicOperation = (typeof PROPOSAL_OPERATIONS)[number];

export type ProposalOperationInput<Operation extends VersionProposalPublicOperation> =
  Operation extends 'createProposal'
    ? CreateAgentProposalInput
    : Operation extends 'startProposalWorkspace'
      ? StartProposalWorkspaceInput
      : Operation extends 'getProposalWorkspace'
        ? GetProposalWorkspaceInput
        : Operation extends 'disposeProposalWorkspace'
          ? DisposeProposalWorkspaceInput
          : Operation extends 'commitProposalWorkspace'
            ? CommitProposalWorkspaceInput
            : Operation extends 'failProposal'
              ? FailAgentProposalInput
              : Operation extends 'getProposal'
                ? GetAgentProposalInput
                : Operation extends 'listProposals'
                  ? ListAgentProposalsInput
                  : Operation extends 'markProposalVerified'
                    ? MarkAgentProposalVerifiedInput
                    : Operation extends 'openProposalReview'
                      ? OpenProposalReviewInput
                      : Operation extends 'acceptProposal'
                        ? AcceptAgentProposalInput
                        : Operation extends 'rejectProposal'
                          ? RejectAgentProposalInput
                          : Operation extends 'supersedeProposal'
                            ? SupersedeAgentProposalInput
                            : never;
