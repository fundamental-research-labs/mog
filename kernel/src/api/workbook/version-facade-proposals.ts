import type {
  AcceptAgentProposalInput,
  AgentProposal,
  AgentProposalAcceptResult,
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
  Paged,
  RejectAgentProposalInput,
  StartProposalWorkspaceInput,
  SupersedeAgentProposalInput,
  VersionResult,
  WorkbookVersionReviewRecord,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  acceptWorkbookVersionProposal,
  commitWorkbookVersionProposalWorkspace,
  createWorkbookVersionProposal,
  disposeWorkbookVersionProposalWorkspace,
  failWorkbookVersionProposal,
  getWorkbookVersionProposal,
  getWorkbookVersionProposalWorkspace,
  listWorkbookVersionProposals,
  markWorkbookVersionProposalVerified,
  openWorkbookVersionProposalReview,
  rejectWorkbookVersionProposal,
  startWorkbookVersionProposalWorkspace,
  supersedeWorkbookVersionProposal,
} from './version/proposals/version-proposal';

export async function createWorkbookVersionProposalFacade(
  ctx: DocumentContext,
  input: CreateAgentProposalInput,
): Promise<VersionResult<AgentProposal>> {
  return createWorkbookVersionProposal(ctx, input);
}

export async function startWorkbookVersionProposalWorkspaceFacade(
  ctx: DocumentContext,
  input: StartProposalWorkspaceInput,
): Promise<VersionResult<AgentProposalWorkspaceHandle>> {
  return startWorkbookVersionProposalWorkspace(ctx, input);
}

export async function getWorkbookVersionProposalWorkspaceFacade(
  ctx: DocumentContext,
  input: GetProposalWorkspaceInput,
): Promise<VersionResult<AgentProposalWorkspaceHandle>> {
  return getWorkbookVersionProposalWorkspace(ctx, input);
}

export async function disposeWorkbookVersionProposalWorkspaceFacade(
  ctx: DocumentContext,
  input: DisposeProposalWorkspaceInput,
): Promise<VersionResult<{ readonly disposed: true }>> {
  return disposeWorkbookVersionProposalWorkspace(ctx, input);
}

export async function commitWorkbookVersionProposalWorkspaceFacade(
  ctx: DocumentContext,
  input: CommitProposalWorkspaceInput,
): Promise<VersionResult<AgentProposal>> {
  return commitWorkbookVersionProposalWorkspace(ctx, input);
}

export async function failWorkbookVersionProposalFacade(
  ctx: DocumentContext,
  input: FailAgentProposalInput,
): Promise<VersionResult<AgentProposal>> {
  return failWorkbookVersionProposal(ctx, input);
}

export async function getWorkbookVersionProposalFacade(
  ctx: DocumentContext,
  input: GetAgentProposalInput,
): Promise<VersionResult<AgentProposal>> {
  return getWorkbookVersionProposal(ctx, input);
}

export async function listWorkbookVersionProposalsFacade(
  ctx: DocumentContext,
  input: ListAgentProposalsInput = {},
): Promise<VersionResult<Paged<AgentProposalSummary>>> {
  return listWorkbookVersionProposals(ctx, input);
}

export async function markWorkbookVersionProposalVerifiedFacade(
  ctx: DocumentContext,
  input: MarkAgentProposalVerifiedInput,
): Promise<VersionResult<AgentProposal>> {
  return markWorkbookVersionProposalVerified(ctx, input);
}

export async function openWorkbookVersionProposalReviewFacade(
  ctx: DocumentContext,
  input: OpenProposalReviewInput,
): Promise<VersionResult<WorkbookVersionReviewRecord>> {
  return openWorkbookVersionProposalReview(ctx, input);
}

export async function acceptWorkbookVersionProposalFacade(
  ctx: DocumentContext,
  input: AcceptAgentProposalInput,
): Promise<VersionResult<AgentProposalAcceptResult>> {
  return acceptWorkbookVersionProposal(ctx, input);
}

export async function rejectWorkbookVersionProposalFacade(
  ctx: DocumentContext,
  input: RejectAgentProposalInput,
): Promise<VersionResult<AgentProposal>> {
  return rejectWorkbookVersionProposal(ctx, input);
}

export async function supersedeWorkbookVersionProposalFacade(
  ctx: DocumentContext,
  input: SupersedeAgentProposalInput,
): Promise<VersionResult<AgentProposal>> {
  return supersedeWorkbookVersionProposal(ctx, input);
}
