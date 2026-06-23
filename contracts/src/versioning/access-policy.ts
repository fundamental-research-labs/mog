export const VERSION_REDACTION_POLICIES = Object.freeze([
  'none',
  'metadata-only',
  'content-redacted',
  'opaque-digest-only',
  'drop',
] as const);
export type VersionRedactionPolicy = (typeof VERSION_REDACTION_POLICIES)[number];

export const VERSION_HISTORY_READ_MODES = Object.freeze(['none', 'metadata-only', 'full'] as const);
export type VersionHistoryReadMode = (typeof VERSION_HISTORY_READ_MODES)[number];

export const VERSION_HISTORY_WRITE_MODES = Object.freeze([
  'none',
  'shadow-only',
  'gated',
  'full',
] as const);
export type VersionHistoryWriteMode = (typeof VERSION_HISTORY_WRITE_MODES)[number];

export const VERSION_HISTORY_DENIED_SUMMARY_KINDS = Object.freeze([
  'capability-denied',
  'access-denied',
] as const);
export type VersionHistoryDeniedSummaryKind = (typeof VERSION_HISTORY_DENIED_SUMMARY_KINDS)[number];

export const VERSION_HISTORY_DIAGNOSTIC_PROJECTION_MODES = Object.freeze([
  'full',
  'summary-only',
] as const);
export type VersionHistoryDiagnosticProjectionMode =
  (typeof VERSION_HISTORY_DIAGNOSTIC_PROJECTION_MODES)[number];

export interface VersionHistoryDeniedDiagnosticSummaryPolicy {
  readonly includeCapability: boolean;
  readonly includeDeniedCapabilities: boolean;
  readonly includeDependency: boolean;
  readonly includeRetryable: boolean;
}

export interface VersionHistoryDiagnosticProjectionPolicy {
  readonly mode: VersionHistoryDiagnosticProjectionMode;
  readonly deniedSummary: VersionHistoryDeniedDiagnosticSummaryPolicy;
}

export interface VersionHistoryAccessDeniedSummary {
  readonly kind: VersionHistoryDeniedSummaryKind;
  readonly code: 'version_capability_unavailable' | 'version_access_denied' | (string & {});
  readonly capability?: string;
  readonly deniedCapabilities?: readonly string[];
  readonly dependency?: string;
  readonly retryable?: boolean;
}

export interface VersionHistoryAccessPolicy {
  readonly readMode: VersionHistoryReadMode;
  readonly writeMode: VersionHistoryWriteMode;
  readonly redactionPolicy: VersionRedactionPolicy;
  readonly allowedDomainIds?: readonly string[];
  readonly diagnosticProjection?: VersionHistoryDiagnosticProjectionPolicy;
}

export const VERSION_HISTORY_SUMMARY_ONLY_DIAGNOSTIC_PROJECTION_POLICY: VersionHistoryDiagnosticProjectionPolicy =
  Object.freeze({
    mode: 'summary-only',
    deniedSummary: Object.freeze({
      includeCapability: true,
      includeDeniedCapabilities: true,
      includeDependency: true,
      includeRetryable: true,
    }),
  });
