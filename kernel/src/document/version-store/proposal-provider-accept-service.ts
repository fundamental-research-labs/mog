import type {
  AcceptAgentProposalInput,
  AgentProposalAcceptResult,
  VersionDiagnostic,
  VersionResult,
  WorkbookCommitId,
  WorkbookVersionReviewRecord,
} from '@mog-sdk/contracts/api';

import type { ResolvedBranchHead } from './proposal-provider-service';
import { isWorkbookCommitId } from './proposal-provider-service-utils';
import type { AgentProposalAcceptance, AgentProposalMetadataStore } from './proposal-store';
import type { VersionStoreProvider } from './provider';
import { namespaceForRegistry } from './registry';
import type { WorkbookVersionMarkReviewAppliedInput } from './review-service';

type ProposalGraphProvider = Pick<
  VersionStoreProvider,
  'accessContext' | 'openGraph' | 'readGraphRegistry'
>;

type ResolutionResult =
  | { readonly ok: true; readonly head: ResolvedBranchHead }
  | { readonly ok: false; readonly result: VersionResult<never> };

type CommitExistsResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<never> };

type FastForwardTargetResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly stale?: boolean;
      readonly actualTargetHeadId?: WorkbookCommitId;
      readonly result: VersionResult<never>;
    };

export async function acceptProviderBackedAgentProposal(options: {
  readonly input: AcceptAgentProposalInput;
  readonly openStore: () => Promise<AgentProposalMetadataStore>;
  readonly graphProvider?: ProposalGraphProvider;
  readonly ensureCommitExists: (commitId: WorkbookCommitId) => Promise<CommitExistsResult>;
  readonly resolveTargetHead: (targetRef: string) => Promise<ResolutionResult>;
  readonly getReview?: (reviewId: string) => Promise<VersionResult<WorkbookVersionReviewRecord>>;
  readonly markReviewApplied?: (
    input: WorkbookVersionMarkReviewAppliedInput,
  ) => Promise<VersionResult<WorkbookVersionReviewRecord>>;
}): Promise<VersionResult<AgentProposalAcceptResult>> {
  const store = await openProposalStore(options.openStore);
  if (!store.ok) return store.result;

  const proposalResult = await store.value.getProposal(options.input.proposalId);
  if (!proposalResult.ok) return storeFailure(proposalResult);
  const proposal = proposalResult.value;

  if (proposal.status === 'applied' && proposal.accepted) {
    const finalizedReview = await markLinkedReviewApplied({
      input: options.input,
      reviewId: proposal.reviewId,
      markReviewApplied: options.markReviewApplied,
    });
    if (!finalizedReview.ok) return finalizedReview.result;
    return ok(fastForwardAcceptResult(proposal.id, proposal.accepted));
  }
  if (proposal.revision !== options.input.expectedRevision) {
    return staleRevision(options.input.expectedRevision, proposal.revision);
  }
  if (proposal.status !== 'ready_for_review') {
    return invalidState(
      'proposal_not_ready_for_review',
      ['ready_for_review'],
      'Only ready-for-review proposals can be accepted.',
    );
  }
  if (!proposal.proposalCommitId) {
    return invalidState(
      'proposal_commit_required',
      ['committed_proposal'],
      'Proposal acceptance requires a proposal commit id.',
    );
  }
  const reviewReady = await requireApprovedProposalReview({
    proposalId: proposal.id,
    baseCommitId: proposal.baseCommitId,
    proposalCommitId: proposal.proposalCommitId,
    reviewId: proposal.reviewId,
    getReview: options.getReview,
  });
  if (!reviewReady.ok) return reviewReady.result;
  const reviewFinalizerReady = ensureReviewFinalizerAvailable({
    reviewId: proposal.reviewId,
    markReviewApplied: options.markReviewApplied,
  });
  if (!reviewFinalizerReady.ok) return reviewFinalizerReady.result;

  const commitExists = await options.ensureCommitExists(proposal.proposalCommitId);
  if (!commitExists.ok) return commitExists.result;

  const target = await options.resolveTargetHead(proposal.targetRef);
  if (!target.ok) return target.result;

  if (
    target.head.commitId !== options.input.expectedTargetHeadId ||
    target.head.commitId !== proposal.baseCommitId
  ) {
    return markProposalStale({
      store: store.value,
      input: options.input,
      actualTargetHeadId: target.head.commitId,
    });
  }

  const advanced = await fastForwardTargetRef(options.graphProvider, {
    targetRef: proposal.targetRef,
    nextCommitId: proposal.proposalCommitId,
    expectedHeadCommitId: proposal.baseCommitId,
    expectedRefVersion: target.head.refVersion,
  });
  if (!advanced.ok) {
    if (!advanced.stale) return advanced.result;
    return markProposalStale({
      store: store.value,
      input: options.input,
      actualTargetHeadId: advanced.actualTargetHeadId ?? target.head.commitId,
    });
  }

  const accepted = {
    targetRef: proposal.targetRef,
    expectedTargetHeadId: options.input.expectedTargetHeadId,
    appliedCommitId: proposal.proposalCommitId,
    refUpdateReceiptId: proposalAcceptReceiptId({
      proposalId: proposal.id,
      clientRequestId: options.input.clientRequestId,
      appliedCommitId: proposal.proposalCommitId,
    }),
  };
  const updated = await store.value.updateProposal({
    clientRequestId: options.input.clientRequestId,
    proposalId: options.input.proposalId,
    expectedRevision: options.input.expectedRevision,
    status: 'applied',
    trustedActor: options.input.actor,
    accepted,
  });
  if (!updated.ok) return storeFailure(updated);

  const finalizedReview = await markLinkedReviewApplied({
    input: options.input,
    reviewId: reviewReady.review.id,
    markReviewApplied: options.markReviewApplied,
  });
  if (!finalizedReview.ok) return finalizedReview.result;

  return ok(fastForwardAcceptResult(updated.value.id, accepted));
}

