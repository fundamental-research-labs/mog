import type { VersionResult } from '@mog-sdk/contracts/api';

import type { AgentProposalId, AgentProposalRecord } from './types';

export function ok<T>(value: T): VersionResult<T> {
  return { ok: true, value };
}

export function notFound<T>(proposalId: AgentProposalId | string): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'not_found',
      target: 'workbook.version.proposal',
      reason: `Proposal record ${proposalId} was not found.`,
    },
  };
}

export function staleRevision<T>(
  expectedRevision: number,
  actualRevision: number,
): VersionResult<T> {
  return {
    ok: false,
    error: { code: 'stale_revision', expectedRevision, actualRevision },
  };
}

export function invalidClientRequestReuse<T>(): VersionResult<T> {
  return invalidState<T>(
    'proposal_client_request_reused',
    ['idempotent_retry'],
    'clientRequestId is already bound to a different proposal mutation payload.',
  );
}

export function invalidCreate(
  state: string,
  allowed: readonly string[],
  reason: string,
): { readonly ok: false; readonly result: VersionResult<AgentProposalRecord> } {
  return { ok: false, result: invalidState<AgentProposalRecord>(state, allowed, reason) };
}

export function invalidUpdate(
  state: string,
  allowed: readonly string[],
  reason: string,
): { readonly ok: false; readonly result: VersionResult<AgentProposalRecord> } {
  return { ok: false, result: invalidState<AgentProposalRecord>(state, allowed, reason) };
}

export function invalidState<T>(
  state: string,
  allowed: readonly string[],
  reason: string,
): VersionResult<T> {
  return { ok: false, error: { code: 'invalid_state', state, allowed, reason } };
}
