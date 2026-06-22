import type {
  Paged,
  VersionCapability,
  VersionCapabilityDependency,
  VersionDiagnosticPublicPayload,
  VersionResult,
  VersionStoreDiagnostic,
  WorkbookVersionReviewRecord,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  getVersionControlGateStatus,
  getVersionHostCapabilityDecisions,
} from './version-merge-capability';
import { getAttachedVersionProposalService } from './version-proposal-service-discovery';
import {
  type AcceptAgentProposalInput,
  type AgentProposal,
  type AgentProposalAcceptResult,
  type AgentProposalSummary,
  type AgentProposalWorkspaceHandle,
  type CommitProposalWorkspaceInput,
  type CreateAgentProposalInput,
  type DisposeProposalWorkspaceInput,
  type FailAgentProposalInput,
  type GetAgentProposalInput,
  type GetProposalWorkspaceInput,
  type ListAgentProposalsInput,
  type MarkAgentProposalVerifiedInput,
  type OpenProposalReviewInput,
  type ProposalOperationInput,
  type RejectAgentProposalInput,
  type StartProposalWorkspaceInput,
  type SupersedeAgentProposalInput,
  type VersionProposalPublicOperation,
} from './version-proposal-types';
import {
  normalizeAcceptProposalInput,
  normalizeCommitProposalWorkspaceInput,
  normalizeCreateProposalInput,
  normalizeDisposeProposalWorkspaceInput,
  normalizeFailProposalInput,
  normalizeGetProposalInput,
  normalizeGetProposalWorkspaceInput,
  normalizeListProposalsInput,
  normalizeMarkProposalVerifiedInput,
  normalizeOpenProposalReviewInput,
  normalizeRejectProposalInput,
  normalizeStartProposalWorkspaceInput,
  normalizeSupersedeProposalInput,
} from './version-proposal-validation';
import { versionFailureFromStoreDiagnostics } from './version-result';

export type {
  AcceptAgentProposalInput,
  AgentProposal,
  AgentProposalAcceptResult,
  AgentProposalStatus,
  AgentProposalSummary,
  AgentProposalWorkspaceHandle,
  CommitProposalWorkspaceInput,
  CreateAgentProposalInput,
  DisposeProposalWorkspaceInput,
  FailAgentProposalInput,
  GetAgentProposalInput,
  GetProposalWorkspaceInput,
  ListAgentProposalsInput,
  MarkAgentProposalVerifiedInput,
  OpenProposalReviewInput,
  RejectAgentProposalInput,
  StartProposalWorkspaceInput,
  SupersedeAgentProposalInput,
} from './version-proposal-types';

export async function createWorkbookVersionProposal(
  ctx: DocumentContext,
  input: CreateAgentProposalInput,
): Promise<VersionResult<AgentProposal>> {
  const normalized = normalizeCreateProposalInput(input);
  if (!normalized.ok) return proposalFailure('createProposal', normalized.diagnostics);
  return callProposalService(ctx, 'createProposal', normalized.input, ['version:proposal']);
}

export async function startWorkbookVersionProposalWorkspace(
  ctx: DocumentContext,
  input: StartProposalWorkspaceInput,
): Promise<VersionResult<AgentProposalWorkspaceHandle>> {
  const normalized = normalizeStartProposalWorkspaceInput(input);
  if (!normalized.ok) return proposalFailure('startProposalWorkspace', normalized.diagnostics);
  return callProposalService(ctx, 'startProposalWorkspace', normalized.input, ['version:proposal']);
}

export async function getWorkbookVersionProposalWorkspace(
  ctx: DocumentContext,
  input: GetProposalWorkspaceInput,
): Promise<VersionResult<AgentProposalWorkspaceHandle>> {
  const normalized = normalizeGetProposalWorkspaceInput(input);
  if (!normalized.ok) return proposalFailure('getProposalWorkspace', normalized.diagnostics);
  return callProposalService(ctx, 'getProposalWorkspace', normalized.input, ['version:proposal']);
}

export async function disposeWorkbookVersionProposalWorkspace(
  ctx: DocumentContext,
  input: DisposeProposalWorkspaceInput,
): Promise<VersionResult<{ readonly disposed: true }>> {
  const normalized = normalizeDisposeProposalWorkspaceInput(input);
  if (!normalized.ok) return proposalFailure('disposeProposalWorkspace', normalized.diagnostics);
  return callProposalService(ctx, 'disposeProposalWorkspace', normalized.input, [
    'version:proposal',
  ]);
}

