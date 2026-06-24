import type {
  AgentProposal,
  AgentProposalSummary as PublicAgentProposalSummary,
  CreateAgentProposalInput,
  VersionBranchName,
  VersionMainRefName,
  VersionRecordRevision,
  VersionRefName,
  VersionResult,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { BranchRecord } from '../branch-service';
import type { RefVersion } from '../refs/ref-store';
import { objectDigestFor } from '../merge-apply-intent-store';
import type {
  AgentProposalRecord,
  AgentProposalSummary as StoreAgentProposalSummary,
} from './proposal-store';
import {
  sanitizeProposalProviderDiagnostics,
  sanitizeProposalProviderValue,
} from './proposal-provider-service-diagnostics';
import { validateRefName } from '../refs/ref-name';

const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';
const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;

export async function proposalBranchNameFor(
  input: CreateAgentProposalInput,
): Promise<
  | { readonly ok: true; readonly branchName: VersionBranchName }
  | { readonly ok: false; readonly result: VersionResult<never> }
> {
  if (input.proposalBranchNameHint) {
    const parsed = parsePublicBranchName(input.proposalBranchNameHint);
    if (!parsed.ok) return { ok: false, result: parsed.result };
    if (!parsed.branchName.startsWith('agent/')) {
      return {
        ok: false,
        result: invalidBranchName(
          parsed.branchName,
          'Provider-backed proposal branches must use the agent/ namespace.',
        ),
      };
    }
    return { ok: true, branchName: parsed.branchName as VersionBranchName };
  }

  const digest = await objectDigestFor('mog.version.agent-proposal.branch.v1', {
    clientRequestId: input.clientRequestId,
    agentRunId: input.agentRunId,
  });
  const run = refSegment(input.agentRunId, 40) || 'run';
  const title = refSegment(input.title, 60) || 'proposal';
  const branchName = `agent/${run}/${title}-${digest.digest.slice(0, 12)}`;
  return { ok: true, branchName: branchName as VersionBranchName };
}

export function parsePublicBranchName(value: unknown):
  | {
      readonly ok: true;
      readonly branchName: string;
      readonly refName: VersionMainRefName | VersionRefName;
    }
  | { readonly ok: false; readonly result: VersionResult<never> } {
  if (typeof value !== 'string') {
    return { ok: false, result: invalidBranchName('', 'Branch name must be a string.') };
  }
  if (value === 'HEAD') {
    return { ok: false, result: invalidBranchName(value, 'HEAD is symbolic, not a branch.') };
  }

  const branchName = value.startsWith(VERSION_BRANCH_REF_PREFIX)
    ? value.slice(VERSION_BRANCH_REF_PREFIX.length)
    : value;
  const parsed = validateRefName(branchName);
  if (!parsed.ok) {
    return {
      ok: false,
      result: invalidBranchName(branchName, 'Branch name is not public-safe.'),
    };
  }
  return {
    ok: true,
    branchName: parsed.name,
    refName:
      parsed.name === 'main'
        ? 'refs/heads/main'
        : (`${VERSION_BRANCH_REF_PREFIX}${parsed.name}` as VersionRefName),
  };
}

export function publicProposal(record: AgentProposalRecord): AgentProposal {
  const proposal: AgentProposal = {
    schemaVersion: 1,
    id: record.id as AgentProposal['id'],
    documentId: record.documentId,
    title: record.title,
    targetRef: record.targetRef as VersionMainRefName | VersionRefName,
    baseCommitId: record.baseCommitId,
    targetHeadIdAtCreation: record.targetHeadIdAtCreation as WorkbookCommitId,
    ...(record.targetRefVersionAtCreation === undefined
      ? {}
      : { targetRefRevisionAtCreation: publicRefVersion(record.targetRefVersionAtCreation) }),
    proposalBranchName: record.proposalBranchName as VersionBranchName,
    ...(record.proposalCommitId === undefined ? {} : { proposalCommitId: record.proposalCommitId }),
    status: record.status,
    revision: record.revision,
    agentRunId: record.agentRunId,
    agent: { ...record.agent } as AgentProposal['agent'],
    updatedAt: record.updatedAt,
    createdAt: record.createdAt,
    ...(record.workspaceId === undefined ? {} : { workspaceId: record.workspaceId }),
    ...(record.reviewId === undefined ? {} : { reviewId: record.reviewId }),
    ...(record.verification === undefined ? {} : { verification: record.verification }),
    redaction: {
      policy: { ...record.redaction.policy },
      redactedFields: [...record.redaction.redactedFields],
      diagnostics: sanitizeProposalProviderDiagnostics(record.redaction.diagnostics),
    },
    diagnostics: sanitizeProposalProviderDiagnostics(record.diagnostics),
  };
  return sanitizeProposalProviderValue(proposal);
}

export function publicProposalSummary(
  record: StoreAgentProposalSummary,
): PublicAgentProposalSummary {
  return {
    id: record.id,
    documentId: record.documentId,
    title: record.title,
    targetRef: record.targetRef as VersionMainRefName | VersionRefName,
    baseCommitId: record.baseCommitId,
    targetHeadIdAtCreation: record.targetHeadIdAtCreation as WorkbookCommitId,
    ...(record.targetRefVersionAtCreation === undefined
      ? {}
      : { targetRefRevisionAtCreation: publicRefVersion(record.targetRefVersionAtCreation) }),
    proposalBranchName: record.proposalBranchName as VersionBranchName,
    ...(record.proposalCommitId === undefined ? {} : { proposalCommitId: record.proposalCommitId }),
    status: record.status,
    revision: record.revision,
    agentRunId: record.agentRunId,
    agent: { ...record.agent } as PublicAgentProposalSummary['agent'],
    updatedAt: record.updatedAt,
  };
}

export function branchCommitId(branch: BranchRecord): WorkbookCommitId | null {
  return isWorkbookCommitId(branch.ref.targetCommitId) ? branch.ref.targetCommitId : null;
}

export function isWorkbookCommitId(value: unknown): value is WorkbookCommitId {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value);
}

export function publicRefVersion(refVersion: RefVersion): VersionRecordRevision {
  return { kind: refVersion.kind, value: refVersion.value };
}

function refSegment(value: string, maxLength: number): string {
  const segment = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return segment.slice(0, maxLength).replace(/-+$/g, '');
}

function invalidBranchName<T>(branchName: string, reason: string): VersionResult<T> {
  return { ok: false, error: { code: 'invalid_branch_name', branchName, reason } };
}
