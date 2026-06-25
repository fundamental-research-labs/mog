import type {
  ObjectDigest,
  PageCursor,
  VersionDiagnostic,
  VersionResult,
  VersionUpdateReviewStatusInput,
  WorkbookVersionReviewApprovalEvidence,
  WorkbookVersionReviewDecision,
  WorkbookVersionReviewDecisionTarget,
  WorkbookVersionReviewRecord,
} from '@mog-sdk/contracts/api';

import type { WorkbookVersionReviewDiffService } from './review-diff-service';

const APPROVAL_DIFF_LIMIT = 100;
const MAX_APPROVAL_DIFF_PAGES = 1_000;

export async function buildWorkbookVersionReviewApprovalEvidence(input: {
  readonly review: WorkbookVersionReviewRecord;
  readonly actor: WorkbookVersionReviewApprovalEvidence['approvedBy'];
  readonly approvedAt: string;
  readonly reviewRevision: number;
  readonly diffService?: WorkbookVersionReviewDiffService;
}): Promise<VersionResult<WorkbookVersionReviewApprovalEvidence>> {
  const baseCommitId = input.review.baseCommitId;
  const headCommitId = input.review.headCommitId;
  if (!baseCommitId || !headCommitId) {
    return invalidState(
      'approval_commit_range_unavailable',
      ['commit_range_review'],
      'Manual approval requires a review with resolved base and head commits.',
    );
  }
  if (!input.diffService) {
    return targetUnavailable(
      'VERSION_REVIEW_DIFF_UNAVAILABLE',
      'Provider-backed review diff projection is not attached; approval evidence cannot be computed.',
    );
  }

  let cursor: PageCursor | undefined;
  let changeSetDigest: ObjectDigest | undefined;
  let redactedChanges = 0;
  const requiredTargets = new Map<string, WorkbookVersionReviewDecisionTarget>();

  for (let pageIndex = 0; pageIndex < MAX_APPROVAL_DIFF_PAGES; pageIndex += 1) {
    const page = await input.diffService.getReviewDiff({
      reviewId: input.review.id,
      baseCommitId,
      headCommitId,
      limit: APPROVAL_DIFF_LIMIT,
      ...(cursor ? { cursor } : {}),
    });
    if (!page.ok) return remapReviewDiffFailure(page);

    if (page.value.baseCommitId !== baseCommitId || page.value.headCommitId !== headCommitId) {
      return invalidState(
        'approval_diff_commit_range_mismatch',
        ['matching_review_diff_range'],
        'Approval evidence must be computed from the review record base/head commits.',
      );
    }
    if (changeSetDigest && !objectDigestsEqual(changeSetDigest, page.value.changeSetDigest)) {
      return invalidState(
        'approval_diff_digest_changed',
        ['stable_review_diff_digest'],
        'Approval evidence changed while paging the review diff.',
      );
    }

    changeSetDigest = page.value.changeSetDigest;
    redactedChanges += page.value.summary.redactedChanges;
    for (const change of page.value.changes) {
      if (change.derived) continue;
      const targetKey = reviewDecisionTargetKey(change.target);
      requiredTargets.set(targetKey, cloneJson(change.target));
    }

    if (!page.value.nextCursor) break;
    cursor = page.value.nextCursor;
  }

  if (cursor) {
    return targetUnavailable(
      'VERSION_REVIEW_APPROVAL_DIFF_PAGE_LIMIT',
      'Review diff paging did not converge before the approval page limit.',
    );
  }
  if (!changeSetDigest) {
    return targetUnavailable(
      'VERSION_REVIEW_DIFF_UNAVAILABLE',
      'Review diff projection did not return a change-set digest for approval evidence.',
    );
  }
  if (redactedChanges > 0) {
    return invalidState(
      'approval_required_targets_incomplete',
      ['complete_review_diff_targets'],
      'Manual approval requires complete authored review targets; the diff contains redacted changes.',
    );
  }

  const unresolved = unresolvedRequestChanges(input.review, new Set(requiredTargets.keys()));
  if (unresolved.length > 0) {
    return invalidState(
      'unresolved_request_change',
      ['resolve_request_change'],
      'Manual approval requires every required authored target to have no unresolved request_change decision.',
    );
  }

  return ok({
    schemaVersion: 1,
    changeSetDigest,
    baseCommitId,
    headCommitId,
    requiredTargets: [...requiredTargets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([targetKey, target]) => ({ targetKey, target })),
    approvedBy: cloneJson(input.actor),
    approvedAt: input.approvedAt,
    reviewRevision: input.reviewRevision,
  });
}

