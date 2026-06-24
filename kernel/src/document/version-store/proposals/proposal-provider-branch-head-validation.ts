import type { VersionDiagnostic, VersionResult, WorkbookCommitId } from '@mog-sdk/contracts/api';

import type { ReadBranchResult } from '../branch-service';
import type { VersionGraphReadRefResult } from '../graph';
import { branchCommitId } from './proposal-provider-service-utils';
import type { VersionStoreProvider } from '../provider';
import { namespaceForRegistry } from '../registry';

type ProposalBranchHeadValidationBranchService = {
  readBranch(
    input: { readonly name: string } | string,
  ): Promise<ReadBranchResult> | ReadBranchResult;
};

type ProposalBranchHeadValidationGraphProvider = Pick<
  VersionStoreProvider,
  'accessContext' | 'openGraph' | 'readGraphRegistry'
>;

export type ProposalBranchFastForwardValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly stale: true;
      readonly staleReason: 'proposal_branch_head_changed' | 'proposal_not_fast_forward';
      readonly diagnostics: readonly VersionDiagnostic[];
    }
  | { readonly ok: false; readonly result: VersionResult<never> };

export async function ensureProposalBranchHead(input: {
  readonly branchService?: ProposalBranchHeadValidationBranchService;
  readonly operation: string;
  readonly proposalBranchName: string;
  readonly expectedHeadCommitId: WorkbookCommitId;
}): Promise<{ readonly ok: true } | { readonly ok: false; readonly result: VersionResult<never> }> {
  if (!input.branchService?.readBranch) {
    return {
      ok: false,
      result: targetUnavailable(
        input.operation,
        'VERSION_REF_READ_UNAVAILABLE',
        'Provider-backed proposal workspace commit validation requires branch/ref reads.',
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
        'Version branch service failed while validating the proposal branch head.',
      ),
    };
  }

  if (!read.ok) return { ok: false, result: branchFailure(input.operation, read.diagnostics) };
  if (!read.branch) {
    return {
      ok: false,
      result: targetUnavailable(
        input.operation,
        'VERSION_DANGLING_REF',
        'Proposal branch does not resolve to a live branch after workspace commit.',
      ),
    };
  }

  const branchHead = branchCommitId(read.branch);
  if (branchHead === input.expectedHeadCommitId) return { ok: true };
  return {
    ok: false,
    result: invalidState(
      'proposal_commit_branch_head_mismatch',
      ['proposal_branch_head_commit'],
      'Proposal workspace commit id must match the proposal branch head.',
    ),
  };
}

export async function ensureProposalBranchFastForwardFromExpectedHead(input: {
  readonly graphProvider?: ProposalBranchHeadValidationGraphProvider;
  readonly operation: string;
  readonly proposalBranchName: string;
  readonly expectedHeadCommitId: WorkbookCommitId;
  readonly proposalCommitId: WorkbookCommitId;
}): Promise<ProposalBranchFastForwardValidationResult> {
  if (!input.graphProvider) {
    return {
      ok: false,
      result: targetUnavailable(
        input.operation,
        'VERSION_GRAPH_UNAVAILABLE',
        'Provider-backed proposal acceptance requires a visible version graph provider.',
      ),
    };
  }

  try {
    const registryRead = await input.graphProvider.readGraphRegistry();
    if (registryRead.status !== 'ok') {
      return { ok: false, result: graphFailure(input.operation, registryRead.diagnostics) };
    }

    const graph = await input.graphProvider.openGraph(
      namespaceForRegistry(registryRead.registry),
      input.graphProvider.accessContext,
    );
    const branchRef = await graph.readRef(`refs/heads/${input.proposalBranchName}`);
    if (branchRef.status !== 'success' || branchRef.ref.name === 'HEAD') {
      return {
        ok: false,
        result: graphFailure(
          input.operation,
          diagnosticsForMissingProposalBranch(input, branchRef),
        ),
      };
    }

    if (branchRef.ref.commitId !== input.proposalCommitId) {
      return {
        ok: false,
        stale: true,
        staleReason: 'proposal_branch_head_changed',
        diagnostics: [staleProposalBranchHeadDiagnostic(input, branchRef.ref.commitId)],
      };
    }

    const closure = await graph.readCommitClosure(input.proposalCommitId);
    if (closure.status !== 'success') {
      return { ok: false, result: graphFailure(input.operation, closure.diagnostics) };
    }
    if (!closure.commits.some((commit) => commit.id === input.expectedHeadCommitId)) {
      return {
        ok: false,
        stale: true,
        staleReason: 'proposal_not_fast_forward',
        diagnostics: [proposalNotFastForwardDiagnostic(input)],
      };
    }
  } catch {
    return {
      ok: false,
      result: targetUnavailable(
        input.operation,
        'VERSION_PROVIDER_ERROR',
        'Visible version graph could not validate the proposal branch head.',
      ),
    };
  }

  return { ok: true };
}

