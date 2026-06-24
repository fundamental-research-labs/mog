import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type {
  CreateAgentProposalInput,
  FailAgentProposalInput,
  GetAgentProposalInput,
  ListAgentProposalsInput,
} from './version-proposal-types';
import {
  CREATE_PROPOSAL_KEYS,
  FAIL_PROPOSAL_KEYS,
  GET_PROPOSAL_KEYS,
  LIST_PROPOSALS_KEYS,
} from './version-proposal-validation-constants';
import {
  isPlainInput,
  validateKnownKeys,
  validateOptionalCommitId,
  validateOptionalLimit,
  validateOptionalProposalStatus,
  validateOptionalString,
  validateRequiredArray,
  validateRequiredProposalId,
  validateRequiredRecord,
  validateRequiredRevision,
  validateRequiredString,
  validateTrustedAuthor,
} from './version-proposal-validation-rules';
import type { ValidationResult } from './version-proposal-validation-types';

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
  validateTrustedAuthor(input, 'agent', 'createProposal', diagnostics, 'agent');
  validateOptionalString(input, 'proposalBranchNameHint', 'createProposal', diagnostics);
  validateRequiredRecord(input, 'redactionPolicy', 'createProposal', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function normalizeFailProposalInput(
  input: FailAgentProposalInput,
): ValidationResult<FailAgentProposalInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'failProposal', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, FAIL_PROPOSAL_KEYS, 'failProposal', diagnostics);
  validateRequiredString(input, 'clientRequestId', 'failProposal', diagnostics);
  validateRequiredProposalId(input, 'proposalId', 'failProposal', diagnostics);
  validateRequiredRevision(input, 'expectedRevision', 'failProposal', diagnostics);
  validateTrustedAuthor(input, 'actor', 'failProposal', diagnostics);
  validateRequiredArray(input, 'diagnostics', 'failProposal', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function normalizeGetProposalInput(
  input: GetAgentProposalInput,
): ValidationResult<GetAgentProposalInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'getProposal', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, GET_PROPOSAL_KEYS, 'getProposal', diagnostics);
  validateRequiredProposalId(input, 'proposalId', 'getProposal', diagnostics);
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