export async function commitWorkbookVersionProposalWorkspace(
  ctx: DocumentContext,
  input: CommitProposalWorkspaceInput,
): Promise<VersionResult<AgentProposal>> {
  const normalized = normalizeCommitProposalWorkspaceInput(input);
  if (!normalized.ok) return proposalFailure('commitProposalWorkspace', normalized.diagnostics);
  return callProposalService(ctx, 'commitProposalWorkspace', normalized.input, [
    'version:proposal',
  ]);
}

export async function failWorkbookVersionProposal(
  ctx: DocumentContext,
  input: FailAgentProposalInput,
): Promise<VersionResult<AgentProposal>> {
  const normalized = normalizeFailProposalInput(input);
  if (!normalized.ok) return proposalFailure('failProposal', normalized.diagnostics);
  return callProposalService(ctx, 'failProposal', normalized.input, ['version:proposal']);
}

export async function getWorkbookVersionProposal(
  ctx: DocumentContext,
  input: GetAgentProposalInput,
): Promise<VersionResult<AgentProposal>> {
  const normalized = normalizeGetProposalInput(input);
  if (!normalized.ok) return proposalFailure('getProposal', normalized.diagnostics);
  return callProposalService(ctx, 'getProposal', normalized.input, ['version:proposal']);
}

export async function listWorkbookVersionProposals(
  ctx: DocumentContext,
  input: ListAgentProposalsInput = {},
): Promise<VersionResult<Paged<AgentProposalSummary>>> {
  const normalized = normalizeListProposalsInput(input);
  if (!normalized.ok) return proposalFailure('listProposals', normalized.diagnostics);
  return callProposalService(ctx, 'listProposals', normalized.input, ['version:proposal']);
}

export async function markWorkbookVersionProposalVerified(
  ctx: DocumentContext,
  input: MarkAgentProposalVerifiedInput,
): Promise<VersionResult<AgentProposal>> {
  const normalized = normalizeMarkProposalVerifiedInput(input);
  if (!normalized.ok) return proposalFailure('markProposalVerified', normalized.diagnostics);
  return callProposalService(ctx, 'markProposalVerified', normalized.input, ['version:proposal']);
}

export async function openWorkbookVersionProposalReview(
  ctx: DocumentContext,
  input: OpenProposalReviewInput,
): Promise<VersionResult<WorkbookVersionReviewRecord>> {
  const normalized = normalizeOpenProposalReviewInput(input);
  if (!normalized.ok) return proposalFailure('openProposalReview', normalized.diagnostics);
  return callProposalService(ctx, 'openProposalReview', normalized.input, ['version:proposal']);
}

export async function acceptWorkbookVersionProposal(
  ctx: DocumentContext,
  input: AcceptAgentProposalInput,
): Promise<VersionResult<AgentProposalAcceptResult>> {
  const normalized = normalizeAcceptProposalInput(input);
  if (!normalized.ok) return proposalFailure('acceptProposal', normalized.diagnostics);
  return callProposalService(ctx, 'acceptProposal', normalized.input, [
    'version:proposal',
    'version:branch',
  ]);
}

export async function rejectWorkbookVersionProposal(
  ctx: DocumentContext,
  input: RejectAgentProposalInput,
): Promise<VersionResult<AgentProposal>> {
  const normalized = normalizeRejectProposalInput(input);
  if (!normalized.ok) return proposalFailure('rejectProposal', normalized.diagnostics);
  return callProposalService(ctx, 'rejectProposal', normalized.input, ['version:proposal']);
}

export async function supersedeWorkbookVersionProposal(
  ctx: DocumentContext,
  input: SupersedeAgentProposalInput,
): Promise<VersionResult<AgentProposal>> {
  const normalized = normalizeSupersedeProposalInput(input);
  if (!normalized.ok) return proposalFailure('supersedeProposal', normalized.diagnostics);
  return callProposalService(ctx, 'supersedeProposal', normalized.input, ['version:proposal']);
}

async function callProposalService<Operation extends VersionProposalPublicOperation, TResult>(
  ctx: DocumentContext,
  operation: Operation,
  input: ProposalOperationInput<Operation>,
  requiredCapabilities: readonly VersionCapability[],
): Promise<VersionResult<TResult>> {
  const capabilityFailure = proposalCapabilityFailure<TResult>(
    ctx,
    operation,
    requiredCapabilities,
  );
  if (capabilityFailure) return capabilityFailure;

  const proposalService = getAttachedVersionProposalService(ctx);
  if (!proposalService)
    return proposalFailure(operation, [serviceUnavailableDiagnostic(operation)]);

  const method = proposalService[operation] as
    | ((input: ProposalOperationInput<Operation>) => Promise<unknown> | unknown)
    | undefined;
  if (!method) return proposalFailure(operation, [methodUnavailableDiagnostic(operation)]);

  try {
    return mapProposalServiceResult(operation, await method(input));
  } catch {
    return proposalFailure(operation, [providerErrorDiagnostic(operation)]);
  }
}

