import type {
  PageCursor,
  Paged,
  RedactionPolicy,
  RedactionSummary,
  VersionDiagnostic,
  VersionResult,
  VerificationSummary,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { objectDigestFor } from './merge-apply-intent-store';
import {
  agentProposalRowWithIndexes,
  agentProposalStorageKey,
  canonicalJsonStringify,
  cloneAgentProposalRecord,
  cloneAgentProposalRow,
  cloneJson,
  isRecord,
} from './proposal-store-codec';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';

const DEFAULT_PROPOSAL_LIST_LIMIT = 50;
const PROPOSAL_LIST_CURSOR_PREFIX = 'proposal-list:';

export type AgentProposalId = `proposal:sha256:${string}`;

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
      const row = agentProposalRowWithIndexes({
        schemaVersion: 1,
        operation: 'agent-proposal-record',
        documentScopeKey: this.documentScopeKey,
        proposalId,
        documentId: record.documentId,
        targetRef: record.targetRef,
        baseCommitId: record.baseCommitId,
        ...(record.proposalCommitId === undefined
          ? {}
          : { proposalCommitId: record.proposalCommitId }),
        proposalBranchName: record.proposalBranchName,
        agentRunId: record.agentRunId,
        status: record.status,
        updatedAt: record.updatedAt,
        createClientRequestId: input.clientRequestId,
        record,
        mutationLog: [
          {
            schemaVersion: 1,
            operation: 'createProposal',
            clientRequestId: input.clientRequestId,
            fingerprint,
            resultRecord: cloneAgentProposalRecord(record),
            recordedAt: createdAt,
          },
        ],
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

  async listProposals(
    input: ListAgentProposalsStoreInput = {},
  ): Promise<VersionResult<Paged<AgentProposalSummary>>> {
    const cursor = parseProposalListCursor(input.cursor);
    if (!cursor.ok) return cursor.result;

    const limit = input.limit ?? DEFAULT_PROPOSAL_LIST_LIMIT;
    const rows = await this.adapter.listRows();
    const filtered = rows
      .map((row) => row.record)
      .filter((record) => proposalMatchesListInput(record, input))
      .sort(compareProposalsForList);
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

function createProposalRecord(input: {
  readonly documentScope: VersionDocumentScope;
  readonly proposalId: AgentProposalId;
  readonly input: CreateAgentProposalStoreInput;
  readonly createdAt: string;
}): AgentProposalRecord {
  return cloneAgentProposalRecord({
    schemaVersion: 1,
    id: input.proposalId,
    documentId: input.documentScope.documentId,
    title: input.input.title,
    targetRef: input.input.targetRef,
    baseCommitId: input.input.baseCommitId,
    targetHeadIdAtCreation: input.input.targetHeadIdAtCreation,
    proposalBranchName: input.input.proposalBranchName,
    status: 'draft',
    revision: 1,
    agentRunId: input.input.trustedIdentity.agentRunId,
    agent: cloneJson(input.input.trustedIdentity.agent),
    createdAt: input.createdAt,
    createdBy: cloneJson(input.input.trustedIdentity.actor),
    updatedAt: input.createdAt,
    redaction: {
      policy: cloneJson(input.input.redactionPolicy),
      redactedFields: [],
      diagnostics: [],
    },
    diagnostics: [],
  });
}

function applyStatusUpdate(
  record: AgentProposalRecord,
  input: UpdateAgentProposalStoreInput,
  updatedAt: string,
): AgentProposalRecord {
  const diagnostics =
    input.diagnostics === undefined
      ? record.diagnostics
      : [...record.diagnostics, ...input.diagnostics.map((item) => cloneJson(item))];
  const base: AgentProposalRecord = {
    ...record,
    status: input.status,
    revision: record.revision + 1,
    updatedAt,
    lastActor: cloneJson(input.trustedActor),
    diagnostics,
    ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
    ...(input.proposalCommitId === undefined ? {} : { proposalCommitId: input.proposalCommitId }),
    ...(input.reviewId === undefined ? {} : { reviewId: input.reviewId }),
    ...(input.verification === undefined ? {} : { verification: cloneJson(input.verification) }),
  };

  if (input.status === 'applied') {
    return cloneAgentProposalRecord({
      ...base,
      accepted: cloneJson(input.accepted),
      proposalCommitId: base.proposalCommitId ?? input.accepted?.appliedCommitId,
    });
  }
  if (input.status === 'rejected') {
    return cloneAgentProposalRecord({
      ...base,
      ...(input.reason === undefined ? {} : { rejectionReason: input.reason }),
    });
  }
  if (input.status === 'failed') {
    return cloneAgentProposalRecord({
      ...base,
      ...(input.reason === undefined ? {} : { failureReason: input.reason }),
    });
  }
  if (input.status === 'superseded') {
    return cloneAgentProposalRecord({
      ...base,
      ...(input.supersededByProposalId === undefined
        ? {}
        : { supersededByProposalId: input.supersededByProposalId }),
      ...(input.reason === undefined ? {} : { supersedeReason: input.reason }),
    });
  }
  return cloneAgentProposalRecord(base);
}

function appendMutationLog(
  row: AgentProposalStoreRow,
  input: Omit<AgentProposalMutationLogEntry, 'schemaVersion'>,
): AgentProposalStoreRow {
  return agentProposalRowWithIndexes({
    ...row,
    record: cloneAgentProposalRecord(input.resultRecord),
    mutationLog: [
      ...row.mutationLog,
      {
        schemaVersion: 1,
        operation: input.operation,
        clientRequestId: input.clientRequestId,
        fingerprint: input.fingerprint,
        resultRecord: cloneAgentProposalRecord(input.resultRecord),
        recordedAt: input.recordedAt,
      },
    ],
  });
}

function idempotencyResult<T>(
  row: AgentProposalStoreRow,
  operation: AgentProposalMutationOperation,
  clientRequestId: string,
  fingerprint: string,
): VersionResult<T> | null {
  const entry = row.mutationLog.find((item) => item.clientRequestId === clientRequestId);
  if (!entry) return null;
  if (entry.operation !== operation || entry.fingerprint !== fingerprint) {
    return invalidClientRequestReuse();
  }
  return ok(cloneAgentProposalRecord(entry.resultRecord) as T);
}

function clientRequestIdWasUsed(row: AgentProposalStoreRow, clientRequestId: string): boolean {
  return row.mutationLog.some((entry) => entry.clientRequestId === clientRequestId);
}

function createProposalFingerprint(input: CreateAgentProposalStoreInput): unknown {
  return {
    clientRequestId: input.clientRequestId,
    title: input.title,
    targetRef: input.targetRef,
    baseCommitId: input.baseCommitId,
    targetHeadIdAtCreation: input.targetHeadIdAtCreation,
    proposalBranchName: input.proposalBranchName,
    redactionPolicy: input.redactionPolicy,
    trustedIdentity: input.trustedIdentity,
  };
}

function updateProposalFingerprint(input: UpdateAgentProposalStoreInput): unknown {
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

function mutationFingerprint(operation: AgentProposalMutationOperation, value: unknown): string {
  return `${operation}:${canonicalJsonStringify(value)}`;
}

function validateCreateProposalInput(
  input: CreateAgentProposalStoreInput,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<AgentProposalRecord> } {
  if (!input.clientRequestId) {
    return invalidCreate(
      'missing_client_request_id',
      ['clientRequestId'],
      'clientRequestId is required.',
    );
  }
  if (!input.title) return invalidCreate('missing_title', ['title'], 'Proposal title is required.');
  if (!input.targetRef) {
    return invalidCreate('missing_target_ref', ['targetRef'], 'Proposal target ref is required.');
  }
  if (!input.baseCommitId) {
    return invalidCreate(
      'missing_base_commit',
      ['baseCommitId'],
      'Proposal base commit is required.',
    );
  }
  if (!input.targetHeadIdAtCreation) {
    return invalidCreate(
      'missing_target_head',
      ['targetHeadIdAtCreation'],
      'Proposal target head at creation is required.',
    );
  }
  if (!input.proposalBranchName) {
    return invalidCreate(
      'missing_proposal_branch',
      ['proposalBranchName'],
      'Proposal branch name is required.',
    );
  }
  if (!isRecord(input.trustedIdentity)) {
    return invalidCreate(
      'invalid_trusted_identity',
      ['trustedIdentity'],
      'Trusted proposal identity must be supplied by the proposal service.',
    );
  }
  if (!input.trustedIdentity.agentRunId) {
    return invalidCreate(
      'missing_agent_run_id',
      ['trustedIdentity.agentRunId'],
      'Trusted proposal identity must include an agent run id.',
    );
  }
  if (
    !isVersionAuthor(input.trustedIdentity.actor) ||
    !isVersionAuthor(input.trustedIdentity.agent)
  ) {
    return invalidCreate(
      'invalid_trusted_identity',
      ['trustedIdentity'],
      'Trusted proposal identity must include actor and agent authors.',
    );
  }
  return { ok: true };
}

function validateStatusUpdate(
  record: AgentProposalRecord,
  input: UpdateAgentProposalStoreInput,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<AgentProposalRecord> } {
  if (!isAgentProposalStatus(input.status)) {
    return invalidUpdate(
      'invalid_proposal_status',
      [...AGENT_PROPOSAL_STATUSES],
      'Proposal status is not supported.',
    );
  }
  if (input.status === 'draft') {
    return invalidUpdate(
      'proposal_already_created',
      ['workspace_open', 'rejected', 'failed', 'superseded'],
      'Draft proposals are created, not updated back to draft.',
    );
  }
  const allowed = allowedProposalTransitions(record.status);
  if (!allowed.includes(input.status)) {
    return invalidUpdate(
      'proposal_status_transition',
      allowed,
      `Cannot update proposal status from ${record.status} to ${input.status}.`,
    );
  }
  if (input.status === 'workspace_open' && !input.workspaceId) {
    return invalidUpdate(
      'proposal_workspace_required',
      ['workspaceId'],
      'Workspace-open proposals require a workspace id.',
    );
  }
  if (input.status === 'committed' && !input.proposalCommitId) {
    return invalidUpdate(
      'proposal_commit_required',
      ['proposalCommitId'],
      'Committed proposals require a proposal commit id.',
    );
  }
  if (
    input.status === 'verified' &&
    (!input.verification || input.verification.status !== 'passed')
  ) {
    return invalidUpdate(
      'proposal_verification_required',
      ['passed_verification'],
      'Verified proposals require passed verification.',
    );
  }
  if (input.status === 'ready_for_review' && !input.reviewId) {
    return invalidUpdate(
      'proposal_review_required',
      ['reviewId'],
      'Ready-for-review proposals require a review id.',
    );
  }
  if (input.status === 'applied' && !input.accepted) {
    return invalidUpdate(
      'proposal_acceptance_required',
      ['accepted'],
      'Applied proposals require acceptance metadata.',
    );
  }
  if (
    input.status === 'failed' &&
    (!input.diagnostics || input.diagnostics.length === 0) &&
    !input.reason &&
    input.verification?.status !== 'failed' &&
    input.verification?.status !== 'blocked'
  ) {
    return invalidUpdate(
      'proposal_failure_required',
      ['diagnostics', 'reason', 'failed_verification'],
      'Failed proposals require failure evidence.',
    );
  }
  return { ok: true };
}

function allowedProposalTransitions(status: AgentProposalStatus): readonly AgentProposalStatus[] {
  switch (status) {
    case 'draft':
      return ['workspace_open', 'rejected', 'failed', 'superseded'];
    case 'workspace_open':
      return ['committed', 'rejected', 'failed', 'superseded'];
    case 'committed':
      return ['verified', 'rejected', 'failed', 'superseded'];
    case 'verified':
      return ['ready_for_review', 'rejected', 'failed', 'superseded'];
    case 'ready_for_review':
      return ['applied', 'merge_conflicted', 'stale', 'rejected', 'failed', 'superseded'];
    case 'merge_conflicted':
    case 'stale':
    case 'rejected':
    case 'failed':
      return ['superseded'];
    case 'applied':
    case 'superseded':
      return [];
  }
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

function ok<T>(value: T): VersionResult<T> {
  return { ok: true, value };
}

function notFound<T>(proposalId: AgentProposalId | string): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'not_found',
      target: 'workbook.version.proposal',
      reason: `Proposal record ${proposalId} was not found.`,
    },
  };
}

function staleRevision<T>(expectedRevision: number, actualRevision: number): VersionResult<T> {
  return {
    ok: false,
    error: { code: 'stale_revision', expectedRevision, actualRevision },
  };
}

function invalidClientRequestReuse<T>(): VersionResult<T> {
  return invalidState<T>(
    'proposal_client_request_reused',
    ['idempotent_retry'],
    'clientRequestId is already bound to a different proposal mutation payload.',
  );
}

function invalidCreate(
  state: string,
  allowed: readonly string[],
  reason: string,
): { readonly ok: false; readonly result: VersionResult<AgentProposalRecord> } {
  return { ok: false, result: invalidState<AgentProposalRecord>(state, allowed, reason) };
}

function invalidUpdate(
  state: string,
  allowed: readonly string[],
  reason: string,
): { readonly ok: false; readonly result: VersionResult<AgentProposalRecord> } {
  return { ok: false, result: invalidState<AgentProposalRecord>(state, allowed, reason) };
}

function invalidState<T>(
  state: string,
  allowed: readonly string[],
  reason: string,
): VersionResult<T> {
  return { ok: false, error: { code: 'invalid_state', state, allowed, reason } };
}

function isAgentProposalStatus(value: unknown): value is AgentProposalStatus {
  return AGENT_PROPOSAL_STATUSES.includes(value as AgentProposalStatus);
}

function isVersionAuthor(value: unknown): value is VersionAuthor {
  return (
    isRecord(value) &&
    typeof value.kind === 'string' &&
    typeof value.trust === 'string' &&
    (value.displayName === undefined || typeof value.displayName === 'string') &&
    (value.principalId === undefined || typeof value.principalId === 'string') &&
    (value.agentRunId === undefined || typeof value.agentRunId === 'string')
  );
}
