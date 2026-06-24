import type { VersionGraphReadHeadResult } from './graph';
import type { ObjectDigest, VersionObjectType, WorkbookCommitId } from './object-digest';
import {
  pendingRemotePromotionDiagnostic as diagnostic,
  diagnosticCodeFromPromotionError as diagnosticCodeFromError,
  pendingRemotePromotionErrorMessage as errorMessage,
  type PendingRemotePromotionSkipReason,
} from './pending-remote-promotion-diagnostics';
import type {
  PendingRemotePromotionCurrentHeadReadResult,
  PendingRemotePromotionReadRequiredObjectResult,
  PendingRemotePromotionVisibleClosureReadResult,
} from './pending-remote-promotion-validation-types';
import type { VersionGraphStore } from './provider-graph-store';

export async function readPendingRemotePromotionRequiredObject(
  graph: VersionGraphStore,
  objectType: VersionObjectType,
  digest: ObjectDigest,
  field: string,
): Promise<PendingRemotePromotionReadRequiredObjectResult> {
  try {
    return {
      status: 'success',
      record: await graph.getObjectRecord({ kind: 'object', objectType, digest }),
    };
  } catch (error) {
    const sourceCode = diagnosticCodeFromError(error);
    const reason = objectReadSkipReason(sourceCode);
    const message =
      reason === 'missing-required-object'
        ? 'Pending remote segment references a required object that is not persisted.'
        : reason === 'invalid-required-object'
          ? 'Pending remote segment references a required object with invalid type or content.'
          : 'Pending remote segment required object could not be read.';
    return {
      status: 'skipped',
      reason,
      message,
      diagnostics: [
        diagnostic(
          'VERSION_PENDING_REMOTE_PROMOTION_OBJECT_READ_FAILED',
          reason === 'provider-read-failed' ? 'error' : 'warning',
          message,
          {
            reason,
            details: {
              objectType,
              digest: digest.digest,
              field,
              sourceCode: sourceCode ?? null,
            },
          },
        ),
      ],
    };
  }
}

export async function readPendingRemotePromotionCurrentHead(
  graph: VersionGraphStore,
): Promise<PendingRemotePromotionCurrentHeadReadResult> {
  let head: VersionGraphReadHeadResult;
  try {
    head = await graph.readHead();
  } catch (error) {
    const message = 'The visible graph head could not be read for pending remote promotion.';
    return {
      status: 'skipped',
      reason: 'graph-ref-unavailable',
      message,
      diagnostics: [
        diagnostic('VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED', 'error', message, {
          reason: 'graph-ref-unavailable',
          details: { cause: errorMessage(error) },
        }),
      ],
    };
  }
  if (head.status === 'success') return head;

  const message = 'The visible graph head could not be read for pending remote promotion.';
  return {
    status: 'skipped',
    reason: 'graph-ref-unavailable',
    message,
    diagnostics: [
      diagnostic('VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED', 'error', message, {
        reason: 'graph-ref-unavailable',
        sourceDiagnostics: head.diagnostics,
      }),
    ],
  };
}

export async function readPendingRemotePromotionVisibleClosure(
  graph: VersionGraphStore,
  headCommitId: WorkbookCommitId,
): Promise<PendingRemotePromotionVisibleClosureReadResult> {
  const message =
    'The visible graph commit closure could not be read for pending remote promotion.';
  try {
    const closure = await graph.readCommitClosure(headCommitId);
    if (closure.status === 'success') return closure;
    return {
      status: 'skipped',
      reason: 'graph-ref-unavailable',
      message,
      diagnostics: [
        diagnostic('VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED', 'error', message, {
          reason: 'graph-ref-unavailable',
          sourceDiagnostics: closure.diagnostics,
        }),
      ],
    };
  } catch (error) {
    return {
      status: 'skipped',
      reason: 'graph-ref-unavailable',
      message,
      diagnostics: [
        diagnostic('VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED', 'error', message, {
          reason: 'graph-ref-unavailable',
          details: { cause: errorMessage(error) },
        }),
      ],
    };
  }
}

function objectReadSkipReason(
  sourceCode: string | undefined,
): Extract<
  PendingRemotePromotionSkipReason,
  'invalid-required-object' | 'missing-required-object' | 'provider-read-failed'
> {
  if (sourceCode === 'VERSION_OBJECT_NOT_FOUND') return 'missing-required-object';
  if (
    sourceCode === 'VERSION_OBJECT_TYPE_MISMATCH' ||
    sourceCode === 'VERSION_OBJECT_CORRUPTION' ||
    sourceCode === 'VERSION_DIGEST_MISMATCH'
  ) {
    return 'invalid-required-object';
  }
  return 'provider-read-failed';
}
