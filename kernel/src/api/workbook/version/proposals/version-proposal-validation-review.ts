import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type {
  MarkAgentProposalVerifiedInput,
  OpenProposalReviewInput,
} from './version-proposal-types';
import {
  MARK_PROPOSAL_VERIFIED_KEYS,
  OPEN_PROPOSAL_REVIEW_KEYS,
} from './version-proposal-validation-constants';
import {
  isPlainInput,
  validateKnownKeys,
  validateRequiredProposalId,
  validateRequiredRecord,
  validateRequiredRevision,
  validateRequiredString,
  validateTrustedAuthor,
} from './version-proposal-validation-rules';
import type { ValidationResult } from './version-proposal-validation-types';

export function normalizeMarkProposalVerifiedInput(
  input: MarkAgentProposalVerifiedInput,
): ValidationResult<MarkAgentProposalVerifiedInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'markProposalVerified', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, MARK_PROPOSAL_VERIFIED_KEYS, 'markProposalVerified', diagnostics);
  validateRequiredString(input, 'clientRequestId', 'markProposalVerified', diagnostics);
  validateRequiredProposalId(input, 'proposalId', 'markProposalVerified', diagnostics);
  validateRequiredRevision(input, 'expectedRevision', 'markProposalVerified', diagnostics);
  validateRequiredRecord(input, 'verification', 'markProposalVerified', diagnostics);
  validateTrustedAuthor(input, 'actor', 'markProposalVerified', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function normalizeOpenProposalReviewInput(
  input: OpenProposalReviewInput,
): ValidationResult<OpenProposalReviewInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'openProposalReview', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, OPEN_PROPOSAL_REVIEW_KEYS, 'openProposalReview', diagnostics);
  validateRequiredString(input, 'clientRequestId', 'openProposalReview', diagnostics);
  validateRequiredProposalId(input, 'proposalId', 'openProposalReview', diagnostics);
  validateRequiredRevision(input, 'expectedRevision', 'openProposalReview', diagnostics);
  validateTrustedAuthor(input, 'actor', 'openProposalReview', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}