async function requireApprovedProposalReview(input: {
  readonly proposalId: string;
  readonly baseCommitId: WorkbookCommitId;
  readonly proposalCommitId: WorkbookCommitId;
  readonly reviewId?: string;
  readonly getReview?: (reviewId: string) => Promise<VersionResult<WorkbookVersionReviewRecord>>;
}): Promise<
  | { readonly ok: true; readonly review: WorkbookVersionReviewRecord }
  | { readonly ok: false; readonly result: VersionResult<never> }
> {
  if (!input.reviewId) {
    return {
      ok: false,
      result: invalidState(
        'proposal_review_required',
        ['approved_review'],
        'Proposal acceptance requires a linked approved review.',
      ),
    };
  }
  if (!input.getReview) {
    return {
      ok: false,
      result: targetUnavailable(
        'VERSION_REVIEW_SERVICE_UNAVAILABLE',
        'Proposal acceptance requires an attached review service.',
      ),
    };
  }

  const review = await input.getReview(input.reviewId);
  if (!review.ok) return { ok: false, result: review };
  if (review.value.status !== 'approved') {
    return {
      ok: false,
      result: invalidState(
        'proposal_review_not_approved',
        ['approved'],
        'Proposal acceptance requires the linked review to be approved.',
      ),
    };
  }
  if (
    review.value.subject.kind !== 'proposal' ||
    review.value.subject.proposalId !== input.proposalId ||
    review.value.subject.baseCommitId !== input.baseCommitId ||
    review.value.subject.headCommitId !== input.proposalCommitId
  ) {
    return {
      ok: false,
      result: invalidState(
        'proposal_review_mismatch',
        ['matching_proposal_review'],
        'Proposal acceptance requires an approved review for the same proposal commit range.',
      ),
    };
  }
  return { ok: true, review: review.value };
}

function ensureReviewFinalizerAvailable(input: {
  readonly reviewId?: string;
  readonly markReviewApplied?: (
    reviewInput: WorkbookVersionMarkReviewAppliedInput,
  ) => Promise<VersionResult<WorkbookVersionReviewRecord>>;
}): { readonly ok: true } | { readonly ok: false; readonly result: VersionResult<never> } {
  if (!input.reviewId || input.markReviewApplied) return { ok: true };
  return {
    ok: false,
    result: targetUnavailable(
      'VERSION_REVIEW_FINALIZER_UNAVAILABLE',
      'Proposal acceptance requires an attached review service that can finalize the linked review.',
    ),
  };
}

async function markLinkedReviewApplied(input: {
  readonly input: AcceptAgentProposalInput;
  readonly reviewId?: string;
  readonly markReviewApplied?: (
    reviewInput: WorkbookVersionMarkReviewAppliedInput,
  ) => Promise<VersionResult<WorkbookVersionReviewRecord>>;
}): Promise<{ readonly ok: true } | { readonly ok: false; readonly result: VersionResult<never> }> {
  const finalizerReady = ensureReviewFinalizerAvailable(input);
  if (!finalizerReady.ok) return finalizerReady;
  if (!input.reviewId) return { ok: true };
  const applied = await input.markReviewApplied!({
    reviewId: input.reviewId,
    clientRequestId: `${input.input.clientRequestId}:review-applied`,
    actor: input.input.actor,
  });
  return applied.ok ? { ok: true } : { ok: false, result: applied };
}

