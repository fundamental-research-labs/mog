import type {
  VersionCapability,
  VersionPromotePendingRemoteSkipReason,
} from '@mog-sdk/contracts/api';

export const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
export const PENDING_REMOTE_SEGMENT_ID_RE = /^pending-remote-segment:sha256:[0-9a-f]{64}$/;
export const SYNC_BATCH_STATUS_ID_RE = /^sync-batch-status:sha256:[0-9a-f]{64}$/;
export const OPTION_KEYS = new Set(['includeDiagnostics']);
export const REQUIRED_PROMOTION_CAPABILITIES = [
  'version:remotePromote',
  'version:provenance',
] as const satisfies readonly VersionCapability[];
export const SKIP_REASONS = new Set<VersionPromotePendingRemoteSkipReason>([
  'batch-status-read-failed',
  'batch-status-terminal',
  'completion-failed',
  'graph-ref-unavailable',
  'graph-write-failed',
  'inconsistent-group',
  'ineligible-operation-context',
  'ineligible-state',
  'invalid-required-object',
  'missing-required-object',
  'missing-semantic-change-set',
  'missing-snapshot-root',
  'provider-authority-stale',
  'provider-authority-unknown',
  'provider-read-failed',
]);
export const REDACTED_DETAIL_KEYS = new Set([
  'authorityref',
  'originid',
  'payloadhash',
  'providerid',
  'providerrefid',
  'remotesessionid',
  'roomid',
  'sessionid',
  'stableoriginid',
  'updateid',
]);
