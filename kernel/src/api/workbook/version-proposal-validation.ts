import type {
  VersionDiagnosticPublicPayload,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type {
  AcceptAgentProposalInput,
  AgentProposalStatus,
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
  VersionProposalPublicOperation,
} from './version-proposal-types';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;

const PROPOSAL_STATUSES = new Set<AgentProposalStatus>([
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
]);
const ACCEPT_RESOLUTION_POLICIES = new Set<AcceptAgentProposalInput['resolutionPolicy']>([
  'fastForwardOnly',
  'allowCleanMerge',
  'allowResolvedMerge',
]);

const CREATE_PROPOSAL_KEYS = new Set([
  'clientRequestId',
  'title',
  'targetRef',
  'baseCommitId',
  'agentRunId',
  'agent',
  'proposalBranchNameHint',
  'redactionPolicy',
]);
const START_PROPOSAL_WORKSPACE_KEYS = new Set([
  'clientRequestId',
  'proposalId',
  'expectedRevision',
  'actor',
]);
const GET_PROPOSAL_WORKSPACE_KEYS = new Set(['workspaceId']);
const DISPOSE_PROPOSAL_WORKSPACE_KEYS = new Set(['clientRequestId', 'workspaceId', 'actor']);
const COMMIT_PROPOSAL_WORKSPACE_KEYS = new Set([
  'clientRequestId',
  'proposalId',
  'workspaceId',
  'expectedRevision',
  'actor',
  'message',
  'verification',
]);
const FAIL_PROPOSAL_KEYS = new Set([
  'clientRequestId',
  'proposalId',
  'expectedRevision',
  'actor',
  'diagnostics',
]);
const GET_PROPOSAL_KEYS = new Set(['proposalId']);
const LIST_PROPOSALS_KEYS = new Set(['targetRef', 'status', 'agentRunId', 'cursor', 'limit']);
const MARK_PROPOSAL_VERIFIED_KEYS = new Set([
  'clientRequestId',
  'proposalId',
  'expectedRevision',
  'verification',
  'actor',
]);
const OPEN_PROPOSAL_REVIEW_KEYS = new Set([
  'clientRequestId',
  'proposalId',
  'expectedRevision',
  'actor',
]);
const ACCEPT_PROPOSAL_KEYS = new Set([
  'clientRequestId',
  'proposalId',
  'expectedRevision',
  'expectedTargetHeadId',
  'actor',
  'resolutionPolicy',
]);
const REJECT_PROPOSAL_KEYS = new Set([
  'clientRequestId',
  'proposalId',
  'expectedRevision',
  'actor',
  'reason',
]);
const SUPERSEDE_PROPOSAL_KEYS = new Set([
  'clientRequestId',
  'proposalId',
  'expectedRevision',
  'actor',
  'supersededByProposalId',
  'reason',
]);

export type ValidationResult<T> =
  | { readonly ok: true; readonly input: T }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export function normalizeCreateProposalInput(
  input: CreateAgentProposalInput,
): ValidationResult<CreateAgentProposalInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'createProposal', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, CREATE_PROPOSAL_KEYS, 'createProposal', diagnostics);
  validateRequiredString(input, 'clientRequestId', 'createProposal', diagnostics);
  validateRequiredString(input, 'title', 'createProposal', diagnostics);
  validateRequiredString(input, 'targetRef', 'createProposal', diagnostics);
  validateOptionalCommitId(input, 'baseCommitId', 'createProposal', diagnostics);
  validateRequiredString(input, 'agentRunId', 'createProposal', diagnostics);
  validateRequiredRecord(input, 'agent', 'createProposal', diagnostics);
  validateOptionalString(input, 'proposalBranchNameHint', 'createProposal', diagnostics);
  validateRequiredRecord(input, 'redactionPolicy', 'createProposal', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function normalizeStartProposalWorkspaceInput(
  input: StartProposalWorkspaceInput,
): ValidationResult<StartProposalWorkspaceInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'startProposalWorkspace', diagnostics)) {
    return { ok: false, diagnostics };
  }
  validateKnownKeys(input, START_PROPOSAL_WORKSPACE_KEYS, 'startProposalWorkspace', diagnostics);
  validateRequiredString(input, 'clientRequestId', 'startProposalWorkspace', diagnostics);
  validateRequiredString(input, 'proposalId', 'startProposalWorkspace', diagnostics);
  validateRequiredRevision(input, 'expectedRevision', 'startProposalWorkspace', diagnostics);
  validateRequiredRecord(input, 'actor', 'startProposalWorkspace', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function normalizeGetProposalWorkspaceInput(
  input: GetProposalWorkspaceInput,
): ValidationResult<GetProposalWorkspaceInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'getProposalWorkspace', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, GET_PROPOSAL_WORKSPACE_KEYS, 'getProposalWorkspace', diagnostics);
  validateRequiredString(input, 'workspaceId', 'getProposalWorkspace', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function normalizeDisposeProposalWorkspaceInput(
  input: DisposeProposalWorkspaceInput,
): ValidationResult<DisposeProposalWorkspaceInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'disposeProposalWorkspace', diagnostics)) {
    return { ok: false, diagnostics };
  }
  validateKnownKeys(
    input,
    DISPOSE_PROPOSAL_WORKSPACE_KEYS,
    'disposeProposalWorkspace',
    diagnostics,
  );
  validateRequiredString(input, 'clientRequestId', 'disposeProposalWorkspace', diagnostics);
  validateRequiredString(input, 'workspaceId', 'disposeProposalWorkspace', diagnostics);
  validateRequiredRecord(input, 'actor', 'disposeProposalWorkspace', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function normalizeCommitProposalWorkspaceInput(
  input: CommitProposalWorkspaceInput,
): ValidationResult<CommitProposalWorkspaceInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'commitProposalWorkspace', diagnostics)) {
    return { ok: false, diagnostics };
  }
  validateKnownKeys(input, COMMIT_PROPOSAL_WORKSPACE_KEYS, 'commitProposalWorkspace', diagnostics);
  validateRequiredString(input, 'clientRequestId', 'commitProposalWorkspace', diagnostics);
  validateRequiredString(input, 'proposalId', 'commitProposalWorkspace', diagnostics);
  validateRequiredString(input, 'workspaceId', 'commitProposalWorkspace', diagnostics);
  validateRequiredRevision(input, 'expectedRevision', 'commitProposalWorkspace', diagnostics);
  validateRequiredRecord(input, 'actor', 'commitProposalWorkspace', diagnostics);
  validateRequiredString(input, 'message', 'commitProposalWorkspace', diagnostics);
  validateOptionalRecord(input, 'verification', 'commitProposalWorkspace', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function normalizeFailProposalInput(
  input: FailAgentProposalInput,
): ValidationResult<FailAgentProposalInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'failProposal', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, FAIL_PROPOSAL_KEYS, 'failProposal', diagnostics);
  validateRequiredString(input, 'clientRequestId', 'failProposal', diagnostics);
  validateRequiredString(input, 'proposalId', 'failProposal', diagnostics);
  validateRequiredRevision(input, 'expectedRevision', 'failProposal', diagnostics);
  validateRequiredRecord(input, 'actor', 'failProposal', diagnostics);
  validateRequiredArray(input, 'diagnostics', 'failProposal', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function normalizeGetProposalInput(
  input: GetAgentProposalInput,
): ValidationResult<GetAgentProposalInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'getProposal', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, GET_PROPOSAL_KEYS, 'getProposal', diagnostics);
  validateRequiredString(input, 'proposalId', 'getProposal', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function normalizeListProposalsInput(
  input: ListAgentProposalsInput,
): ValidationResult<ListAgentProposalsInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'listProposals', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, LIST_PROPOSALS_KEYS, 'listProposals', diagnostics);
  validateOptionalString(input, 'targetRef', 'listProposals', diagnostics);
  validateOptionalProposalStatus(input, 'status', 'listProposals', diagnostics);
  validateOptionalString(input, 'agentRunId', 'listProposals', diagnostics);
  validateOptionalString(input, 'cursor', 'listProposals', diagnostics);
  validateOptionalLimit(input, 'limit', 'listProposals', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function normalizeMarkProposalVerifiedInput(
  input: MarkAgentProposalVerifiedInput,
): ValidationResult<MarkAgentProposalVerifiedInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'markProposalVerified', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, MARK_PROPOSAL_VERIFIED_KEYS, 'markProposalVerified', diagnostics);
  validateRequiredString(input, 'clientRequestId', 'markProposalVerified', diagnostics);
  validateRequiredString(input, 'proposalId', 'markProposalVerified', diagnostics);
  validateRequiredRevision(input, 'expectedRevision', 'markProposalVerified', diagnostics);
  validateRequiredRecord(input, 'verification', 'markProposalVerified', diagnostics);
  validateRequiredRecord(input, 'actor', 'markProposalVerified', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function normalizeOpenProposalReviewInput(
  input: OpenProposalReviewInput,
): ValidationResult<OpenProposalReviewInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'openProposalReview', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, OPEN_PROPOSAL_REVIEW_KEYS, 'openProposalReview', diagnostics);
  validateRequiredString(input, 'clientRequestId', 'openProposalReview', diagnostics);
  validateRequiredString(input, 'proposalId', 'openProposalReview', diagnostics);
  validateRequiredRevision(input, 'expectedRevision', 'openProposalReview', diagnostics);
  validateRequiredRecord(input, 'actor', 'openProposalReview', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function normalizeAcceptProposalInput(
  input: AcceptAgentProposalInput,
): ValidationResult<AcceptAgentProposalInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'acceptProposal', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, ACCEPT_PROPOSAL_KEYS, 'acceptProposal', diagnostics);
  validateRequiredString(input, 'clientRequestId', 'acceptProposal', diagnostics);
  validateRequiredString(input, 'proposalId', 'acceptProposal', diagnostics);
  validateRequiredRevision(input, 'expectedRevision', 'acceptProposal', diagnostics);
  validateRequiredCommitId(input, 'expectedTargetHeadId', 'acceptProposal', diagnostics);
  validateRequiredRecord(input, 'actor', 'acceptProposal', diagnostics);
  validateRequiredResolutionPolicy(input, 'resolutionPolicy', 'acceptProposal', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function normalizeRejectProposalInput(
  input: RejectAgentProposalInput,
): ValidationResult<RejectAgentProposalInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'rejectProposal', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, REJECT_PROPOSAL_KEYS, 'rejectProposal', diagnostics);
  validateRequiredString(input, 'clientRequestId', 'rejectProposal', diagnostics);
  validateRequiredString(input, 'proposalId', 'rejectProposal', diagnostics);
  validateRequiredRevision(input, 'expectedRevision', 'rejectProposal', diagnostics);
  validateRequiredRecord(input, 'actor', 'rejectProposal', diagnostics);
  validateOptionalString(input, 'reason', 'rejectProposal', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function normalizeSupersedeProposalInput(
  input: SupersedeAgentProposalInput,
): ValidationResult<SupersedeAgentProposalInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'supersedeProposal', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, SUPERSEDE_PROPOSAL_KEYS, 'supersedeProposal', diagnostics);
  validateRequiredString(input, 'clientRequestId', 'supersedeProposal', diagnostics);
  validateRequiredString(input, 'proposalId', 'supersedeProposal', diagnostics);
  validateRequiredRevision(input, 'expectedRevision', 'supersedeProposal', diagnostics);
  validateRequiredRecord(input, 'actor', 'supersedeProposal', diagnostics);
  validateOptionalString(input, 'supersededByProposalId', 'supersedeProposal', diagnostics);
  validateOptionalString(input, 'reason', 'supersedeProposal', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

function invalidOptionDiagnostic(
  operation: VersionProposalPublicOperation,
  option: string,
  safeMessage: string,
): VersionStoreDiagnostic {
  return proposalInputDiagnostic(operation, 'VERSION_INVALID_OPTIONS', safeMessage, {
    payload: { option },
  });
}

function proposalInputDiagnostic(
  operation: VersionProposalPublicOperation,
  issueCode: string,
  safeMessage: string,
  options: { readonly payload?: VersionDiagnosticPublicPayload } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: 'error',
    recoverability: 'none',
    messageTemplateId: `version.${operation}.${issueCode}`,
    safeMessage,
    payload: { operation, ...(options.payload ?? {}) },
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}

function isPlainInput(
  input: unknown,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): input is Readonly<Record<string, unknown>> {
  if (isRecord(input) && !Array.isArray(input)) return true;
  diagnostics.push(
    invalidOptionDiagnostic(operation, 'input', 'proposal input must be an object.'),
  );
  return false;
}

function validateKnownKeys(
  input: Readonly<Record<string, unknown>>,
  allowedKeys: ReadonlySet<string>,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  for (const key of Object.keys(input)) {
    if (allowedKeys.has(key)) continue;
    diagnostics.push(invalidOptionDiagnostic(operation, key, `Unknown proposal option "${key}".`));
  }
}

function validateRequiredString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  const value = input[key];
  if (typeof value === 'string' && value.length > 0) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a non-empty string.`));
}

function validateOptionalString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input) || typeof input[key] === 'string') return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a string.`));
}

