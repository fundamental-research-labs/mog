import type { VersionGraphStoreDiagnostic } from './graph';
import type { WorkbookCommitId } from './object-digest';
import type {
  PendingRemoteSegmentId,
  PendingRemoteSegmentStoreDiagnostic,
} from './pending-remote-segment-store';
import { VersionStoreProviderError, type VersionStoreDiagnostic } from './provider';
import type { SyncBatchStatusStoreDiagnostic } from './sync-batch-status-store';

export type PendingRemotePromotionSkipReason =
  | 'batch-status-read-failed'
  | 'batch-status-terminal'
  | 'completion-failed'
  | 'graph-ref-unavailable'
  | 'graph-write-failed'
  | 'inconsistent-group'
  | 'ineligible-operation-context'
  | 'ineligible-state'
  | 'invalid-required-object'
  | 'missing-required-object'
  | 'missing-semantic-change-set'
  | 'missing-snapshot-root'
  | 'provider-authority-stale'
  | 'provider-authority-unknown'
  | 'provider-read-failed';

export type PendingRemotePromotionDiagnosticCode =
  | 'VERSION_PENDING_REMOTE_PROMOTION_AUTHORITY_BLOCKED'
  | 'VERSION_PENDING_REMOTE_PROMOTION_BATCH_BLOCKED'
  | 'VERSION_PENDING_REMOTE_PROMOTION_COMPLETION_FAILED'
  | 'VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED'
  | 'VERSION_PENDING_REMOTE_PROMOTION_INELIGIBLE'
  | 'VERSION_PENDING_REMOTE_PROMOTION_OBJECT_READ_FAILED'
  | 'VERSION_PENDING_REMOTE_PROMOTION_RECOVERED'
  | 'VERSION_PENDING_REMOTE_PROMOTION_STORE_UNAVAILABLE';

export type PendingRemotePromotionSourceDiagnostic =
  | VersionStoreDiagnostic
  | VersionGraphStoreDiagnostic
  | PendingRemoteSegmentStoreDiagnostic
  | SyncBatchStatusStoreDiagnostic;

export type PendingRemotePromotionDiagnostic = {
  readonly code: PendingRemotePromotionDiagnosticCode;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly reason?: PendingRemotePromotionSkipReason;
  readonly segmentId?: PendingRemoteSegmentId;
  readonly commitId?: WorkbookCommitId;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
  readonly sourceDiagnostics?: readonly PendingRemotePromotionSourceDiagnostic[];
};

export function pendingRemotePromotionDiagnostic(
  code: PendingRemotePromotionDiagnosticCode,
  severity: PendingRemotePromotionDiagnostic['severity'],
  message: string,
  options: {
    readonly reason?: PendingRemotePromotionSkipReason;
    readonly segmentId?: PendingRemoteSegmentId;
    readonly commitId?: WorkbookCommitId;
    readonly details?: PendingRemotePromotionDiagnostic['details'];
    readonly sourceDiagnostics?: readonly PendingRemotePromotionSourceDiagnostic[] | undefined;
  } = {},
): PendingRemotePromotionDiagnostic {
  return Object.freeze({
    code,
    severity,
    message,
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    ...(options.segmentId === undefined ? {} : { segmentId: options.segmentId }),
    ...(options.commitId === undefined ? {} : { commitId: options.commitId }),
    ...(options.details === undefined ? {} : { details: options.details }),
    ...(options.sourceDiagnostics === undefined
      ? {}
      : { sourceDiagnostics: Object.freeze([...options.sourceDiagnostics]) }),
  });
}

export function sourceDiagnosticsFromPromotionError(
  error: unknown,
): readonly PendingRemotePromotionSourceDiagnostic[] | undefined {
  if (error instanceof VersionStoreProviderError) return error.diagnostics;
  if (!isRecord(error) || !Array.isArray(error.diagnostics)) return undefined;
  return error.diagnostics.filter(isPromotionSourceDiagnostic);
}

export function diagnosticCodeFromPromotionError(error: unknown): string | undefined {
  if (!isRecord(error) || !isRecord(error.diagnostic)) return undefined;
  return typeof error.diagnostic.code === 'string' ? error.diagnostic.code : undefined;
}

export function isPromotionSourceDiagnostic(
  value: unknown,
): value is PendingRemotePromotionSourceDiagnostic {
  return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string';
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

export function pendingRemotePromotionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