export function reviewDecisionTargetKey(target: WorkbookVersionReviewDecisionTarget): string {
  return canonicalJsonStringify(target);
}

export function reviewRecordWithoutApproval(
  record: WorkbookVersionReviewRecord,
): WorkbookVersionReviewRecord {
  const copy = cloneJson(record) as WorkbookVersionReviewRecord & {
    approval?: WorkbookVersionReviewApprovalEvidence;
  };
  delete copy.approval;
  return copy;
}

export function validateApprovalEvidenceForStatusMutation(
  record: WorkbookVersionReviewRecord,
  input: VersionUpdateReviewStatusInput,
  evidence: WorkbookVersionReviewApprovalEvidence | undefined,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<WorkbookVersionReviewRecord> } {
  if (input.status !== 'approved') return { ok: true };
  if (!evidence) {
    return {
      ok: false,
      result: invalidState(
        'approval_requires_review_diff',
        ['approval_evidence'],
        'Manual approval requires review diff evidence.',
      ),
    };
  }
  if (
    evidence.baseCommitId !== record.baseCommitId ||
    evidence.headCommitId !== record.headCommitId ||
    evidence.reviewRevision !== record.revision + 1 ||
    canonicalJsonStringify(evidence.approvedBy) !== canonicalJsonStringify(input.actor) ||
    evidence.requiredTargets.some(
      (target) => target.targetKey !== reviewDecisionTargetKey(target.target),
    )
  ) {
    return {
      ok: false,
      result: invalidState(
        'approval_evidence_mismatch',
        ['current_review_diff_evidence'],
        'Approval evidence must match the current review record, actor, revision, and target-key set.',
      ),
    };
  }
  return { ok: true };
}

function unresolvedRequestChanges(
  review: WorkbookVersionReviewRecord,
  requiredTargetKeys: ReadonlySet<string>,
): readonly WorkbookVersionReviewDecision[] {
  const pendingByTarget = new Map<string, WorkbookVersionReviewDecision>();
  for (const decision of review.decisions) {
    const targetKey = reviewDecisionTargetKey(decision.target);
    if (!requiredTargetKeys.has(targetKey)) continue;

    if (decision.decision === 'request_change') {
      pendingByTarget.set(targetKey, decision);
      continue;
    }
    if (
      (decision.decision === 'approve' || decision.decision === 'mark_resolved') &&
      decision.reviewer.trust === 'trusted'
    ) {
      const pending = pendingByTarget.get(targetKey);
      if (pending && decision.supersedesDecisionId === pending.id) {
        pendingByTarget.delete(targetKey);
      }
    }
  }
  return [...pendingByTarget.values()];
}

function remapReviewDiffFailure<T>(
  result: VersionResult<T>,
): VersionResult<WorkbookVersionReviewApprovalEvidence> {
  if (result.ok) throw new Error('expected failed review diff result');
  if (result.error.code === 'target_unavailable') {
    return {
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.updateReviewStatus',
        diagnostics: result.error.diagnostics,
      },
    };
  }
  return result as VersionResult<WorkbookVersionReviewApprovalEvidence>;
}

function ok<T>(value: T): VersionResult<T> {
  return { ok: true, value };
}

function invalidState<T>(
  state: string,
  allowed: readonly string[],
  reason: string,
): VersionResult<T> {
  return { ok: false, error: { code: 'invalid_state', state, allowed, reason } };
}

function targetUnavailable<T>(code: string, message: string): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.updateReviewStatus',
      diagnostics: [diagnostic(code, 'warning', message)],
    },
  };
}

function diagnostic(
  code: string,
  severity: VersionDiagnostic['severity'],
  message: string,
): VersionDiagnostic {
  return { code, severity, message };
}

function objectDigestsEqual(left: ObjectDigest, right: ObjectDigest): boolean {
  return (
    left.algorithm === right.algorithm &&
    left.digest === right.digest &&
    left.byteLength === right.byteLength
  );
}

function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical JSON number must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJsonStringify).join(',')}]`;
  if (!isRecord(value)) throw new Error('value must be canonical JSON');
  return `{${Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(value[key])}`)
    .join(',')}}`;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
