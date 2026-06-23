import { jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';

export const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}`;
export const HEAD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}`;
export const PROPOSAL_ID = `proposal:sha256:${'a'.repeat(64)}`;
export const ACTOR = { kind: 'user', trust: 'trusted', displayName: 'Reviewer' } as const;
export const AGENT = {
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

export function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    computeBridge: {},
    writeGate: { assertWritable: jest.fn() },
    services: { undo: {} },
    floatingObjectManager: { dispose: jest.fn() },
    workbookLinkScope: () => ({
      requestingDocumentId: 'document-1',
      requestingSessionId: 'session-1',
      actor: 'user-1',
      principal: { tags: ['host:trusted'] },
    }),
    ...overrides,
  } as any;
}

export function createProposalRuntimeVersion(
  ctxOverrides: Record<string, unknown> = {},
): WorkbookVersionImpl {
  return new WorkbookVersionImpl(createMockCtx(ctxOverrides));
}

export function createProposalRecord(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: PROPOSAL_ID,
    documentId: 'document-1',
    title: 'Proposal One',
    targetRef: 'refs/heads/main',
    baseCommitId: BASE_COMMIT_ID,
    targetHeadIdAtCreation: HEAD_COMMIT_ID,
    proposalBranchName: 'agent/agent-run-1/proposal-one',
    status: 'draft',
    revision: 1,
    agentRunId: 'agent-run-1',
    agent: AGENT,
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
    redaction: {
      policy: REDACTION_POLICY,
      redactedFields: [],
      diagnostics: [],
    },
    diagnostics: [],
    ...overrides,
  };
}

export function createCompleteProposalService(overrides: Record<string, unknown> = {}) {
  const proposal = createProposalRecord();
  return {
    createProposal: jest.fn(async () => proposal),
    startProposalWorkspace: jest.fn(),
    getProposalWorkspace: jest.fn(),
    disposeProposalWorkspace: jest.fn(),
    commitProposalWorkspace: jest.fn(),
    failProposal: jest.fn(),
    getProposal: jest.fn(),
    listProposals: jest.fn(),
    markProposalVerified: jest.fn(),
    openProposalReview: jest.fn(),
    acceptProposal: jest.fn(),
    rejectProposal: jest.fn(),
    supersedeProposal: jest.fn(),
    ...overrides,
  };
}

export function acceptInput(clientRequestId: string) {
  return {
    clientRequestId,
    proposalId: PROPOSAL_ID,
    expectedRevision: 1,
    expectedTargetHeadId: BASE_COMMIT_ID,
    actor: ACTOR,
    resolutionPolicy: 'fastForwardOnly',
  };
}

export function targetUnavailable(operation: string, diagnostics: readonly unknown[]) {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics,
    },
  };
}

export function storeDiagnostic(
  issueCode: string,
  safeMessage: string,
  payload: Record<string, unknown>,
  options: { readonly recoverability?: string; readonly severity?: string } = {},
) {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? 'none',
    messageTemplateId: `version.proposal.${issueCode}`,
    safeMessage,
    payload,
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}
