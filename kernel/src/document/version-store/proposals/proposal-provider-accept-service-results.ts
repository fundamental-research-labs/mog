import type {
  AcceptAgentProposalInput,
  AgentProposalAcceptResult,
  VersionDiagnostic,
  VersionResult,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { isWorkbookCommitId } from './proposal-provider-service-utils';
import type { AgentProposalAcceptance, AgentProposalMetadataStore } from './proposal-store';

export async function markProposalStale(options: {
  readonly store: AgentProposalMetadataStore;
  readonly input: AcceptAgentProposalInput;
  readonly actualTargetHeadId: WorkbookCommitId;
  readonly targetHeadMoved: boolean;
  readonly diagnostics?: readonly VersionDiagnostic[];
}): Promise<VersionResult<AgentProposalAcceptResult>> {
  const diagnostics = [
    ...(options.targetHeadMoved
      ? [
          diagnostic('stale_head', 'warning', 'Target ref moved before proposal acceptance.', {
            expectedTargetHeadId: options.input.expectedTargetHeadId,
            actualTargetHeadId: options.actualTargetHeadId,
          }),
        ]
      : []),
    ...(options.diagnostics ?? []),
  ];
  const updated = await options.store.updateProposal({
    clientRequestId: options.input.clientRequestId,
    proposalId: options.input.proposalId,
    expectedRevision: options.input.expectedRevision,
    status: 'stale',
    trustedActor: options.input.actor,
    diagnostics: diagnostics.length
      ? diagnostics
      : [
          diagnostic(
            'proposal_stale',
            'warning',
            'Proposal became stale before acceptance completed.',
            {
              expectedTargetHeadId: options.input.expectedTargetHeadId,
              actualTargetHeadId: options.actualTargetHeadId,
            },
          ),
        ],
  });
  if (!updated.ok) return storeFailure(updated);

  return ok({
    status: 'stale',
    proposalId: updated.value.id as AgentProposalAcceptResult['proposalId'],
    expectedTargetHeadId: options.input.expectedTargetHeadId,
    actualTargetHeadId: options.actualTargetHeadId,
  });
}

export function fastForwardAcceptResult(
  proposalId: string,
  accepted: AgentProposalAcceptance,
): AgentProposalAcceptResult {
  return {
    status: 'fast_forwarded',
    proposalId: proposalId as AgentProposalAcceptResult['proposalId'],
    appliedCommitId: accepted.appliedCommitId,
    targetRef: accepted.targetRef as Extract<
      AgentProposalAcceptResult,
      { status: 'fast_forwarded' }
    >['targetRef'],
    newHeadId: accepted.appliedCommitId,
    refUpdateReceiptId:
      accepted.refUpdateReceiptId ??
      proposalAcceptReceiptId({
        proposalId,
        clientRequestId: 'recorded',
        appliedCommitId: accepted.appliedCommitId,
      }),
  };
}

export function proposalAcceptReceiptId(input: {
  readonly proposalId: string;
  readonly clientRequestId: string;
  readonly appliedCommitId: WorkbookCommitId;
}): string {
  return `proposal-accept:${input.proposalId}:${input.clientRequestId}:${input.appliedCommitId}`;
}

export function ok<T>(value: T): VersionResult<T> {
  return { ok: true, value };
}

export function storeFailure<T>(
  result: Extract<VersionResult<unknown>, { readonly ok: false }>,
): VersionResult<T> {
  return { ok: false, error: result.error };
}

export function staleRevision<T>(
  expectedRevision: number,
  actualRevision: number,
): VersionResult<T> {
  return {
    ok: false,
    error: { code: 'stale_revision', expectedRevision, actualRevision },
  };
}

export function invalidState<T>(
  state: string,
  allowed: readonly string[],
  reason: string,
): VersionResult<T> {
  return { ok: false, error: { code: 'invalid_state', state, allowed, reason } };
}

export function targetUnavailable<T>(
  code: string,
  message: string,
  severity: VersionDiagnostic['severity'] = 'error',
): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.acceptProposal',
      diagnostics: [diagnostic(code, severity, message)],
    },
  };
}

export function graphFailure<T>(diagnostics: readonly unknown[]): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.acceptProposal',
      diagnostics: diagnostics.length
        ? diagnostics.map(graphDiagnostic)
        : [
            diagnostic(
              'VERSION_PROVIDER_ERROR',
              'error',
              'Version graph failed without public diagnostics.',
            ),
          ],
    },
  };
}

export function diagnosticsFromFailureResult(
  result: VersionResult<never>,
): readonly VersionDiagnostic[] {
  return result.ok || result.error.code !== 'target_unavailable' ? [] : result.error.diagnostics;
}

export function actualHeadFromDiagnostics(
  diagnostics: readonly unknown[],
): WorkbookCommitId | undefined {
  for (const item of diagnostics) {
    if (!isRecord(item)) continue;
    const details = isRecord(item.details) ? item.details : null;
    const actualHead = details?.actualHead;
    if (isWorkbookCommitId(actualHead)) return actualHead;
    const commitId = item.commitId;
    if (isWorkbookCommitId(commitId)) return commitId;
  }
  return undefined;
}

export function isStaleFastForwardDiagnostic(code: unknown): boolean {
  return code === 'VERSION_REF_CONFLICT' || code === 'VERSION_UNSUPPORTED_PARENT_COMMIT';
}

function graphDiagnostic(value: unknown): VersionDiagnostic {
  if (!isRecord(value)) {
    return diagnostic(
      'VERSION_PROVIDER_ERROR',
      'error',
      'Version graph returned an invalid diagnostic.',
    );
  }
  return diagnostic(
    typeof value.code === 'string' ? value.code : 'VERSION_PROVIDER_ERROR',
    publicSeverity(value.severity),
    typeof value.message === 'string'
      ? value.message
      : 'Version graph returned a diagnostic without a public message.',
    graphDiagnosticData(value),
  );
}

function graphDiagnosticData(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string | number | boolean | null>> {
  const data: Record<string, string | number | boolean | null> = {};
  if (typeof value.refName === 'string') data.refName = value.refName;
  if (typeof value.commitId === 'string') data.commitId = value.commitId;
  const details = isRecord(value.details) ? value.details : null;
  if (details && typeof details.expectedHead === 'string') {
    data.expectedHead = details.expectedHead;
  }
  if (details && typeof details.actualHead === 'string') data.actualHead = details.actualHead;
  return data;
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

function publicSeverity(value: unknown): VersionDiagnostic['severity'] {
  return value === 'info' || value === 'warning' || value === 'error' ? value : 'error';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
