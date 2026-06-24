import type { PageCursor, Paged, VersionResult } from '@mog-sdk/contracts/api';

import { cloneJson } from './codec';
import { invalidState } from './results';
import type {
  AgentProposalRecord,
  AgentProposalSummary,
  ListAgentProposalsStoreInput,
} from './types';

const DEFAULT_PROPOSAL_LIST_LIMIT = 50;
const PROPOSAL_LIST_CURSOR_PREFIX = 'proposal-list:';

export function listAgentProposalRecords(
  records: readonly AgentProposalRecord[],
  input: ListAgentProposalsStoreInput = {},
): VersionResult<Paged<AgentProposalSummary>> {
  const cursor = parseProposalListCursor(input.cursor);
  if (!cursor.ok) return cursor.result;

  const limit = input.limit ?? DEFAULT_PROPOSAL_LIST_LIMIT;
  const filtered = records.filter((record) => proposalMatchesListInput(record, input));
  filtered.sort(compareProposalsForList);
  const page = filtered.slice(cursor.offset, cursor.offset + limit);
  const nextOffset = cursor.offset + page.length;
  return {
    ok: true,
    value: {
      items: page.map(proposalSummary),
      ...(nextOffset < filtered.length ? { nextCursor: proposalListCursor(nextOffset) } : {}),
      limit,
      totalEstimate: filtered.length,
    },
  };
}

function proposalMatchesListInput(
  record: AgentProposalRecord,
  input: ListAgentProposalsStoreInput,
): boolean {
  if (input.targetRef && record.targetRef !== input.targetRef) return false;
  if (input.baseCommitId && record.baseCommitId !== input.baseCommitId) return false;
  if (input.proposalCommitId && record.proposalCommitId !== input.proposalCommitId) return false;
  if (input.proposalBranchName && record.proposalBranchName !== input.proposalBranchName)
    return false;
  if (input.status && record.status !== input.status) return false;
  if (input.agentRunId && record.agentRunId !== input.agentRunId) return false;
  return true;
}

function compareProposalsForList(left: AgentProposalRecord, right: AgentProposalRecord): number {
  if (left.updatedAt > right.updatedAt) return -1;
  if (left.updatedAt < right.updatedAt) return 1;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function proposalSummary(record: AgentProposalRecord): AgentProposalSummary {
  return {
    id: record.id,
    documentId: record.documentId,
    title: record.title,
    targetRef: record.targetRef,
    baseCommitId: record.baseCommitId,
    targetHeadIdAtCreation: record.targetHeadIdAtCreation,
    ...(record.targetRefVersionAtCreation === undefined
      ? {}
      : { targetRefVersionAtCreation: record.targetRefVersionAtCreation }),
    proposalBranchName: record.proposalBranchName,
    ...(record.proposalCommitId === undefined ? {} : { proposalCommitId: record.proposalCommitId }),
    status: record.status,
    revision: record.revision,
    agentRunId: record.agentRunId,
    agent: cloneJson(record.agent),
    updatedAt: record.updatedAt,
  };
}

function parseProposalListCursor(
  cursor: PageCursor | undefined,
):
  | { readonly ok: true; readonly offset: number }
  | { readonly ok: false; readonly result: VersionResult<Paged<AgentProposalSummary>> } {
  if (cursor === undefined) return { ok: true, offset: 0 };
  if (!cursor.startsWith(PROPOSAL_LIST_CURSOR_PREFIX)) {
    return {
      ok: false,
      result: invalidState<Paged<AgentProposalSummary>>(
        'stale_proposal_cursor',
        ['valid_cursor'],
        'Proposal list cursor is not valid for this store.',
      ),
    };
  }
  const offset = Number(cursor.slice(PROPOSAL_LIST_CURSOR_PREFIX.length));
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return {
      ok: false,
      result: invalidState<Paged<AgentProposalSummary>>(
        'stale_proposal_cursor',
        ['valid_cursor'],
        'Proposal list cursor has an invalid offset.',
      ),
    };
  }
  return { ok: true, offset };
}

function proposalListCursor(offset: number): PageCursor {
  return `${PROPOSAL_LIST_CURSOR_PREFIX}${offset}` as PageCursor;
}
