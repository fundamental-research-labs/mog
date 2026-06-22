import type { VersionDiagnostic, VersionResult, WorkbookCommitId } from '@mog-sdk/contracts/api';

import type { ReadBranchResult } from './branch-service';
import { branchCommitId } from './proposal-provider-service-utils';

type ProposalBranchHeadValidationBranchService = {
  readBranch(
    input: { readonly name: string } | string,
  ): Promise<ReadBranchResult> | ReadBranchResult;
};

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

function invalidState<T>(
  state: string,
  allowed: readonly string[],
  reason: string,
): VersionResult<T> {
  return { ok: false, error: { code: 'invalid_state', state, allowed, reason } };
}

function cloneDiagnostic(value: VersionDiagnostic, operation: string): VersionDiagnostic {
  return diagnostic(value.code, value.severity, value.message, {
    operation,
    ...(value.data ?? {}),
  });
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
    data,
  };
}