function validateRequiredRecord(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (isRecord(input[key]) && !Array.isArray(input[key])) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be an object.`));
}

function validateOptionalRecord(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input) || (isRecord(input[key]) && !Array.isArray(input[key]))) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be an object.`));
}

function validateRequiredArray(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (Array.isArray(input[key])) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be an array.`));
}

function validateOptionalProposalStatus(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input) || PROPOSAL_STATUSES.has(input[key] as AgentProposalStatus)) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a proposal status.`));
}

function validateRequiredResolutionPolicy(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (ACCEPT_RESOLUTION_POLICIES.has(input[key] as AcceptAgentProposalInput['resolutionPolicy'])) {
    return;
  }
  diagnostics.push(
    invalidOptionDiagnostic(operation, key, `${key} must be a proposal accept policy.`),
  );
}

function validateOptionalCommitId(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input)) return;
  validateCommitId(input[key], operation, key, diagnostics);
}

function validateRequiredCommitId(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  validateCommitId(input[key], operation, key, diagnostics);
}

function validateCommitId(
  value: unknown,
  operation: VersionProposalPublicOperation,
  key: string,
  diagnostics: VersionStoreDiagnostic[],
): value is WorkbookCommitId {
  if (typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)) return true;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a commit id.`));
  return false;
}

function validateRequiredRevision(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (Number.isInteger(input[key]) && Number(input[key]) >= 1) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a positive integer.`));
}

function validateOptionalLimit(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionProposalPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input)) return;
  const value = input[key];
  if (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 100) return;
  diagnostics.push(
    invalidOptionDiagnostic(operation, key, `${key} must be an integer from 1 to 100.`),
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
