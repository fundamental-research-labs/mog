import { agentProposalRowWithIndexes, cloneAgentProposalRecord, cloneJson } from './codec';
import type {
  AgentProposalId,
  AgentProposalMutationLogEntry,
  AgentProposalRecord,
  AgentProposalStoreRow,
  CreateAgentProposalStoreInput,
  UpdateAgentProposalStoreInput,
} from './types';
import type { VersionDocumentScope } from '../../registry';

export function createProposalRecord(input: {
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
    targetRefVersionAtCreation: input.input.targetRefVersionAtCreation,
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

export function createProposalRow(input: {
  readonly documentScopeKey: string;
  readonly proposalId: AgentProposalId;
  readonly createClientRequestId: string;
  readonly record: AgentProposalRecord;
  readonly fingerprint: string;
  readonly recordedAt: string;
}): AgentProposalStoreRow {
  return agentProposalRowWithIndexes({
    schemaVersion: 1,
    operation: 'agent-proposal-record',
    documentScopeKey: input.documentScopeKey,
    proposalId: input.proposalId,
    documentId: input.record.documentId,
    targetRef: input.record.targetRef,
    baseCommitId: input.record.baseCommitId,
    ...(input.record.proposalCommitId === undefined
      ? {}
      : { proposalCommitId: input.record.proposalCommitId }),
    proposalBranchName: input.record.proposalBranchName,
    agentRunId: input.record.agentRunId,
    status: input.record.status,
    updatedAt: input.record.updatedAt,
    createClientRequestId: input.createClientRequestId,
    record: input.record,
    mutationLog: [
      {
        schemaVersion: 1,
        operation: 'createProposal',
        clientRequestId: input.createClientRequestId,
        fingerprint: input.fingerprint,
        resultRecord: cloneAgentProposalRecord(input.record),
        recordedAt: input.recordedAt,
      },
    ],
  });
}

export function applyStatusUpdate(
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

export function appendMutationLog(
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
