import type { VersionResult } from '@mog-sdk/contracts/api';

import { objectDigestFor } from '../../merge-apply-intent-store';
import { canonicalJsonStringify, cloneAgentProposalRecord } from './codec';
import { invalidClientRequestReuse, ok } from './results';
import type {
  AgentProposalId,
  AgentProposalMutationOperation,
  AgentProposalStoreRow,
  CreateAgentProposalStoreInput,
  UpdateAgentProposalStoreInput,
} from './types';

export async function proposalIdForCreate(
  documentScopeKey: string,
  clientRequestId: string,
): Promise<AgentProposalId> {
  const digest = await objectDigestFor('mog.version.agent-proposal.create.v1', {
    documentScopeKey,
    clientRequestId,
  });
  return `proposal:sha256:${digest.digest}`;
}

export function idempotencyResult<T>(
  row: AgentProposalStoreRow,
  operation: AgentProposalMutationOperation,
  clientRequestId: string,
  fingerprint: string,
): VersionResult<T> | null {
  const entry = row.mutationLog.find((item) => item.clientRequestId === clientRequestId);
  if (!entry) return null;
  if (entry.operation !== operation || entry.fingerprint !== fingerprint) {
    return invalidClientRequestReuse<T>();
  }
  return ok(cloneAgentProposalRecord(entry.resultRecord) as T);
}

export function clientRequestIdWasUsed(
  row: AgentProposalStoreRow,
  clientRequestId: string,
): boolean {
  return row.mutationLog.some((entry) => entry.clientRequestId === clientRequestId);
}

export function createProposalFingerprint(input: CreateAgentProposalStoreInput): unknown {
  return {
    clientRequestId: input.clientRequestId,
    title: input.title,
    targetRef: input.targetRef,
    baseCommitId: input.baseCommitId,
    targetHeadIdAtCreation: input.targetHeadIdAtCreation,
    targetRefVersionAtCreation: input.targetRefVersionAtCreation,
    proposalBranchName: input.proposalBranchName,
    redactionPolicy: input.redactionPolicy,
    trustedIdentity: input.trustedIdentity,
  };
}

export function updateProposalFingerprint(input: UpdateAgentProposalStoreInput): unknown {
  return {
    clientRequestId: input.clientRequestId,
    proposalId: input.proposalId,
    expectedRevision: input.expectedRevision,
    status: input.status,
    trustedActor: input.trustedActor,
    workspaceId: input.workspaceId,
    proposalCommitId: input.proposalCommitId,
    reviewId: input.reviewId,
    verification: input.verification,
    accepted: input.accepted,
    supersededByProposalId: input.supersededByProposalId,
    diagnostics: input.diagnostics,
    reason: input.reason,
  };
}

export function mutationFingerprint(
  operation: AgentProposalMutationOperation,
  value: unknown,
): string {
  return `${operation}:${canonicalJsonStringify(value)}`;
}
