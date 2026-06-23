import type {
  VersionResult,
  WorkbookVersionReviewApprovalEvidence,
  WorkbookVersionReviewDecisionDraft,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewStatus,
} from '@mog-sdk/contracts/api';

import { invalidState } from './review-service-record-store-helpers-results';
import { reviewServiceSemanticTargetSupport } from './review-service-target-support';

const USER_OWNED_STATUSES = new Set<WorkbookVersionReviewStatus>([
  'open',
  'approved',
  'changes_requested',
  'rejected',
]);
const TERMINAL_STATUSES = new Set<WorkbookVersionReviewStatus>([
  'rejected',
  'applied',
  'superseded',
  'stale',
]);

export function validateDecisionDraft(
  decision: WorkbookVersionReviewDecisionDraft,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<WorkbookVersionReviewRecord> } {
  if (
    decision.decision === 'mark_resolved' &&
    decision.target.kind === 'semanticChange' &&
    decision.target.derived
  ) {
    return {
      ok: false,
      result: invalidState(
        'derived_target_not_resolvable',
        ['authored_review_target'],
        'Derived-impact review targets may be commented on but cannot be marked resolved.',
      ),
    };
  }
  if (decision.decision === 'mark_resolved' && decision.target.kind === 'conflict') {
    return {
      ok: false,
      result: invalidState(
        'conflict_target_resolution_unavailable',
        ['semantic_review_target'],
        'Conflict review targets cannot be marked resolved until merge conflict application is enabled.',
      ),
    };
  }
  const targetSupport = validateSemanticDecisionTarget(decision.target);
  if (!targetSupport.ok) return targetSupport;
  return { ok: true };
}

function validateSemanticDecisionTarget(
  target: WorkbookVersionReviewDecisionDraft['target'],
):
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<WorkbookVersionReviewRecord> } {
  if (target.kind !== 'semanticChange') return { ok: true };
  const support = reviewServiceSemanticTargetSupport(target);
  if (support.ok) return { ok: true };
  return {
    ok: false,
    result: invalidState(
      'incomplete_review_target',
      ['complete_review_diff_target'],
      'Review decisions require complete supported review targets; hidden or unsupported semantic domains cannot be accepted.',
    ),
  };
}

export function validateApprovalEvidenceTargets(
  evidence: WorkbookVersionReviewApprovalEvidence | undefined,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<WorkbookVersionReviewRecord> } {
  if (!evidence) return { ok: true };
  for (const item of evidence.requiredTargets) {
    const target = item.target;
    if (target.kind !== 'semanticChange') continue;
    const support = reviewServiceSemanticTargetSupport(target);
    if (support.ok) continue;
    return {
      ok: false,
      result: invalidState(
        'approval_required_targets_incomplete',
        ['complete_review_diff_targets'],
        'Manual approval requires complete authored review targets; hidden or unsupported semantic domains cannot be accepted.',
      ),
    };
  }
  return { ok: true };
}

export function validateStatusTransition(
  current: WorkbookVersionReviewStatus,
  next: WorkbookVersionReviewStatus,
  hasApprovalEvidence: boolean,
  flowOwnedStatus: boolean,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<WorkbookVersionReviewRecord> } {
  if (TERMINAL_STATUSES.has(current)) {
    return {
      ok: false,
      result: invalidState(
        'terminal_review_status',
        ['new_review'],
        'Terminal review statuses cannot be manually reopened in this slice.',
      ),
    };
  }
  if (flowOwnedStatus) {
    if (current === 'approved' && next === 'applied') return { ok: true };
    return {
      ok: false,
      result: invalidState(
        'flow_owned_review_status_transition',
        ['approved_to_applied'],
        'Only approved reviews can be finalized as applied by proposal, merge, staleness, or supersede flows.',
      ),
    };
  }
  if (next === 'approved' && !hasApprovalEvidence) {
    return {
      ok: false,
      result: invalidState(
        'approval_requires_review_diff',
        ['open', 'changes_requested'],
        'Manual approval requires review diff coverage and approval evidence.',
      ),
    };
  }
  if (next === 'approved' && current !== 'open' && current !== 'changes_requested') {
    return {
      ok: false,
      result: invalidState(
        'review_status_not_approvable',
        ['open', 'changes_requested'],
        'Only open or changes_requested reviews can be manually approved.',
      ),
    };
  }
  if (!USER_OWNED_STATUSES.has(next)) {
    return {
      ok: false,
      result: invalidState(
        'flow_owned_review_status',
        ['open', 'approved', 'changes_requested', 'rejected'],
        `${next} is owned by proposal, merge, staleness, or supersede flows.`,
      ),
    };
  }
  return { ok: true };
}
