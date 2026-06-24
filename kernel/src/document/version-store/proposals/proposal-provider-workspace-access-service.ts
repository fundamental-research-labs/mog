import type {
  AgentProposalWorkspaceHandle,
  DisposeProposalWorkspaceInput,
  GetProposalWorkspaceInput,
  VersionDiagnostic,
  VersionResult,
} from '@mog-sdk/contracts/api';

import type { AgentProposalMetadataStore, AgentProposalRecord } from './proposal-store';
import {
  proposalWorkspaceHandleWithTargetBinding,
  validateProposalWorkspaceHandle,
} from './proposal-provider-workspace-binding';
import {
  ensureProposalTargetBinding,
  type ProposalTargetHeadResolver,
} from './proposal-provider-target-binding';
import { getOpenProposalForWorkspace } from './proposal-provider-workspace-lookup';
import type { ProposalWorkspaceLifecycleService } from './proposal-workspace-lifecycle-service';

type WorkspaceAccessOperation = 'getProposalWorkspace' | 'disposeProposalWorkspace';

type WorkspaceAccessOptions = {
  readonly openStore: () => Promise<AgentProposalMetadataStore>;
  readonly workspaceService?: ProposalWorkspaceLifecycleService;
  readonly resolveTargetHead: ProposalTargetHeadResolver;
};

type OpenProposalForWorkspaceResult =
  | { readonly ok: true; readonly proposal: AgentProposalRecord }
  | { readonly ok: false; readonly result: VersionResult<never> };

export async function getProviderBackedProposalWorkspace(
  options: WorkspaceAccessOptions & { readonly input: GetProposalWorkspaceInput },
): Promise<VersionResult<AgentProposalWorkspaceHandle>> {
  const proposal = await getOpenProposalForWorkspaceOperation(
    options,
    'getProposalWorkspace',
    options.input.workspaceId,
  );
  if (!proposal.ok) return proposal.result;

  const targetBinding = await ensureProposalTargetBinding({
    proposal: proposal.proposal,
    operation: 'getProposalWorkspace',
    expected: options.input,
    resolveTargetHead: options.resolveTargetHead,
  });
  if (!targetBinding.ok) return targetBinding.result;

  if (!options.workspaceService) return workspaceUnavailable('getProposalWorkspace');
  const workspace = await callWorkspaceService('getProposalWorkspace', () =>
    options.workspaceService!.getProposalWorkspace(options.input),
  );
  if (!workspace.ok) return workspace;
  const workspaceBinding = validateProposalWorkspaceHandle({
    proposal: proposal.proposal,
    handle: workspace.value,
  });
  if (!workspaceBinding.ok) return workspaceBinding.result;
  return {
    ok: true,
    value: proposalWorkspaceHandleWithTargetBinding(proposal.proposal, workspace.value),
  };
}

export async function disposeProviderBackedProposalWorkspace(
  options: WorkspaceAccessOptions & { readonly input: DisposeProposalWorkspaceInput },
): Promise<VersionResult<{ readonly disposed: true }>> {
  const proposal = await getOpenProposalForWorkspaceOperation(
    options,
    'disposeProposalWorkspace',
    options.input.workspaceId,
  );
  if (!proposal.ok) return proposal.result;

  const targetBinding = await ensureProposalTargetBinding({
    proposal: proposal.proposal,
    operation: 'disposeProposalWorkspace',
    expected: options.input,
    resolveTargetHead: options.resolveTargetHead,
  });
  if (!targetBinding.ok) return targetBinding.result;

  if (!options.workspaceService) return workspaceUnavailable('disposeProposalWorkspace');
  const workspace = await callWorkspaceService('disposeProposalWorkspace', () =>
    options.workspaceService!.getProposalWorkspace(options.input),
  );
  if (!workspace.ok) return workspace;
  const workspaceBinding = validateProposalWorkspaceHandle({
    proposal: proposal.proposal,
    handle: workspace.value,
  });
  if (!workspaceBinding.ok) return workspaceBinding.result;
  return callWorkspaceService('disposeProposalWorkspace', () =>
    options.workspaceService!.disposeProposalWorkspace(options.input),
  );
}

async function getOpenProposalForWorkspaceOperation(
  options: WorkspaceAccessOptions,
  operation: WorkspaceAccessOperation,
  workspaceId: string,
): Promise<OpenProposalForWorkspaceResult> {
  let store: AgentProposalMetadataStore;
  try {
    store = await options.openStore();
  } catch {
    return {
      ok: false as const,
      result: targetUnavailable(
        operation,
        'VERSION_PROVIDER_ERROR',
        'Version proposal metadata store could not be opened.',
      ),
    };
  }

  return getOpenProposalForWorkspace({ store, workspaceId });
}

async function callWorkspaceService<T>(
  operation: WorkspaceAccessOperation,
  call: () => Promise<VersionResult<T>> | VersionResult<T>,
): Promise<VersionResult<T>> {
  try {
    return await call();
  } catch {
    return targetUnavailable(
      operation,
      'VERSION_PROPOSAL_WORKSPACE_ERROR',
      'The attached proposal workspace service failed before returning a public result.',
    );
  }
}

function workspaceUnavailable<T>(operation: WorkspaceAccessOperation): VersionResult<T> {
  return targetUnavailable(
    operation,
    'VERSION_PROPOSAL_WORKSPACE_UNAVAILABLE',
    'Provider-backed proposal workspace sessions require an attached branch-isolated workspace lifecycle service.',
    'warning',
  );
}

function targetUnavailable<T>(
  operation: WorkspaceAccessOperation,
  code: string,
  message: string,
  severity: VersionDiagnostic['severity'] = 'error',
): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: [diagnostic(code, severity, message, { operation })],
    },
  };
}

function diagnostic(
  code: string,
  severity: VersionDiagnostic['severity'],
  message: string,
  data?: Readonly<Record<string, string | number | boolean | null>>,
): VersionDiagnostic {
  return {
    code,
    severity,
    message,
    owner: 'version-store',
    ...(data === undefined ? {} : { data }),
  };
}
