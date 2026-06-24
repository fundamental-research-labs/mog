import type { VersionDocumentScope } from '../provider';
import type {
  AgentProposalMetadataStore,
  AgentProposalRecord,
  CreateAgentProposalStoreInput,
} from '../proposals/proposal-store';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
export const OTHER_DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-2',
  principalScope: 'principal-1',
};
export const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}` as const;
export const HEAD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}` as const;
export const TARGET_REF_VERSION = { kind: 'counter', value: '0' } as const;
export const PROPOSAL_COMMIT_ID = `commit:sha256:${'3'.repeat(64)}` as const;
export const ACCEPTED_COMMIT_ID = `commit:sha256:${'4'.repeat(64)}` as const;
export const ACTOR = { kind: 'user', trust: 'trusted', displayName: 'Reviewer' } as const;
const AGENT = {
  kind: 'agent',
  trust: 'trusted',
  displayName: 'Agent One',
  agentRunId: 'agent-run-1',
} as const;
const REDACTION_POLICY = {
  mode: 'default',
  redactSecrets: true,
  redactExternalLinks: true,
  redactAgentTrace: true,
} as const;
export const PASSED_VERIFICATION = {
  status: 'passed',
  checks: [
    {
      name: 'proposal-tests',
      status: 'passed',
      diagnostics: [],
    },
  ],
  createdAt: '2026-06-22T00:10:00.000Z',
} as const;

export function createProposalInput(
  clientRequestId: string,
  overrides: Partial<CreateAgentProposalStoreInput> = {},
): CreateAgentProposalStoreInput {
  return {
    clientRequestId,
    title: 'Proposal One',
    targetRef: 'refs/heads/main',
    baseCommitId: BASE_COMMIT_ID,
    targetHeadIdAtCreation: HEAD_COMMIT_ID,
    targetRefVersionAtCreation: TARGET_REF_VERSION,
    proposalBranchName: 'agent/agent-run-1/proposal-1',
    redactionPolicy: REDACTION_POLICY,
    trustedIdentity: {
      actor: ACTOR,
      agent: AGENT,
      agentRunId: 'agent-run-1',
    },
    createdAt: '2026-06-22T00:00:00.000Z',
    ...overrides,
  };
}

export async function expectCreate(
  resultPromise: ReturnType<AgentProposalMetadataStore['createProposal']>,
): Promise<AgentProposalRecord> {
  const result = await resultPromise;
  if (!result.ok) throw new Error(`expected proposal create success: ${result.error.code}`);
  return result.value;
}

export async function createReadyProposal(
  store: AgentProposalMetadataStore,
  suffix: string,
): Promise<AgentProposalRecord> {
  const created = await expectCreate(
    store.createProposal(
      createProposalInput(`create-${suffix}`, {
        proposalBranchName: `agent/agent-run-1/${suffix}`,
      }),
    ),
  );
  const workspace = await expectRecord(
    store.updateProposal({
      clientRequestId: `workspace-${suffix}`,
      proposalId: created.id,
      expectedRevision: created.revision,
      status: 'workspace_open',
      trustedActor: ACTOR,
      workspaceId: `workspace-${suffix}`,
    }),
  );
  const committed = await expectRecord(
    store.updateProposal({
      clientRequestId: `commit-${suffix}`,
      proposalId: workspace.id,
      expectedRevision: workspace.revision,
      status: 'committed',
      trustedActor: ACTOR,
      proposalCommitId: PROPOSAL_COMMIT_ID,
    }),
  );
  const verified = await expectRecord(
    store.updateProposal({
      clientRequestId: `verify-${suffix}`,
      proposalId: committed.id,
      expectedRevision: committed.revision,
      status: 'verified',
      trustedActor: ACTOR,
      verification: PASSED_VERIFICATION,
    }),
  );
  return expectRecord(
    store.updateProposal({
      clientRequestId: `ready-${suffix}`,
      proposalId: verified.id,
      expectedRevision: verified.revision,
      status: 'ready_for_review',
      trustedActor: ACTOR,
      reviewId: `review-${suffix}`,
    }),
  );
}

export async function expectRecord(
  resultPromise: ReturnType<AgentProposalMetadataStore['updateProposal']>,
): Promise<AgentProposalRecord> {
  const result = await resultPromise;
  if (!result.ok) throw new Error(`expected proposal update success: ${result.error.code}`);
  return result.value;
}