function targetUnavailable<T>(
  operation: string,
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

function branchFailure<T>(
  operation: string,
  diagnostics: readonly VersionDiagnostic[],
): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: diagnostics.length
        ? diagnostics.map((item) => cloneDiagnostic(item, operation))
        : [
            diagnostic(
              'VERSION_PROVIDER_ERROR',
              'error',
              'Version branch service failed without public diagnostics.',
              { operation },
            ),
          ],
    },
  };
}

function graphFailure<T>(operation: string, diagnostics: readonly unknown[]): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: diagnostics.length
        ? diagnostics.map((item) => graphDiagnostic(item, operation))
        : [
            diagnostic(
              'VERSION_PROVIDER_ERROR',
              'error',
              'Version graph failed without public diagnostics.',
              { operation },
            ),
          ],
    },
  };
}

function invalidState<T>(
  state: string,
  allowed: readonly string[],
  reason: string,
): VersionResult<T> {
  return { ok: false, error: { code: 'invalid_state', state, allowed, reason } };
}

function diagnosticsForMissingProposalBranch(
  input: {
    readonly operation: string;
    readonly proposalBranchName: string;
  },
  read: VersionGraphReadRefResult,
): readonly unknown[] {
  if (read.status !== 'success' && read.diagnostics.length > 0) {
    return read.diagnostics;
  }
  return [
    diagnostic(
      'VERSION_DANGLING_REF',
      'error',
      'Proposal branch does not resolve to a live branch before acceptance.',
      {
        operation: input.operation,
        proposalBranchName: input.proposalBranchName,
      },
    ),
  ];
}

function staleProposalBranchHeadDiagnostic(
  input: {
    readonly operation: string;
    readonly proposalBranchName: string;
    readonly proposalCommitId: WorkbookCommitId;
  },
  actualProposalBranchHeadId: WorkbookCommitId,
): VersionDiagnostic {
  return diagnostic(
    'stale_proposal_branch_head',
    'warning',
    'Proposal branch head changed after the proposal was committed.',
    {
      operation: input.operation,
      proposalBranchName: input.proposalBranchName,
      expectedProposalCommitId: input.proposalCommitId,
      actualProposalBranchHeadId,
    },
  );
}

function proposalNotFastForwardDiagnostic(input: {
  readonly operation: string;
  readonly proposalBranchName: string;
  readonly expectedHeadCommitId: WorkbookCommitId;
  readonly proposalCommitId: WorkbookCommitId;
}): VersionDiagnostic {
  return diagnostic(
    'proposal_not_fast_forward',
    'warning',
    'Proposal commit no longer descends from the expected target head.',
    {
      operation: input.operation,
      proposalBranchName: input.proposalBranchName,
      expectedTargetHeadId: input.expectedHeadCommitId,
      proposalCommitId: input.proposalCommitId,
    },
  );
}

function graphDiagnostic(value: unknown, operation: string): VersionDiagnostic {
  if (!isRecord(value)) {
    return diagnostic(
      'VERSION_PROVIDER_ERROR',
      'error',
      'Version graph returned an invalid diagnostic.',
      { operation },
    );
  }
  return diagnostic(
    typeof value.code === 'string' ? value.code : 'VERSION_PROVIDER_ERROR',
    publicSeverity(value.severity),
    typeof value.message === 'string'
      ? value.message
      : 'Version graph returned a diagnostic without a public message.',
    graphDiagnosticData(value, operation),
  );
}

function graphDiagnosticData(
  value: Readonly<Record<string, unknown>>,
  operation: string,
): Readonly<Record<string, string | number | boolean | null>> {
  const data: Record<string, string | number | boolean | null> = { operation };
  if (typeof value.refName === 'string') data.refName = value.refName;
  if (typeof value.commitId === 'string') data.commitId = value.commitId;
  const details = isRecord(value.details) ? value.details : null;
  if (details && typeof details.expectedHead === 'string') {
    data.expectedHead = details.expectedHead;
  }
  if (details && typeof details.actualHead === 'string') data.actualHead = details.actualHead;
  if (details && typeof details.expectedAncestor === 'string') {
    data.expectedAncestor = details.expectedAncestor;
  }
  return data;
}

function cloneDiagnostic(value: VersionDiagnostic, operation: string): VersionDiagnostic {
  return {
    code: value.code,
    severity: value.severity,
    message: value.message,
    ...(value.owner === undefined ? {} : { owner: value.owner }),
    ...(value.dependency === undefined ? {} : { dependency: value.dependency }),
    data: {
      operation,
      ...(value.data ?? {}),
    },
  };
}

function diagnostic(
  code: string,
  severity: VersionDiagnostic['severity'],
  message: string,
  data: Readonly<Record<string, string | number | boolean | null>> = {},
): VersionDiagnostic {
  return {
    code,
    severity,
    message,
    owner: 'version-store',
    data,
  };
}

function publicSeverity(value: unknown): VersionDiagnostic['severity'] {
  return value === 'info' || value === 'warning' || value === 'error' ? value : 'error';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
