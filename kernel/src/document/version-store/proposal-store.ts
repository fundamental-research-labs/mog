import type {
  PageCursor,
  Paged,
  RedactionPolicy,
  RedactionSummary,
  VersionAuthor,
  VersionDiagnostic,
  VersionResult,
  VerificationSummary,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import {
  agentProposalStorageKey,
  cloneAgentProposalRecord,
  cloneAgentProposalRow,
  isRecord,
} from './proposal-store-codec';
import { listAgentProposalRecords } from './proposal-store-listing';
import {
  clientRequestIdWasUsed,
  createProposalFingerprint,
  idempotencyResult,
  mutationFingerprint,
  proposalIdForCreate,
  updateProposalFingerprint,
} from './proposal-store-mutations';
import {
  appendMutationLog,
  applyStatusUpdate,
  createProposalRecord,
  createProposalRow,
} from './proposal-store-records';
import {
  invalidClientRequestReuse,
  invalidState,
  notFound,
  ok,
  staleRevision,
} from './proposal-store-results';
import type { AgentProposalStatus } from './proposal-store-status';
import { validateCreateProposalInput, validateStatusUpdate } from './proposal-store-validation';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';

export type AgentProposalId = `proposal:sha256:${string}`;

export { AGENT_PROPOSAL_STATUSES } from './proposal-store-status';
export type { AgentProposalStatus } from './proposal-store-status';
export { proposalIdForCreate };

export type AgentProposalAcceptance = {
  readonly targetRef: string;
  readonly appliedCommitId: WorkbookCommitId;
  readonly expectedTargetHeadId?: string;
  readonly refUpdateReceiptId?: string;
};

export type AgentProposalTrustedIdentity = {
  readonly actor: VersionAuthor;
  readonly agent: VersionAuthor;
  readonly agentRunId: string;
};

export type AgentProposalSummary = {
  readonly id: AgentProposalId;
  readonly documentId: string;
  readonly title: string;
  readonly targetRef: string;
  readonly baseCommitId: WorkbookCommitId;
  readonly targetHeadIdAtCreation: string;
  readonly proposalBranchName: string;
  readonly proposalCommitId?: WorkbookCommitId;
  readonly status: AgentProposalStatus;
  readonly revision: number;
  readonly agentRunId: string;
  readonly agent: VersionAuthor;
  readonly updatedAt: string;
};

export type AgentProposalRecord = AgentProposalSummary & {
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly createdBy: VersionAuthor;
  readonly lastActor?: VersionAuthor;
  readonly workspaceId?: string;
  readonly reviewId?: string;
  readonly verification?: VerificationSummary;
  readonly accepted?: AgentProposalAcceptance;
  readonly supersededByProposalId?: string;
  readonly rejectionReason?: string;
  readonly failureReason?: string;
  readonly supersedeReason?: string;
  readonly redaction: RedactionSummary;
  readonly diagnostics: readonly VersionDiagnostic[];
};

export type CreateAgentProposalStoreInput = {
  readonly clientRequestId: string;
  readonly title: string;
  readonly targetRef: string;
  readonly baseCommitId: WorkbookCommitId;
  readonly targetHeadIdAtCreation: string;
  readonly proposalBranchName: string;
  readonly redactionPolicy: RedactionPolicy;
  readonly trustedIdentity: AgentProposalTrustedIdentity;
  readonly createdAt?: string;
};

export type UpdateAgentProposalStoreInput = {
  readonly clientRequestId: string;
  readonly proposalId: AgentProposalId | string;
  readonly expectedRevision: number;
  readonly status: AgentProposalStatus;
  readonly trustedActor: VersionAuthor;
  readonly workspaceId?: string;
  readonly proposalCommitId?: WorkbookCommitId;
  readonly reviewId?: string;
  readonly verification?: VerificationSummary;
  readonly accepted?: AgentProposalAcceptance;
  readonly supersededByProposalId?: AgentProposalId | string;
  readonly diagnostics?: readonly VersionDiagnostic[];
  readonly reason?: string;
  readonly updatedAt?: string;
};

export type ListAgentProposalsStoreInput = {
  readonly targetRef?: string;
  readonly baseCommitId?: WorkbookCommitId;
  readonly proposalCommitId?: WorkbookCommitId;
  readonly proposalBranchName?: string;
  readonly status?: AgentProposalStatus;
  readonly agentRunId?: string;
  readonly cursor?: PageCursor;
  readonly limit?: number;
};

export interface AgentProposalMetadataStore {
  readonly documentScope: VersionDocumentScope;
  createProposal(input: CreateAgentProposalStoreInput): Promise<VersionResult<AgentProposalRecord>>;
  getProposal(proposalId: AgentProposalId | string): Promise<VersionResult<AgentProposalRecord>>;
  getProposalByWorkspaceId(workspaceId: string): Promise<VersionResult<AgentProposalRecord>>;
  listProposals(
    input: ListAgentProposalsStoreInput,
  ): Promise<VersionResult<Paged<AgentProposalSummary>>>;
  updateProposal(input: UpdateAgentProposalStoreInput): Promise<VersionResult<AgentProposalRecord>>;
}

export type AgentProposalMetadataStoreProvider = {
  openAgentProposalMetadataStore(): Promise<AgentProposalMetadataStore>;
};

export type AgentProposalMutationOperation = 'createProposal' | 'updateProposal';

export type AgentProposalMutationLogEntry = {
  readonly schemaVersion: 1;
  readonly operation: AgentProposalMutationOperation;
  readonly clientRequestId: string;
  readonly fingerprint: string;
  readonly resultRecord: AgentProposalRecord;
  readonly recordedAt: string;
};

export type AgentProposalStoreRow = {
  readonly schemaVersion: 1;
  readonly operation: 'agent-proposal-record';
  readonly documentScopeKey: string;
  readonly proposalId: AgentProposalId;
  readonly documentId: string;
  readonly targetRef: string;
  readonly baseCommitId: WorkbookCommitId;
  readonly proposalCommitId?: WorkbookCommitId;
  readonly proposalBranchName: string;
  readonly agentRunId: string;
  readonly status: AgentProposalStatus;
  readonly updatedAt: string;
  readonly createClientRequestId: string;
  readonly record: AgentProposalRecord;
  readonly mutationLog: readonly AgentProposalMutationLogEntry[];
};

export type AgentProposalMetadataMemoryBackendSnapshot = {
  readonly rows: readonly AgentProposalStoreRow[];
};

export {
  agentProposalStorageKey,
  decodeStoredAgentProposalRow,
  storedAgentProposalRow,
} from './proposal-store-codec';

export type AgentProposalStoreAdapter = {
  readRow(proposalId: AgentProposalId | string): Promise<AgentProposalStoreRow | undefined>;
  listRows(): Promise<readonly AgentProposalStoreRow[]>;
  mutateRow<T>(
    proposalId: AgentProposalId | string,
    mutator: (row: AgentProposalStoreRow | undefined) => AgentProposalRowMutation<T>,
  ): Promise<VersionResult<T>>;
  mutateRows<T>(
    mutator: (rows: readonly AgentProposalStoreRow[]) => AgentProposalRowMutation<T>,
  ): Promise<VersionResult<T>>;
};

export type AgentProposalRowMutation<T> =
  | {
      readonly action: 'put';
      readonly row: AgentProposalStoreRow;
      readonly result: VersionResult<T>;
    }
  | { readonly action: 'none'; readonly result: VersionResult<T> };

export class AgentProposalMetadataMemoryBackend {
  private readonly rowsByKey = new Map<string, AgentProposalStoreRow>();

  get(
    documentScopeKey: string,
    proposalId: AgentProposalId | string,
  ): AgentProposalStoreRow | undefined {
    return cloneAgentProposalRow(
      this.rowsByKey.get(agentProposalStorageKey(documentScopeKey, proposalId)),
    );
  }

  put(row: AgentProposalStoreRow): void {
    this.rowsByKey.set(
      agentProposalStorageKey(row.documentScopeKey, row.proposalId),
      cloneAgentProposalRow(row),
    );
  }

  list(documentScopeKey: string): readonly AgentProposalStoreRow[] {
    return [...this.rowsByKey.values()]
      .filter((row) => row.documentScopeKey === documentScopeKey)
      .map((row) => cloneAgentProposalRow(row));
  }

  exportSnapshot(): AgentProposalMetadataMemoryBackendSnapshot {
    return { rows: [...this.rowsByKey.values()].map((row) => cloneAgentProposalRow(row)) };
  }

  static fromSnapshot(
    snapshot: AgentProposalMetadataMemoryBackendSnapshot,
  ): AgentProposalMetadataMemoryBackend {
    const backend = new AgentProposalMetadataMemoryBackend();
    for (const row of snapshot.rows) backend.put(row);
    return backend;
  }
}

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
    return this.adapter.mutateRow<AgentProposalRecord>(input.proposalId, (row) => {
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

export class InMemoryAgentProposalMetadataStore
  extends AgentProposalMetadataStoreImpl
  implements AgentProposalMetadataStore
{
  constructor(options: {
    readonly documentScope: VersionDocumentScope;
    readonly backend: AgentProposalMetadataMemoryBackend;
  }) {
    const documentScope = normalizeVersionDocumentScope(options.documentScope);
    const documentScopeKey = versionDocumentScopeKey(documentScope);
    super({
      documentScope,
      adapter: {
        async readRow(proposalId) {
          return options.backend.get(documentScopeKey, proposalId);
        },
        async listRows() {
          return options.backend.list(documentScopeKey);
        },
        async mutateRow(proposalId, mutator) {
          const result = mutator(options.backend.get(documentScopeKey, proposalId));
          if (result.action === 'put') options.backend.put(result.row);
          return result.result;
        },
        async mutateRows(mutator) {
          const result = mutator(options.backend.list(documentScopeKey));
          if (result.action === 'put') options.backend.put(result.row);
          return result.result;
        },
      },
    });
  }
}

export function hasAgentProposalMetadataStoreProvider(
  value: unknown,
): value is AgentProposalMetadataStoreProvider {
  return isRecord(value) && typeof value.openAgentProposalMetadataStore === 'function';
}
