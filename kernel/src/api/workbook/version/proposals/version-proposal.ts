import type { Paged, VersionResult, WorkbookVersionReviewRecord } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import { callProposalService } from './version-proposal-service-call';
import { proposalFailure } from './version-proposal-service-diagnostics';
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
  type RejectAgentProposalInput,
  type StartProposalWorkspaceInput,
  type SupersedeAgentProposalInput,
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
    'version:mergePreview',
    'version:mergeApply',
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
