import type { VersionResult, WorkbookCommitId } from '@mog-sdk/contracts/api';

import type { CreateBranchResult, ReadBranchResult } from '../branch-service';
import {
  branchFailure,
  diagnosticsFromProviderError,
  invalidBranchName,
  targetUnavailable,
} from './proposal-provider-service-diagnostics';
import type {
  ProposalBranchService,
  ProposalGraphProvider,
  ProposalProviderOperation,
  ResolvedBranchHead,
} from './proposal-provider-service-types';
import { PROPOSAL_BRANCH_AUTHOR } from './proposal-provider-service-types';
import { branchCommitId, parsePublicBranchName } from './proposal-provider-service-utils';
import type { AgentProposalMetadataStore, AgentProposalRecord } from './proposal-store';
import { namespaceForRegistry } from '../registry';

export async function openProviderBackedProposalStore(input: {
  readonly openStore: () => Promise<AgentProposalMetadataStore>;
  readonly operation: ProposalProviderOperation;
}): Promise<
  | { readonly ok: true; readonly value: AgentProposalMetadataStore }
  | { readonly ok: false; readonly result: VersionResult<never> }
> {
  try {
    return { ok: true, value: await input.openStore() };
  } catch {
    return {
      ok: false,
      result: targetUnavailable(
        input.operation,
        'VERSION_PROVIDER_ERROR',
        'Version proposal metadata store could not be opened.',
      ),
    };
  }
}

export async function resolveProviderBackedProposalTargetHead(input: {
  readonly branchService?: ProposalBranchService;
  readonly targetRef: string;
  readonly operation: ProposalProviderOperation;
}): Promise<
  | { readonly ok: true; readonly head: ResolvedBranchHead }
  | { readonly ok: false; readonly result: VersionResult<never> }
> {
  const branchName = parsePublicBranchName(input.targetRef);
  if (!branchName.ok) return { ok: false, result: branchName.result };
  if (!input.branchService?.readBranch) {
    return {
      ok: false,
      result: targetUnavailable(
        input.operation,
        'VERSION_REF_WRITE_UNAVAILABLE',
        'Provider-backed proposal creation requires an attached branch/ref service.',
      ),
    };
  }

  let read: ReadBranchResult;
  try {
    read = await input.branchService.readBranch({ name: branchName.branchName });
  } catch {
    return {
      ok: false,
      result: targetUnavailable(
        input.operation,
        'VERSION_PROVIDER_ERROR',
        'Version branch service failed while resolving the proposal target ref.',
      ),
    };
  }

  if (!read.ok) {
    return { ok: false, result: branchFailure(input.operation, read.diagnostics) };
  }
  if (!read.branch) {
    return {
      ok: false,
      result: targetUnavailable(
        input.operation,
        'VERSION_DANGLING_REF',
        'Proposal target ref does not resolve to a live branch.',
      ),
    };
  }

  const commitId = branchCommitId(read.branch);
  if (!commitId) {
    return {
      ok: false,
      result: targetUnavailable(
        input.operation,
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'Proposal target ref did not expose a public commit id.',
      ),
    };
  }

  return {
    ok: true,
    head: {
      branchName: branchName.branchName,
      refName: branchName.refName,
      commitId,
      refVersion: read.branch.ref.refVersion,
    },
  };
}

export async function readOptionalProviderBackedProposalBranch(input: {
  readonly branchService?: ProposalBranchService;
  readonly proposalBranchName: string;
  readonly baseCommitId: WorkbookCommitId;
  readonly operation: ProposalProviderOperation;
}): Promise<
  | { readonly ok: true; readonly exists: boolean }
  | { readonly ok: false; readonly result: VersionResult<never> }
> {
  if (!input.branchService?.readBranch) {
    return {
      ok: false,
      result: targetUnavailable(
        input.operation,
        'VERSION_REF_WRITE_UNAVAILABLE',
        'Provider-backed proposal creation requires an attached branch/ref service.',
      ),
    };
  }

  let read: ReadBranchResult;
  try {
    read = await input.branchService.readBranch({ name: input.proposalBranchName });
  } catch {
    return {
      ok: false,
      result: targetUnavailable(
        input.operation,
        'VERSION_PROVIDER_ERROR',
        'Version branch service failed while checking the proposal branch.',
      ),
    };
  }

  if (!read.ok) return { ok: false, result: branchFailure(input.operation, read.diagnostics) };
  if (!read.branch) return { ok: true, exists: false };

  const currentHead = branchCommitId(read.branch);
  if (currentHead === input.baseCommitId) return { ok: true, exists: true };
  return {
    ok: false,
    result: invalidBranchName(
      input.proposalBranchName,
      'Proposal branch name already exists at a different commit.',
    ),
  };
}

