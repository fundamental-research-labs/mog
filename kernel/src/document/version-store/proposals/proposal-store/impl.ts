import type { Paged, VersionResult } from '@mog-sdk/contracts/api';

import { cloneAgentProposalRecord } from './codec';
import { listAgentProposalRecords } from './listing';
import {
  clientRequestIdWasUsed,
  createProposalFingerprint,
  idempotencyResult,
  mutationFingerprint,
  proposalIdForCreate,
  updateProposalFingerprint,
} from './mutations';
import {
  appendMutationLog,
  applyStatusUpdate,
  createProposalRecord,
  createProposalRow,
} from './records';
import { invalidClientRequestReuse, invalidState, notFound, ok, staleRevision } from './results';
import type {
  AgentProposalId,
  AgentProposalMetadataStore,
  AgentProposalRecord,
  AgentProposalStoreAdapter,
  AgentProposalStoreRow,
  AgentProposalSummary,
  CreateAgentProposalStoreInput,
  ListAgentProposalsStoreInput,
  UpdateAgentProposalStoreInput,
} from './types';
import { validateCreateProposalInput, validateStatusUpdate } from './validation';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from '../../registry';

export class AgentProposalMetadataStoreImpl implements AgentProposalMetadataStore {
  readonly documentScope: VersionDocumentScope;

  private readonly adapter: AgentProposalStoreAdapter;
  private readonly documentScopeKey: string;

  constructor(options: {
    readonly documentScope: VersionDocumentScope;
    readonly adapter: AgentProposalStoreAdapter;
  }) {
    this.documentScope = normalizeVersionDocumentScope(options.documentScope);
    this.documentScopeKey = versionDocumentScopeKey(this.documentScope);
    this.adapter = options.adapter;
  }

  async createProposal(
    input: CreateAgentProposalStoreInput,
  ): Promise<VersionResult<AgentProposalRecord>> {
    const valid = validateCreateProposalInput(input);
    if (!valid.ok) return valid.result;

    const proposalId = await proposalIdForCreate(this.documentScopeKey, input.clientRequestId);
    const fingerprint = mutationFingerprint('createProposal', createProposalFingerprint(input));
    const createdAt = input.createdAt ?? new Date().toISOString();
    return this.adapter.mutateRows<AgentProposalRecord>((rows) => {
      const existing = rows.find((row) => row.record.id === proposalId);
      if (existing) {
        const idempotent = idempotencyResult<AgentProposalRecord>(
          existing,
          'createProposal',
          input.clientRequestId,
          fingerprint,
        );
        return { action: 'none', result: idempotent ?? invalidClientRequestReuse() };
      }

      const record = createProposalRecord({
        documentScope: this.documentScope,
        proposalId,
        input,
        createdAt,
      });
      const row = createProposalRow({
        documentScopeKey: this.documentScopeKey,
        proposalId,
        createClientRequestId: input.clientRequestId,
        record,
        fingerprint,
        recordedAt: createdAt,
      });
      return { action: 'put', row, result: ok(cloneAgentProposalRecord(record)) };
    });
  }

  async getProposal(
    proposalId: AgentProposalId | string,
  ): Promise<VersionResult<AgentProposalRecord>> {
    const row = await this.adapter.readRow(proposalId);
    return row ? ok(cloneAgentProposalRecord(row.record)) : notFound(proposalId);
  }

  async getProposalByWorkspaceId(workspaceId: string): Promise<VersionResult<AgentProposalRecord>> {
    const rows = await this.adapter.listRows();
    const matches = rows
      .map((row) => row.record)
      .filter((record) => record.workspaceId === workspaceId);
    if (matches.length === 0) return notFound(workspaceId);
    if (matches.length > 1) {
      return invalidState(
        'duplicate_proposal_workspace_binding',
        ['unique_workspace_id'],
        'Proposal workspace id must identify exactly one proposal.',
      );
    }
    return ok(cloneAgentProposalRecord(matches[0]!));
  }

  async listProposals(
    input: ListAgentProposalsStoreInput = {},
  ): Promise<VersionResult<Paged<AgentProposalSummary>>> {
    const rows = await this.adapter.listRows();
    return listAgentProposalRecords(
      rows.map((row) => row.record),
      input,
    );
  }

  async updateProposal(
    input: UpdateAgentProposalStoreInput,
  ): Promise<VersionResult<AgentProposalRecord>> {
    const fingerprint = mutationFingerprint('updateProposal', updateProposalFingerprint(input));
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    return this.adapter.mutateRows<AgentProposalRecord>((rows) => {
      const row = rows.find((item) => item.record.id === input.proposalId);
      if (!row) return { action: 'none', result: notFound(input.proposalId) };
      const idempotent = idempotencyResult<AgentProposalRecord>(
        row,
        'updateProposal',
        input.clientRequestId,
        fingerprint,
      );
      if (idempotent) return { action: 'none', result: idempotent };
      if (clientRequestIdWasUsed(row, input.clientRequestId)) {
        return { action: 'none', result: invalidClientRequestReuse() };
      }
      if (row.record.revision !== input.expectedRevision) {
        return {
          action: 'none',
          result: staleRevision(input.expectedRevision, row.record.revision),
        };
      }

      const valid = validateStatusUpdate(row.record, input);
      if (!valid.ok) return { action: 'none', result: valid.result };
      const uniqueWorkspace = validateWorkspaceBindingUniqueness(rows, row.record, input);
      if (!uniqueWorkspace.ok) return { action: 'none', result: uniqueWorkspace.result };

      const record = applyStatusUpdate(row.record, input, updatedAt);
      const updatedRow = appendMutationLog(row, {
        operation: 'updateProposal',
        clientRequestId: input.clientRequestId,
        fingerprint,
        resultRecord: record,
        recordedAt: updatedAt,
      });
      return { action: 'put', row: updatedRow, result: ok(cloneAgentProposalRecord(record)) };
    });
  }
}

function validateWorkspaceBindingUniqueness(
  rows: readonly AgentProposalStoreRow[],
  record: AgentProposalRecord,
  input: UpdateAgentProposalStoreInput,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<AgentProposalRecord> } {
  if (input.workspaceId === undefined) return { ok: true };
  const existing = rows.find(
    (row) => row.record.workspaceId === input.workspaceId && row.record.id !== record.id,
  );
  if (!existing) return { ok: true };
  return {
    ok: false,
    result: invalidState(
      'duplicate_proposal_workspace_binding',
      ['unique_workspace_id'],
      'Proposal workspace id must identify exactly one proposal.',
    ),
  };
}
