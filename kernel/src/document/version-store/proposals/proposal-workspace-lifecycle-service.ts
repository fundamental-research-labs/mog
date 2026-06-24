import type {
  AcceptAgentProposalInput,
  AgentProposal,
  AgentProposalAcceptResult,
  AgentProposalWorkspaceHandle,
  CommitProposalWorkspaceInput,
  DisposeProposalWorkspaceInput,
  GetProposalWorkspaceInput,
  StartProposalWorkspaceInput,
  VersionDiagnostic,
  VersionResult,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { acceptProviderBackedAgentProposal } from './proposal-provider-accept-service';
import type {
  AgentProposalMetadataStore,
  AgentProposalRecord,
  UpdateAgentProposalStoreInput,
} from './proposal-store';

type MaybePromise<T> = T | Promise<T>;
type AcceptProviderBackedAgentProposalOptions = Parameters<
  typeof acceptProviderBackedAgentProposal
>[0];

export type ProviderBackedProposalWorkspaceInput = {
  readonly proposal: AgentProposal;
  readonly proposalRecord: AgentProposalRecord;
};

export type ProviderBackedStartProposalWorkspaceInput = StartProposalWorkspaceInput &
  ProviderBackedProposalWorkspaceInput;

export type ProviderBackedCommitProposalWorkspaceInput = CommitProposalWorkspaceInput &
  ProviderBackedProposalWorkspaceInput;

export type ProviderBackedProposalWorkspaceCommitResult = {
  readonly workspaceId: string;
  readonly proposalCommitId: WorkbookCommitId;
  readonly proposalBranchName?: AgentProposal['proposalBranchName'];
  readonly committedFromHeadId?: WorkbookCommitId;
  readonly diagnostics?: readonly VersionDiagnostic[];
};

export type ProposalWorkspaceLifecycleService = {
  startProposalWorkspace(
    input: ProviderBackedStartProposalWorkspaceInput,
  ): MaybePromise<VersionResult<AgentProposalWorkspaceHandle>>;
  getProposalWorkspace(
    input: GetProposalWorkspaceInput,
  ): MaybePromise<VersionResult<AgentProposalWorkspaceHandle>>;
  disposeProposalWorkspace(
    input: DisposeProposalWorkspaceInput,
  ): MaybePromise<VersionResult<{ readonly disposed: true }>>;
  commitProposalWorkspace(
    input: ProviderBackedCommitProposalWorkspaceInput,
  ): MaybePromise<VersionResult<ProviderBackedProposalWorkspaceCommitResult>>;
};

export function isProposalWorkspaceLifecycleService(
  value: unknown,
): value is ProposalWorkspaceLifecycleService {
  return (
    isRecord(value) &&
    typeof value.startProposalWorkspace === 'function' &&
    typeof value.getProposalWorkspace === 'function' &&
    typeof value.disposeProposalWorkspace === 'function' &&
    typeof value.commitProposalWorkspace === 'function'
  );
}

export async function acceptProviderBackedAgentProposalWithStaleRecovery(
  options: AcceptProviderBackedAgentProposalOptions,
): Promise<VersionResult<AgentProposalAcceptResult>> {
  let store: AgentProposalMetadataStore;
  try {
    store = await options.openStore();
  } catch {
    return acceptProviderBackedAgentProposal(options);
  }

  const proposal = await store.getProposal(options.input.proposalId);
  if (proposal.ok) {
    const retry = staleAcceptRetryResult(options.input, proposal.value);
    if (retry) return retry;
  }

  return acceptProviderBackedAgentProposal({
    ...options,
    openStore: async () => staleAcceptRecoveryStore(store, options.input),
  });
}

export function proposalWorkspaceStaleHeadResult<T>(input: {
  readonly operation: 'commitProposalWorkspace';
  readonly proposalId: string;
  readonly workspaceId: string;
  readonly proposalBranchName: string;
  readonly expectedWorkspaceHeadId: WorkbookCommitId;
  readonly actualProposalBranchHeadId: WorkbookCommitId;
}): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${input.operation}`,
      diagnostics: [proposalWorkspaceStaleHeadDiagnostic(input)],
    },
  };
}

export function proposalWorkspaceStaleHeadDiagnostic(input: {
  readonly operation: 'commitProposalWorkspace';
  readonly proposalId: string;
  readonly workspaceId: string;
  readonly proposalBranchName: string;
  readonly expectedWorkspaceHeadId: WorkbookCommitId;
  readonly actualProposalBranchHeadId: WorkbookCommitId;
}): VersionDiagnostic {
  return diagnostic(
    'stale_proposal_workspace_head',
    'warning',
    'Proposal workspace branch head changed after the workspace was opened.',
    {
      operation: input.operation,
      proposalId: input.proposalId,
      workspaceId: input.workspaceId,
      proposalBranchName: input.proposalBranchName,
      expectedWorkspaceHeadId: input.expectedWorkspaceHeadId,
      actualProposalBranchHeadId: input.actualProposalBranchHeadId,
    },
  );
}

function staleAcceptRecoveryStore(
  store: AgentProposalMetadataStore,
  input: AcceptAgentProposalInput,
): AgentProposalMetadataStore {
  return {
    documentScope: store.documentScope,
    createProposal: (createInput) => store.createProposal(createInput),
    getProposal: (proposalId) => store.getProposal(proposalId),
    getProposalByWorkspaceId: (workspaceId) => store.getProposalByWorkspaceId(workspaceId),
    listProposals: (listInput) => store.listProposals(listInput),
    updateProposal: (updateInput) =>
      store.updateProposal(annotateStaleAcceptRetryUpdate(input, updateInput)),
  };
}

function annotateStaleAcceptRetryUpdate(
  input: AcceptAgentProposalInput,
  updateInput: UpdateAgentProposalStoreInput,
): UpdateAgentProposalStoreInput {
  if (
    updateInput.status !== 'stale' ||
    updateInput.proposalId !== input.proposalId ||
    updateInput.clientRequestId !== input.clientRequestId ||
    updateInput.expectedRevision !== input.expectedRevision
  ) {
    return updateInput;
  }

  return {
    ...updateInput,
    diagnostics: staleAcceptRetryDiagnostics(input, updateInput.diagnostics ?? []),
  };
}

function staleAcceptRetryDiagnostics(
  input: AcceptAgentProposalInput,
  diagnostics: readonly VersionDiagnostic[],
): readonly VersionDiagnostic[] {
  const actualTargetHeadId =
    actualTargetHeadIdFromDiagnostics(diagnostics) ?? input.expectedTargetHeadId;
  const retryData = {
    operation: 'acceptProposal',
    acceptClientRequestId: input.clientRequestId,
    expectedTargetHeadId: input.expectedTargetHeadId,
    actualTargetHeadId,
  } as const;

  if (diagnostics.length === 0) {
    return [
      diagnostic(
        'proposal_accept_stale_retry',
        'warning',
        'Proposal acceptance reached a durable stale result.',
        retryData,
      ),
    ];
  }

  return diagnostics.map((item) => ({
    code: item.code,
    severity: item.severity,
    message: item.message,
    ...(item.owner === undefined ? {} : { owner: item.owner }),
    ...(item.dependency === undefined ? {} : { dependency: item.dependency }),
    data: {
      ...(item.data ?? {}),
      ...retryData,
    },
  }));
}

function staleAcceptRetryResult(
  input: AcceptAgentProposalInput,
  proposal: AgentProposalRecord,
): VersionResult<AgentProposalAcceptResult> | null {
  if (proposal.status !== 'stale') return null;
  for (const item of proposal.diagnostics) {
    const data = item.data;
    if (
      data?.operation !== 'acceptProposal' ||
      data.acceptClientRequestId !== input.clientRequestId ||
      data.expectedTargetHeadId !== input.expectedTargetHeadId ||
      typeof data.actualTargetHeadId !== 'string'
    ) {
      continue;
    }

    return {
      ok: true,
      value: {
        status: 'stale',
        proposalId: proposal.id,
        expectedTargetHeadId: input.expectedTargetHeadId,
        actualTargetHeadId: data.actualTargetHeadId as WorkbookCommitId,
      },
    };
  }
  return null;
}

function actualTargetHeadIdFromDiagnostics(
  diagnostics: readonly VersionDiagnostic[],
): WorkbookCommitId | undefined {
  for (const item of diagnostics) {
    const actualTargetHeadId = item.data?.actualTargetHeadId;
    if (typeof actualTargetHeadId === 'string') return actualTargetHeadId as WorkbookCommitId;
    const actualHead = item.data?.actualHead;
    if (typeof actualHead === 'string') return actualHead as WorkbookCommitId;
  }
  return undefined;
}

function diagnostic(
  code: string,
  severity: VersionDiagnostic['severity'],
  message: string,
  data: Readonly<Record<string, string | number | boolean | null>>,
): VersionDiagnostic {
  return {
    code,
    severity,
    message,
    owner: 'version-store',
    data,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
