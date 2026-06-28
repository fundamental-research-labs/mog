import type {
  AcceptAgentProposalInput,
  AgentProposal,
  AgentProposalAcceptResult,
  AgentProposalId,
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
  VersionAuthor,
  VersionCreateProposalPorcelainInput,
  VersionListProposalPorcelainOptions,
  VersionProposalAcceptOptions,
  VersionProposalApi,
  VersionResult,
  VersionProposalHandle,
  VersionProposalHandleOptions,
  VersionProposalPorcelainApi,
  VersionProposalRejectOptions,
  VersionProposalSupersedeOptions,
  VersionProposalVerificationOptions,
  VersionProposalWorkspaceCommitOptions,
  VersionProposalWorkspaceHandle,
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
import { proposalFailure } from './version/proposals/version-proposal-service-diagnostics';
import type { VersionProposalPublicOperation } from './version/proposals/version-proposal-types';
import { unauthorizedAuthorDiagnostic } from './version/proposals/version-proposal-validation-diagnostics';

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

export function createWorkbookVersionProposalPorcelainFacade(
  ctx: DocumentContext,
): VersionProposalPorcelainApi {
  return new WorkbookVersionProposalPorcelainApiImpl(ctx);
}

class WorkbookVersionProposalPorcelainApiImpl implements VersionProposalPorcelainApi {
  constructor(private readonly ctx: DocumentContext) {}

  get advanced(): VersionProposalApi {
    return {
      createProposal: (input) => createWorkbookVersionProposalFacade(this.ctx, input),
      startProposalWorkspace: (input) =>
        startWorkbookVersionProposalWorkspaceFacade(this.ctx, input),
      getProposalWorkspace: (input) =>
        getWorkbookVersionProposalWorkspaceFacade(this.ctx, input),
      disposeProposalWorkspace: (input) =>
        disposeWorkbookVersionProposalWorkspaceFacade(this.ctx, input),
      commitProposalWorkspace: (input) =>
        commitWorkbookVersionProposalWorkspaceFacade(this.ctx, input),
      failProposal: (input) => failWorkbookVersionProposalFacade(this.ctx, input),
      getProposal: (input) => getWorkbookVersionProposalFacade(this.ctx, input),
      listProposals: (input) => listWorkbookVersionProposalsFacade(this.ctx, input),
      markProposalVerified: (input) =>
        markWorkbookVersionProposalVerifiedFacade(this.ctx, input),
      openProposalReview: (input) => openWorkbookVersionProposalReviewFacade(this.ctx, input),
      acceptProposal: (input) => acceptWorkbookVersionProposalFacade(this.ctx, input),
      rejectProposal: (input) => rejectWorkbookVersionProposalFacade(this.ctx, input),
      supersedeProposal: (input) => supersedeWorkbookVersionProposalFacade(this.ctx, input),
    };
  }

  async create(
    input: VersionCreateProposalPorcelainInput,
  ): Promise<VersionResult<VersionProposalHandle>> {
    const clientRequestId = input.clientRequestId ?? defaultClientRequestId('proposal-create');
    const agentRunId = input.agentRunId ?? `agent-run:${clientRequestId}`;
    const agent = input.agent ?? defaultAuthor(this.ctx, 'agent', agentRunId);
    if (!agent) return missingTrustedAuthorFailure('createProposal', 'agent');
    const result = await createWorkbookVersionProposalFacade(this.ctx, {
      clientRequestId,
      title: input.title,
      targetRef: proposalTargetRef(input.into),
      ...(input.baseCommitId ? { baseCommitId: input.baseCommitId } : {}),
      agentRunId,
      agent,
      ...(input.proposalBranchNameHint
        ? { proposalBranchNameHint: input.proposalBranchNameHint }
        : {}),
      redactionPolicy: input.redactionPolicy ?? defaultRedactionPolicy(),
    });
    return proposalHandleResult(this.ctx, result);
  }

  async get(id: AgentProposalId): Promise<VersionResult<VersionProposalHandle>> {
    return proposalHandleResult(this.ctx, await getWorkbookVersionProposalFacade(this.ctx, {
      proposalId: id,
    }));
  }

  async list(
    options: VersionListProposalPorcelainOptions = {},
  ): Promise<VersionResult<Paged<AgentProposalSummary>>> {
    return listWorkbookVersionProposalsFacade(this.ctx, options);
  }
}

class WorkbookVersionProposalHandleImpl implements VersionProposalHandle {
  constructor(
    private readonly ctx: DocumentContext,
    readonly proposal: AgentProposal,
  ) {}

  get id(): AgentProposalId {
    return this.proposal.id;
  }

  get status(): AgentProposal['status'] {
    return this.proposal.status;
  }

  get revision(): number {
    return this.proposal.revision;
  }

  async refresh(): Promise<VersionResult<VersionProposalHandle>> {
    return proposalHandleResult(this.ctx, await getWorkbookVersionProposalFacade(this.ctx, {
      proposalId: this.id,
    }));
  }

  async openWorkspace(
    options: VersionProposalHandleOptions = {},
  ): Promise<VersionResult<VersionProposalWorkspaceHandle>> {
    const actor = options.actor ?? defaultAuthor(this.ctx, 'user');
    if (!actor) return missingTrustedAuthorFailure('startProposalWorkspace', 'actor');
    const opened = await startWorkbookVersionProposalWorkspaceFacade(this.ctx, {
      clientRequestId: options.clientRequestId ?? defaultClientRequestId('proposal-workspace-open'),
      proposalId: this.id,
      expectedRevision: options.expectedRevision ?? this.revision,
      ...(options.expectedTargetHeadId
        ? { expectedTargetHeadId: options.expectedTargetHeadId }
        : { expectedTargetHeadId: this.proposal.targetHeadIdAtCreation }),
      ...(options.expectedTargetRefRevision ?? this.proposal.targetRefRevisionAtCreation
        ? {
            expectedTargetRefRevision:
              options.expectedTargetRefRevision ?? this.proposal.targetRefRevisionAtCreation,
          }
        : {}),
      actor,
    });
    if (!opened.ok) return opened;
    return {
      ok: true,
      value: new WorkbookVersionProposalWorkspaceHandleImpl(
        this.ctx,
        this,
        opened.value,
        (options.expectedRevision ?? this.revision) + 1,
      ),
    };
  }

  async markVerified(
    options: VersionProposalVerificationOptions,
  ): Promise<VersionResult<VersionProposalHandle>> {
    const actor = options.actor ?? defaultAuthor(this.ctx, 'user');
    if (!actor) return missingTrustedAuthorFailure('markProposalVerified', 'actor');
    const result = await markWorkbookVersionProposalVerifiedFacade(this.ctx, {
      clientRequestId: options.clientRequestId ?? defaultClientRequestId('proposal-verify'),
      proposalId: this.id,
      expectedRevision: options.expectedRevision ?? this.revision,
      verification: options.verification,
      actor,
    });
    return proposalHandleResult(this.ctx, result);
  }

  async markReadyForReview(
    options: VersionProposalHandleOptions = {},
  ): Promise<VersionResult<WorkbookVersionReviewRecord>> {
    const actor = options.actor ?? defaultAuthor(this.ctx, 'user');
    if (!actor) return missingTrustedAuthorFailure('openProposalReview', 'actor');
    return openWorkbookVersionProposalReviewFacade(this.ctx, {
      clientRequestId: options.clientRequestId ?? defaultClientRequestId('proposal-review-open'),
      proposalId: this.id,
      expectedRevision: options.expectedRevision ?? this.revision,
      actor,
    });
  }

  async accept(
    options: VersionProposalAcceptOptions = {},
  ): Promise<VersionResult<AgentProposalAcceptResult>> {
    const actor = options.actor ?? defaultAuthor(this.ctx, 'user');
    if (!actor) return missingTrustedAuthorFailure('acceptProposal', 'actor');
    const policy = options.policy ?? options.resolutionPolicy ?? 'fastForwardOnly';
    return acceptWorkbookVersionProposalFacade(this.ctx, {
      clientRequestId: options.clientRequestId ?? defaultClientRequestId('proposal-accept'),
      proposalId: this.id,
      expectedRevision: options.expectedRevision ?? this.revision,
      expectedTargetHeadId: options.expectedTargetHeadId ?? this.proposal.targetHeadIdAtCreation,
      ...(options.expectedTargetRefRevision ?? this.proposal.targetRefRevisionAtCreation
        ? {
            expectedTargetRefRevision:
              options.expectedTargetRefRevision ?? this.proposal.targetRefRevisionAtCreation,
          }
        : {}),
      actor,
      resolutionPolicy: policy,
    });
  }

  async reject(
    options: VersionProposalRejectOptions = {},
  ): Promise<VersionResult<VersionProposalHandle>> {
    const actor = options.actor ?? defaultAuthor(this.ctx, 'user');
    if (!actor) return missingTrustedAuthorFailure('rejectProposal', 'actor');
    const result = await rejectWorkbookVersionProposalFacade(this.ctx, {
      clientRequestId: options.clientRequestId ?? defaultClientRequestId('proposal-reject'),
      proposalId: this.id,
      expectedRevision: options.expectedRevision ?? this.revision,
      actor,
      ...(options.reason ? { reason: options.reason } : {}),
    });
    return proposalHandleResult(this.ctx, result);
  }

  async supersede(
    options: VersionProposalSupersedeOptions = {},
  ): Promise<VersionResult<VersionProposalHandle>> {
    const actor = options.actor ?? defaultAuthor(this.ctx, 'user');
    if (!actor) return missingTrustedAuthorFailure('supersedeProposal', 'actor');
    const result = await supersedeWorkbookVersionProposalFacade(this.ctx, {
      clientRequestId: options.clientRequestId ?? defaultClientRequestId('proposal-supersede'),
      proposalId: this.id,
      expectedRevision: options.expectedRevision ?? this.revision,
      actor,
      ...(options.supersededByProposalId
        ? { supersededByProposalId: options.supersededByProposalId }
        : {}),
      ...(options.reason ? { reason: options.reason } : {}),
    });
    return proposalHandleResult(this.ctx, result);
  }
}

class WorkbookVersionProposalWorkspaceHandleImpl implements VersionProposalWorkspaceHandle {
  constructor(
    private readonly ctx: DocumentContext,
    readonly proposal: VersionProposalHandle,
    readonly workspace: AgentProposalWorkspaceHandle,
    private readonly expectedProposalRevision: number,
  ) {}

  async workbook<WorkbookLike = unknown>(): Promise<WorkbookLike> {
    const session = this.workspace as unknown as {
      readonly getWorkbook?: () => WorkbookLike;
      readonly workbook?: () => WorkbookLike | Promise<WorkbookLike>;
    };
    if (typeof session.workbook === 'function') return session.workbook();
    if (typeof session.getWorkbook === 'function') return session.getWorkbook();
    throw new Error('Proposal workspace handle does not expose a workbook session.');
  }

  async commit(
    options: VersionProposalWorkspaceCommitOptions,
  ): Promise<VersionResult<VersionProposalHandle>> {
    const actor = options.actor ?? defaultAuthor(this.ctx, 'user');
    if (!actor) return missingTrustedAuthorFailure('commitProposalWorkspace', 'actor');
    const result = await commitWorkbookVersionProposalWorkspaceFacade(this.ctx, {
      clientRequestId: options.clientRequestId ?? defaultClientRequestId('proposal-workspace-commit'),
      proposalId: this.proposal.id,
      workspaceId: this.workspace.workspaceId,
      expectedRevision: options.expectedRevision ?? this.expectedProposalRevision,
      ...(options.expectedTargetHeadId
        ? { expectedTargetHeadId: options.expectedTargetHeadId }
        : expectedWorkspaceTargetHead(this.workspace)),
      ...(options.expectedTargetRefRevision ??
      this.workspace.targetRefRevisionAtCreation
        ? {
            expectedTargetRefRevision:
              options.expectedTargetRefRevision ?? this.workspace.targetRefRevisionAtCreation,
          }
        : {}),
      actor,
      message: options.message,
      ...(options.verification ? { verification: options.verification } : {}),
    });
    return proposalHandleResult(this.ctx, result);
  }

  async dispose(
    options: VersionProposalHandleOptions = {},
  ): Promise<VersionResult<{ readonly disposed: true }>> {
    const actor = options.actor ?? defaultAuthor(this.ctx, 'user');
    if (!actor) return missingTrustedAuthorFailure('disposeProposalWorkspace', 'actor');
    return disposeWorkbookVersionProposalWorkspaceFacade(this.ctx, {
      clientRequestId: options.clientRequestId ?? defaultClientRequestId('proposal-workspace-dispose'),
      workspaceId: this.workspace.workspaceId,
      ...(options.expectedTargetHeadId
        ? { expectedTargetHeadId: options.expectedTargetHeadId }
        : expectedWorkspaceTargetHead(this.workspace)),
      ...(options.expectedTargetRefRevision ??
      this.workspace.targetRefRevisionAtCreation
        ? {
            expectedTargetRefRevision:
              options.expectedTargetRefRevision ?? this.workspace.targetRefRevisionAtCreation,
          }
        : {}),
      actor,
    });
  }
}

function proposalHandleResult(
  ctx: DocumentContext,
  result: VersionResult<AgentProposal>,
): VersionResult<VersionProposalHandle> {
  return result.ok
    ? { ok: true, value: new WorkbookVersionProposalHandleImpl(ctx, result.value) }
    : result;
}

function proposalTargetRef(
  value: VersionCreateProposalPorcelainInput['into'],
): CreateAgentProposalInput['targetRef'] {
  if (!value || value === 'main') return 'refs/heads/main';
  return String(value).startsWith('refs/heads/')
    ? (String(value) as CreateAgentProposalInput['targetRef'])
    : (`refs/heads/${String(value)}` as CreateAgentProposalInput['targetRef']);
}

function expectedWorkspaceTargetHead(
  workspace: AgentProposalWorkspaceHandle,
): Pick<CommitProposalWorkspaceInput, 'expectedTargetHeadId'> | {} {
  return workspace.targetHeadIdAtCreation
    ? { expectedTargetHeadId: workspace.targetHeadIdAtCreation }
    : {};
}

function defaultRedactionPolicy(): CreateAgentProposalInput['redactionPolicy'] {
  return {
    mode: 'default',
    redactSecrets: true,
    redactExternalLinks: true,
    redactAgentTrace: true,
  };
}

function defaultAuthor(
  ctx: DocumentContext,
  kind: VersionAuthor['kind'],
  agentRunId?: string,
): VersionAuthor | undefined {
  const scope = typeof ctx.workbookLinkScope === 'function' ? ctx.workbookLinkScope() : null;
  if (!isTrustedWorkbookScope(scope)) return undefined;
  const principalId = stringValue(scope.actor);
  if (!principalId) return undefined;
  return {
    kind,
    trust: 'trusted',
    principalId,
    displayName: principalId,
    ...(agentRunId ? { agentRunId } : {}),
  };
}

function missingTrustedAuthorFailure<T>(
  operation: VersionProposalPublicOperation,
  option: string,
): VersionResult<T> {
  return proposalFailure(operation, [unauthorizedAuthorDiagnostic(operation, option)]);
}

function defaultClientRequestId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}:${uuid}`;
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isTrustedWorkbookScope(
  scope: unknown,
): scope is { readonly actor: unknown; readonly principal: { readonly tags: readonly unknown[] } } {
  if (!isRecord(scope)) return false;
  const principal = scope.principal;
  if (!isRecord(principal) || !Array.isArray(principal.tags)) return false;
  return principal.tags.includes('host:trusted');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
