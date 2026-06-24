import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type {
  CommitProposalWorkspaceInput,
  DisposeProposalWorkspaceInput,
  GetProposalWorkspaceInput,
  StartProposalWorkspaceInput,
} from './version-proposal-types';
import {
  COMMIT_PROPOSAL_WORKSPACE_KEYS,
  DISPOSE_PROPOSAL_WORKSPACE_KEYS,
  GET_PROPOSAL_WORKSPACE_KEYS,
  START_PROPOSAL_WORKSPACE_KEYS,
} from './version-proposal-validation-constants';
import {
  isPlainInput,
  validateKnownKeys,
  validateOptionalCommitId,
  validateOptionalRecord,
  validateOptionalRecordRevision,
  validateRequiredProposalId,
  validateRequiredRevision,
  validateRequiredString,
  validateTrustedAuthor,
} from './version-proposal-validation-rules';
import type { ValidationResult } from './version-proposal-validation-types';

export function normalizeStartProposalWorkspaceInput(
  input: StartProposalWorkspaceInput,
): ValidationResult<StartProposalWorkspaceInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'startProposalWorkspace', diagnostics)) {
    return { ok: false, diagnostics };
  }
  validateKnownKeys(input, START_PROPOSAL_WORKSPACE_KEYS, 'startProposalWorkspace', diagnostics);
  validateRequiredString(input, 'clientRequestId', 'startProposalWorkspace', diagnostics);
  validateRequiredProposalId(input, 'proposalId', 'startProposalWorkspace', diagnostics);
  validateRequiredRevision(input, 'expectedRevision', 'startProposalWorkspace', diagnostics);
  validateOptionalCommitId(input, 'expectedTargetHeadId', 'startProposalWorkspace', diagnostics);
  validateOptionalRecordRevision(
    input,
    'expectedTargetRefRevision',
    'startProposalWorkspace',
    diagnostics,
  );
  validateTrustedAuthor(input, 'actor', 'startProposalWorkspace', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function normalizeGetProposalWorkspaceInput(
  input: GetProposalWorkspaceInput,
): ValidationResult<GetProposalWorkspaceInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'getProposalWorkspace', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, GET_PROPOSAL_WORKSPACE_KEYS, 'getProposalWorkspace', diagnostics);
  validateRequiredString(input, 'workspaceId', 'getProposalWorkspace', diagnostics);
  validateOptionalCommitId(input, 'expectedTargetHeadId', 'getProposalWorkspace', diagnostics);
  validateOptionalRecordRevision(
    input,
    'expectedTargetRefRevision',
    'getProposalWorkspace',
    diagnostics,
  );
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
  validateOptionalCommitId(input, 'expectedTargetHeadId', 'disposeProposalWorkspace', diagnostics);
  validateOptionalRecordRevision(
    input,
    'expectedTargetRefRevision',
    'disposeProposalWorkspace',
    diagnostics,
  );
  validateTrustedAuthor(input, 'actor', 'disposeProposalWorkspace', diagnostics);
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
  validateRequiredProposalId(input, 'proposalId', 'commitProposalWorkspace', diagnostics);
  validateRequiredString(input, 'workspaceId', 'commitProposalWorkspace', diagnostics);
  validateRequiredRevision(input, 'expectedRevision', 'commitProposalWorkspace', diagnostics);
  validateOptionalCommitId(input, 'expectedTargetHeadId', 'commitProposalWorkspace', diagnostics);
  validateOptionalRecordRevision(
    input,
    'expectedTargetRefRevision',
    'commitProposalWorkspace',
    diagnostics,
  );
  validateTrustedAuthor(input, 'actor', 'commitProposalWorkspace', diagnostics);
  validateRequiredString(input, 'message', 'commitProposalWorkspace', diagnostics);
  validateOptionalRecord(input, 'verification', 'commitProposalWorkspace', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}