export async function createProviderBackedProposalBranch(input: {
  readonly branchService?: ProposalBranchService;
  readonly proposalBranchName: string;
  readonly baseCommitId: WorkbookCommitId;
  readonly operation: ProposalProviderOperation;
}): Promise<{ readonly ok: true } | { readonly ok: false; readonly result: VersionResult<never> }> {
  if (!input.branchService?.createBranch) {
    return {
      ok: false,
      result: targetUnavailable(
        input.operation,
        'VERSION_REF_WRITE_UNAVAILABLE',
        'Provider-backed proposal creation requires branch/ref writes.',
      ),
    };
  }

  let created: CreateBranchResult;
  try {
    created = await input.branchService.createBranch({
      name: input.proposalBranchName,
      targetCommitId: input.baseCommitId,
      expectedAbsent: true,
      baseCommitId: input.baseCommitId,
      createdBy: PROPOSAL_BRANCH_AUTHOR,
    });
  } catch {
    return {
      ok: false,
      result: targetUnavailable(
        input.operation,
        'VERSION_PROVIDER_ERROR',
        'Version branch service failed while creating the proposal branch.',
      ),
    };
  }

  if (created.ok) return { ok: true };

  if (created.error.code === 'refAlreadyExists') {
    return readOptionalProviderBackedProposalBranch(input);
  }
  return { ok: false, result: branchFailure(input.operation, created.diagnostics) };
}

export async function ensureProviderBackedProposalBranch(input: {
  readonly branchService?: ProposalBranchService;
  readonly proposal: AgentProposalRecord;
  readonly operation: ProposalProviderOperation;
}): Promise<{ readonly ok: true } | { readonly ok: false; readonly result: VersionResult<never> }> {
  const existingBranch = await readOptionalProviderBackedProposalBranch({
    branchService: input.branchService,
    proposalBranchName: input.proposal.proposalBranchName,
    baseCommitId: input.proposal.baseCommitId,
    operation: input.operation,
  });
  if (!existingBranch.ok) return existingBranch;
  if (existingBranch.exists) return { ok: true };
  return createProviderBackedProposalBranch({
    branchService: input.branchService,
    proposalBranchName: input.proposal.proposalBranchName,
    baseCommitId: input.proposal.baseCommitId,
    operation: input.operation,
  });
}

export async function ensureProviderBackedProposalCommitExists(input: {
  readonly graphProvider?: ProposalGraphProvider;
  readonly commitId: WorkbookCommitId;
  readonly operation: ProposalProviderOperation;
}): Promise<{ readonly ok: true } | { readonly ok: false; readonly result: VersionResult<never> }> {
  if (!input.graphProvider) {
    return {
      ok: false,
      result: targetUnavailable(
        input.operation,
        'VERSION_GRAPH_UNAVAILABLE',
        'Provider-backed proposal commit validation requires a visible version graph provider.',
      ),
    };
  }

  try {
    const registryRead = await input.graphProvider.readGraphRegistry();
    if (registryRead.status !== 'ok') {
      return { ok: false, result: branchFailure(input.operation, registryRead.diagnostics) };
    }
    const graph = await input.graphProvider.openGraph(
      namespaceForRegistry(registryRead.registry),
      input.graphProvider.accessContext,
    );
    const read = await graph.readCommit(input.commitId);
    if (read.status === 'success') return { ok: true };
    return { ok: false, result: branchFailure(input.operation, read.diagnostics) };
  } catch (error) {
    return {
      ok: false,
      result: targetUnavailable(
        input.operation,
        'VERSION_PROVIDER_ERROR',
        'Visible version graph could not validate the proposal commit.',
        'error',
        diagnosticsFromProviderError(error),
      ),
    };
  }
}