function proposalCapabilityFailure<T>(
  ctx: DocumentContext,
  operation: VersionProposalPublicOperation,
  requiredCapabilities: readonly VersionCapability[],
): VersionResult<T> | null {
  const gate = getVersionControlGateStatus(ctx);
  const primaryCapability = requiredCapabilities[0] ?? 'version:proposal';
  if (!gate.enabled) {
    return capabilityUnavailable(
      operation,
      primaryCapability,
      'featureGate',
      'Version-control proposal endpoints are disabled for this workbook.',
      false,
      'version.proposal.capabilityDisabled',
    );
  }
  if (!gate.editingEnabled) {
    return capabilityUnavailable(
      operation,
      primaryCapability,
      'featureGate',
      'Workbook editing is disabled by host feature gates.',
      false,
      'version.proposal.editingDisabled',
    );
  }

  const hostDecisions = getVersionHostCapabilityDecisions(ctx);
  for (const capability of requiredCapabilities) {
    const decision = hostDecisions[capability];
    if (decision === 'denied' || decision === 'approval-required') {
      return capabilityUnavailable(
        operation,
        capability,
        'hostCapability',
        `Host policy ${decision === 'denied' ? 'denies' : 'requires approval for'} ${capability}.`,
        decision === 'approval-required',
        'version.proposal.hostCapabilityDenied',
      );
    }
  }

  return null;
}

function capabilityUnavailable<T>(
  operation: VersionProposalPublicOperation,
  capability: VersionCapability,
  dependency: VersionCapabilityDependency,
  reason: string,
  retryable: boolean,
  diagnosticCode: string,
): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'version_capability_unavailable',
      capability,
      dependency,
      reason,
      retryable,
      diagnostics: [
        {
          code: diagnosticCode,
          severity: retryable ? 'warning' : 'error',
          message: reason,
          dependency,
          data: { operation, capability },
        },
      ],
    },
  };
}

function mapProposalServiceResult<T>(
  operation: VersionProposalPublicOperation,
  value: unknown,
): VersionResult<T> {
  if (isVersionResult(value)) return value as VersionResult<T>;
  if (isRecord(value)) return { ok: true, value: value as T };
  if (operation === 'disposeProposalWorkspace' && value === true) {
    return { ok: true, value: { disposed: true } as T };
  }
  return proposalFailure(operation, [providerInvalidPayloadDiagnostic(operation)]);
}

function proposalFailure<T>(
  operation: VersionProposalPublicOperation,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionResult<T> {
  return versionFailureFromStoreDiagnostics(operation, diagnostics);
}

function serviceUnavailableDiagnostic(
  operation: VersionProposalPublicOperation,
): VersionStoreDiagnostic {
  return proposalDiagnostic(
    operation,
    'VERSION_PROPOSAL_SERVICE_UNAVAILABLE',
    'No document-scoped version proposal service is attached; no proposal records are fabricated.',
    { recoverability: 'unsupported' },
  );
}

function methodUnavailableDiagnostic(
  operation: VersionProposalPublicOperation,
): VersionStoreDiagnostic {
  return proposalDiagnostic(
    operation,
    'VERSION_PROPOSAL_METHOD_UNAVAILABLE',
    `The attached version proposal service does not implement ${operation}.`,
    { recoverability: 'unsupported' },
  );
}

function providerErrorDiagnostic(
  operation: VersionProposalPublicOperation,
): VersionStoreDiagnostic {
  return proposalDiagnostic(
    operation,
    'VERSION_PROVIDER_ERROR',
    'The version proposal service failed before returning a usable public result.',
    { recoverability: 'retry', severity: 'error' },
  );
}

function providerInvalidPayloadDiagnostic(
  operation: VersionProposalPublicOperation,
): VersionStoreDiagnostic {
  return proposalDiagnostic(
    operation,
    'VERSION_INVALID_COMMIT_PAYLOAD',
    'The version proposal service did not return a valid public proposal result.',
    { recoverability: 'repair', severity: 'error' },
  );
}

function proposalDiagnostic(
  operation: VersionProposalPublicOperation,
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: VersionStoreDiagnostic['severity'];
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionDiagnosticPublicPayload;
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? 'none',
    messageTemplateId: `version.${operation}.${issueCode}`,
    safeMessage,
    payload: { operation, ...(options.payload ?? {}) },
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}

function isVersionResult(value: unknown): boolean {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  if (value.ok === true) return 'value' in value;
  return value.ok === false && isRecord(value.error);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
