import type {
  VersionDiagnostic,
  VersionRecordRevision,
  VersionResult,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { invalidState } from './proposal-provider-service-diagnostics';
import type {
  ProposalProviderOperation,
  ResolvedBranchHead,
} from './proposal-provider-service-types';
import type { AgentProposalRecord } from './proposal-store';
import { refVersionsEqual, type RefVersion } from '../refs/ref-store';

export type ProposalTargetBindingExpectation = {
  readonly expectedTargetHeadId?: WorkbookCommitId;
  readonly expectedTargetRefRevision?: VersionRecordRevision;
};

export type ProposalTargetHeadResolver = (
  targetRef: string,
  operation: ProposalProviderOperation,
) => Promise<
  | { readonly ok: true; readonly head: ResolvedBranchHead }
  | { readonly ok: false; readonly result: VersionResult<never> }
>;

export async function ensureProposalTargetBinding(input: {
  readonly proposal: AgentProposalRecord;
  readonly operation: ProposalProviderOperation;
  readonly expected?: ProposalTargetBindingExpectation;
  readonly resolveTargetHead: ProposalTargetHeadResolver;
}): Promise<
  | { readonly ok: true; readonly head: ResolvedBranchHead }
  | { readonly ok: false; readonly result: VersionResult<never> }
> {
  const expected = validateExpectedTargetBinding(input.proposal, input.expected);
  if (!expected.ok) return expected;

  const targetRefVersionAtCreation = input.proposal.targetRefVersionAtCreation;
  if (targetRefVersionAtCreation === undefined) {
    return {
      ok: false,
      result: targetBindingUnavailable(
        input.operation,
        missingTargetRefRevisionDiagnostic(input.proposal),
      ),
    };
  }

  const current = await input.resolveTargetHead(input.proposal.targetRef, input.operation);
  if (!current.ok) return current;

  if (current.head.commitId !== input.proposal.targetHeadIdAtCreation) {
    return {
      ok: false,
      result: targetBindingUnavailable(
        input.operation,
        staleTargetHeadDiagnostic({
          proposal: input.proposal,
          expectedTargetRefRevision: targetRefVersionAtCreation,
          actualTargetHeadId: current.head.commitId,
          actualTargetRefRevision: current.head.refVersion,
        }),
      ),
    };
  }

  if (!refVersionsEqual(current.head.refVersion, targetRefVersionAtCreation)) {
    return {
      ok: false,
      result: targetBindingUnavailable(
        input.operation,
        staleTargetRefRevisionDiagnostic({
          proposal: input.proposal,
          expectedTargetRefRevision: targetRefVersionAtCreation,
          actualTargetRefRevision: current.head.refVersion,
        }),
      ),
    };
  }

  return current;
}

function validateExpectedTargetBinding(
  proposal: AgentProposalRecord,
  expected: ProposalTargetBindingExpectation | undefined,
): { readonly ok: true } | { readonly ok: false; readonly result: VersionResult<never> } {
  if (
    expected?.expectedTargetHeadId !== undefined &&
    expected.expectedTargetHeadId !== proposal.targetHeadIdAtCreation
  ) {
    return {
      ok: false,
      result: invalidState(
        'proposal_target_head_binding_mismatch',
        ['matching_target_head'],
        'Proposal operations must use the target head recorded when the proposal was created.',
      ),
    };
  }

  if (
    expected?.expectedTargetRefRevision !== undefined &&
    proposal.targetRefVersionAtCreation !== undefined &&
    !recordRevisionsEqual(expected.expectedTargetRefRevision, proposal.targetRefVersionAtCreation)
  ) {
    return {
      ok: false,
      result: invalidState(
        'proposal_target_ref_revision_binding_mismatch',
        ['matching_target_ref_revision'],
        'Proposal operations must use the target ref revision recorded when the proposal was created.',
      ),
    };
  }

  return { ok: true };
}

function targetBindingUnavailable<T>(
  operation: ProposalProviderOperation,
  diagnostic: VersionDiagnostic,
): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: [diagnostic],
    },
  };
}

function missingTargetRefRevisionDiagnostic(proposal: AgentProposalRecord): VersionDiagnostic {
  return {
    code: 'proposal_target_ref_revision_missing',
    severity: 'error',
    message:
      'Proposal record is missing the target ref revision required for workspace operations.',
    owner: 'version-store',
    data: {
      proposalId: proposal.id,
      expectedTargetHeadId: proposal.targetHeadIdAtCreation,
    },
  };
}

function staleTargetHeadDiagnostic(input: {
  readonly proposal: AgentProposalRecord;
  readonly expectedTargetRefRevision: RefVersion;
  readonly actualTargetHeadId: WorkbookCommitId;
  readonly actualTargetRefRevision: RefVersion;
}): VersionDiagnostic {
  return {
    code: 'stale_proposal_target_head',
    severity: 'warning',
    message: 'Proposal target ref moved after the proposal was created.',
    owner: 'version-store',
    data: {
      proposalId: input.proposal.id,
      expectedTargetHeadId: input.proposal.targetHeadIdAtCreation,
      actualTargetHeadId: input.actualTargetHeadId,
      expectedTargetRefRevision: revisionLabel(input.expectedTargetRefRevision),
      actualTargetRefRevision: revisionLabel(input.actualTargetRefRevision),
    },
  };
}

function staleTargetRefRevisionDiagnostic(input: {
  readonly proposal: AgentProposalRecord;
  readonly expectedTargetRefRevision: RefVersion;
  readonly actualTargetRefRevision: RefVersion;
}): VersionDiagnostic {
  return {
    code: 'stale_proposal_target_ref_revision',
    severity: 'warning',
    message: 'Proposal target ref revision changed after the proposal was created.',
    owner: 'version-store',
    data: {
      proposalId: input.proposal.id,
      expectedTargetHeadId: input.proposal.targetHeadIdAtCreation,
      expectedTargetRefRevision: revisionLabel(input.expectedTargetRefRevision),
      actualTargetRefRevision: revisionLabel(input.actualTargetRefRevision),
    },
  };
}

function recordRevisionsEqual(left: VersionRecordRevision, right: RefVersion): boolean {
  return left.kind === right.kind && left.value === right.value;
}

function revisionLabel(revision: VersionRecordRevision | RefVersion): string {
  return `${revision.kind}:${revision.value}`;
}
