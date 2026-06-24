import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type {
  AcceptAgentProposalInput,
  RejectAgentProposalInput,
  SupersedeAgentProposalInput,
} from './version-proposal-types';
import {
  ACCEPT_PROPOSAL_KEYS,
  REJECT_PROPOSAL_KEYS,
  SUPERSEDE_PROPOSAL_KEYS,
} from './version-proposal-validation-constants';
import {
  isPlainInput,
  validateKnownKeys,
  validateOptionalProposalId,
  validateOptionalRecordRevision,
  validateOptionalString,
  validateRequiredCommitId,
  validateRequiredProposalId,
  validateRequiredResolutionPolicy,
  validateRequiredRevision,
  validateRequiredString,
  validateTrustedAuthor,
} from './version-proposal-validation-rules';
import type { ValidationResult } from './version-proposal-validation-types';

export function normalizeAcceptProposalInput(
  input: AcceptAgentProposalInput,
): ValidationResult<AcceptAgentProposalInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'acceptProposal', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, ACCEPT_PROPOSAL_KEYS, 'acceptProposal', diagnostics);
  validateRequiredString(input, 'clientRequestId', 'acceptProposal', diagnostics);
  validateRequiredProposalId(input, 'proposalId', 'acceptProposal', diagnostics);
  validateRequiredRevision(input, 'expectedRevision', 'acceptProposal', diagnostics);
  validateRequiredCommitId(input, 'expectedTargetHeadId', 'acceptProposal', diagnostics);
  validateOptionalRecordRevision(input, 'expectedTargetRefRevision', 'acceptProposal', diagnostics);
  validateTrustedAuthor(input, 'actor', 'acceptProposal', diagnostics);
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
  validateRequiredProposalId(input, 'proposalId', 'rejectProposal', diagnostics);
  validateRequiredRevision(input, 'expectedRevision', 'rejectProposal', diagnostics);
  validateTrustedAuthor(input, 'actor', 'rejectProposal', diagnostics);
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
  validateRequiredProposalId(input, 'proposalId', 'supersedeProposal', diagnostics);
  validateRequiredRevision(input, 'expectedRevision', 'supersedeProposal', diagnostics);
  validateTrustedAuthor(input, 'actor', 'supersedeProposal', diagnostics);
  validateOptionalProposalId(input, 'supersededByProposalId', 'supersedeProposal', diagnostics);
  validateOptionalString(input, 'reason', 'supersedeProposal', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}