async function fastForwardTargetRef(
  graphProvider: ProposalGraphProvider | undefined,
  input: {
    readonly targetRef: string;
    readonly nextCommitId: WorkbookCommitId;
    readonly expectedHeadCommitId: WorkbookCommitId;
    readonly expectedRefVersion: ResolvedBranchHead['refVersion'];
  },
): Promise<FastForwardTargetResult> {
  if (!graphProvider) {
    return {
      ok: false,
      result: targetUnavailable(
        'VERSION_GRAPH_UNAVAILABLE',
        'Provider-backed proposal accept requires a visible version graph provider.',
      ),
    };
  }

  try {
    const registryRead = await graphProvider.readGraphRegistry();
    if (registryRead.status !== 'ok') {
      return { ok: false, result: graphFailure(registryRead.diagnostics) };
    }
    const graph = await graphProvider.openGraph(
      namespaceForRegistry(registryRead.registry),
      graphProvider.accessContext,
    );
    const advanced = await graph.fastForwardRef({
      targetRef: input.targetRef,
      expectedHeadCommitId: input.expectedHeadCommitId,
      expectedTargetRefVersion: input.expectedRefVersion,
      nextCommitId: input.nextCommitId,
      updatedBy: {
        authorId: 'version-proposal-service',
        actorKind: 'system',
        displayName: 'Version Proposal Service',
      },
    });
    if (advanced.status === 'success') return { ok: true };
    return {
      ok: false,
      stale: advanced.diagnostics.some((item) => item.code === 'VERSION_REF_CONFLICT'),
      actualTargetHeadId: actualHeadFromDiagnostics(advanced.diagnostics),
      result: graphFailure(advanced.diagnostics),
    };
  } catch {
    return {
      ok: false,
      result: targetUnavailable(
        'VERSION_PROVIDER_ERROR',
        'Visible version graph could not accept the proposal.',
      ),
    };
  }
}

async function openProposalStore(
  openStore: () => Promise<AgentProposalMetadataStore>,
): Promise<
  | { readonly ok: true; readonly value: AgentProposalMetadataStore }
  | { readonly ok: false; readonly result: VersionResult<never> }
> {
  try {
    return { ok: true, value: await openStore() };
  } catch {
    return {
      ok: false,
      result: targetUnavailable(
        'VERSION_PROVIDER_ERROR',
        'Version proposal metadata store could not be opened.',
      ),
    };
  }
}

async function markProposalStale(options: {
  readonly store: AgentProposalMetadataStore;
  readonly input: AcceptAgentProposalInput;
  readonly actualTargetHeadId: WorkbookCommitId;
}): Promise<VersionResult<AgentProposalAcceptResult>> {
  const updated = await options.store.updateProposal({
    clientRequestId: options.input.clientRequestId,
    proposalId: options.input.proposalId,
    expectedRevision: options.input.expectedRevision,
    status: 'stale',
    trustedActor: options.input.actor,
    diagnostics: [
      diagnostic('stale_head', 'warning', 'Target ref moved before proposal acceptance.', {
        expectedTargetHeadId: options.input.expectedTargetHeadId,
        actualTargetHeadId: options.actualTargetHeadId,
      }),
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

function fastForwardAcceptResult(
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

function proposalAcceptReceiptId(input: {
  readonly proposalId: string;
  readonly clientRequestId: string;
  readonly appliedCommitId: WorkbookCommitId;
}): string {
  return `proposal-accept:${input.proposalId}:${input.clientRequestId}:${input.appliedCommitId}`;
}

function ok<T>(value: T): VersionResult<T> {
  return { ok: true, value };
}

function storeFailure<T>(
  result: Extract<VersionResult<unknown>, { readonly ok: false }>,
): VersionResult<T> {
  return { ok: false, error: result.error };
}

function staleRevision<T>(expectedRevision: number, actualRevision: number): VersionResult<T> {
  return {
    ok: false,
    error: { code: 'stale_revision', expectedRevision, actualRevision },
  };
}

function invalidState<T>(
  state: string,
  allowed: readonly string[],
  reason: string,
): VersionResult<T> {
  return { ok: false, error: { code: 'invalid_state', state, allowed, reason } };
}

function targetUnavailable<T>(
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

function graphFailure<T>(diagnostics: readonly unknown[]): VersionResult<T> {
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

function actualHeadFromDiagnostics(diagnostics: readonly unknown[]): WorkbookCommitId | undefined {
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
