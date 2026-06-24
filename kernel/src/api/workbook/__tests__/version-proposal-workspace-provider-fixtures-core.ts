import type { AgentProposalWorkspaceHandle } from '@mog-sdk/contracts/api';

import {
  createInMemoryVersionStoreProvider,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import type { ProposalWorkspaceLifecycleService } from '../../../document/version-store/proposals/proposal-workspace-lifecycle-service';
import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
export const ACTOR = { kind: 'user', trust: 'trusted', displayName: 'Reviewer' } as const;
const AGENT = {
  kind: 'agent',
  trust: 'trusted',
  displayName: 'Agent One',
  agentRunId: 'agent-run-1',
} as const;
export const REDACTION_POLICY = {
  mode: 'default',
  redactSecrets: true,
  redactExternalLinks: true,
  redactAgentTrace: true,
} as const;
export const PASSED_VERIFICATION = {
  status: 'passed',
  checks: [],
  createdAt: '2026-06-22T00:00:02.000Z',
} as const;

export type InMemoryVersionStoreProvider = ReturnType<typeof createInMemoryVersionStoreProvider>;

export function versionForProvider(
  provider: InMemoryVersionStoreProvider,
  proposalWorkspaceService: ProposalWorkspaceLifecycleService,
  versioning: Partial<Parameters<typeof attachWorkbookVersioning>[1]> = {},
): WorkbookVersionImpl {
  const ctx = { documentId: DOCUMENT_SCOPE.documentId } as any;
  const mergeCap = async () => undefined as never;
  attachWorkbookVersioning(ctx, {
    provider,
    captureMergeCommit: mergeCap,
    proposalWorkspaceService,
    ...versioning,
  });
  return new WorkbookVersionImpl(ctx);
}

export function createProposalInput(clientRequestId: string) {
  return {
    clientRequestId,
    title: 'Proposal One',
    targetRef: 'refs/heads/main' as const,
    agentRunId: 'agent-run-1',
    agent: AGENT,
    redactionPolicy: REDACTION_POLICY,
  };
}

export async function openProposalWorkspace(
  version: WorkbookVersionImpl,
  suffix: string,
): Promise<AgentProposalWorkspaceHandle> {
  const created = await version.createProposal(createProposalInput(`proposal-create-${suffix}`));
  if (!created.ok) throw new Error(`expected proposal create success: ${created.error.code}`);
  const opened = await version.startProposalWorkspace({
    clientRequestId: `workspace-open-${suffix}`,
    proposalId: created.value.id,
    expectedRevision: 1,
    actor: ACTOR,
  });
  if (!opened.ok) throw new Error(`expected workspace open success: ${opened.error.code}`);
  return opened.value;
}
