import type {
  AgentProposalAcceptance,
  AgentProposalId,
  AgentProposalRecord,
  AgentProposalStatus,
  AgentProposalStoreRow,
  AgentProposalMutationLogEntry,
} from './types';
import type { RedactionSummary, VersionAuthor } from '@mog-sdk/contracts/api';

const PROPOSAL_ID_RE = /^proposal:sha256:[0-9a-f]{64}$/;
const AGENT_PROPOSAL_STATUS_VALUES = Object.freeze([
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

export function agentProposalStorageKey(
  documentScopeKey: string,
  proposalId: AgentProposalId | string,
): string {
  return `${documentScopeKey}\u0000proposal\u0000${proposalId}`;
}

export function storedAgentProposalRow(row: AgentProposalStoreRow): AgentProposalStoreRow {
  return cloneAgentProposalRow(agentProposalRowWithIndexes(row));
}

export function decodeStoredAgentProposalRow(
  value: unknown,
  documentScopeKey: string,
): AgentProposalStoreRow | null {
  if (!isAgentProposalStoreRow(value)) return null;
  return value.documentScopeKey === documentScopeKey
    ? cloneAgentProposalRow(agentProposalRowWithIndexes(value))
    : null;
}

export function agentProposalRowWithIndexes(row: AgentProposalStoreRow): AgentProposalStoreRow {
  const record = cloneAgentProposalRecord(row.record);
  return cloneAgentProposalRow({
    schemaVersion: row.schemaVersion,
    operation: row.operation,
    documentScopeKey: row.documentScopeKey,
    proposalId: record.id,
    documentId: record.documentId,
    targetRef: record.targetRef,
    baseCommitId: record.baseCommitId,
    ...(record.proposalCommitId === undefined ? {} : { proposalCommitId: record.proposalCommitId }),
    proposalBranchName: record.proposalBranchName,
    agentRunId: record.agentRunId,
    status: record.status,
    updatedAt: record.updatedAt,
    createClientRequestId: row.createClientRequestId,
    record,
    mutationLog: row.mutationLog,
  });
}

export function cloneAgentProposalRow(row: AgentProposalStoreRow): AgentProposalStoreRow;
export function cloneAgentProposalRow(row: undefined): undefined;
export function cloneAgentProposalRow(
  row: AgentProposalStoreRow | undefined,
): AgentProposalStoreRow | undefined;
export function cloneAgentProposalRow(
  row: AgentProposalStoreRow | undefined,
): AgentProposalStoreRow | undefined {
  return row === undefined ? undefined : cloneJson(row);
}

export function cloneAgentProposalRecord(record: AgentProposalRecord): AgentProposalRecord {
  return cloneJson(record);
}

export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical JSON number must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJsonStringify).join(',')}]`;
  if (!isRecord(value)) throw new Error('value must be canonical JSON');
  return `{${Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(value[key])}`)
    .join(',')}}`;
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isAgentProposalStoreRow(value: unknown): value is AgentProposalStoreRow {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (value.operation !== 'agent-proposal-record') return false;
  if (typeof value.documentScopeKey !== 'string') return false;
  if (typeof value.createClientRequestId !== 'string') return false;
  if (!isAgentProposalRecord(value.record)) return false;
  if (!Array.isArray(value.mutationLog) || !value.mutationLog.every(isMutationLogEntry)) {
    return false;
  }
  return (
    value.proposalId === value.record.id &&
    value.documentId === value.record.documentId &&
    value.targetRef === value.record.targetRef &&
    value.baseCommitId === value.record.baseCommitId &&
    value.proposalCommitId === value.record.proposalCommitId &&
    value.proposalBranchName === value.record.proposalBranchName &&
    value.agentRunId === value.record.agentRunId &&
    value.status === value.record.status &&
    value.updatedAt === value.record.updatedAt
  );
}

function isMutationLogEntry(value: unknown): value is AgentProposalMutationLogEntry {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    (value.operation === 'createProposal' || value.operation === 'updateProposal') &&
    typeof value.clientRequestId === 'string' &&
    typeof value.fingerprint === 'string' &&
    isAgentProposalRecord(value.resultRecord) &&
    typeof value.recordedAt === 'string'
  );
}

function isAgentProposalRecord(value: unknown): value is AgentProposalRecord {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (typeof value.id !== 'string' || !PROPOSAL_ID_RE.test(value.id)) return false;
  if (typeof value.documentId !== 'string') return false;
  if (typeof value.title !== 'string') return false;
  if (typeof value.targetRef !== 'string') return false;
  if (typeof value.baseCommitId !== 'string') return false;
  if (typeof value.targetHeadIdAtCreation !== 'string') return false;
  if (
    value.targetRefVersionAtCreation !== undefined &&
    !isRefVersion(value.targetRefVersionAtCreation)
  ) {
    return false;
  }
  if (typeof value.proposalBranchName !== 'string') return false;
  if (!isAgentProposalStatus(value.status)) return false;
  if (typeof value.revision !== 'number' || !Number.isInteger(value.revision) || value.revision < 1)
    return false;
  if (typeof value.agentRunId !== 'string') return false;
  if (!isVersionAuthor(value.agent) || !isVersionAuthor(value.createdBy)) return false;
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return false;
  if (!isRedactionSummary(value.redaction)) return false;
  if (!Array.isArray(value.diagnostics)) return false;
  if (value.lastActor !== undefined && !isVersionAuthor(value.lastActor)) return false;
  if (value.proposalCommitId !== undefined && typeof value.proposalCommitId !== 'string')
    return false;
  if (value.workspaceId !== undefined && typeof value.workspaceId !== 'string') return false;
  if (value.reviewId !== undefined && typeof value.reviewId !== 'string') return false;
  if (value.verification !== undefined && !isRecord(value.verification)) return false;
  if (value.accepted !== undefined && !isAgentProposalAcceptance(value.accepted)) return false;
  if (
    value.supersededByProposalId !== undefined &&
    typeof value.supersededByProposalId !== 'string'
  ) {
    return false;
  }
  if (value.rejectionReason !== undefined && typeof value.rejectionReason !== 'string')
    return false;
  if (value.failureReason !== undefined && typeof value.failureReason !== 'string') return false;
  if (value.supersedeReason !== undefined && typeof value.supersedeReason !== 'string')
    return false;
  return true;
}

function isRefVersion(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.kind === 'counter' &&
    typeof value.value === 'string' &&
    /^(0|[1-9][0-9]*)$/.test(value.value)
  );
}

function isAgentProposalAcceptance(value: unknown): value is AgentProposalAcceptance {
  return (
    isRecord(value) &&
    typeof value.targetRef === 'string' &&
    typeof value.appliedCommitId === 'string' &&
    (value.expectedTargetHeadId === undefined || typeof value.expectedTargetHeadId === 'string') &&
    (value.refUpdateReceiptId === undefined || typeof value.refUpdateReceiptId === 'string')
  );
}

function isAgentProposalStatus(value: unknown): value is AgentProposalStatus {
  return AGENT_PROPOSAL_STATUS_VALUES.includes(value as AgentProposalStatus);
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

function isRedactionSummary(value: unknown): value is RedactionSummary {
  return (
    isRecord(value) &&
    isRecord(value.policy) &&
    Array.isArray(value.redactedFields) &&
    Array.isArray(value.diagnostics)
  );
}
