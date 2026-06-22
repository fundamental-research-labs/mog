export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type ObjectDigest = {
  readonly algorithm: 'blake3' | 'sha256';
  readonly digest: string;
  readonly byteLength?: number;
};

export type VersionCapability =
  | 'version:read'
  | 'version:diff'
  | 'version:commit'
  | 'version:branch'
  | 'version:checkout'
  | 'version:reviewRead'
  | 'version:reviewWrite'
  | 'version:proposal'
  | 'version:mergePreview'
  | 'version:mergeApply'
  | 'version:revert'
  | 'version:provenance';

export type VersionCapabilityDependency =
  | 'VC-04'
  | 'VC-05'
  | 'VC-07'
  | 'VC-09'
  | 'storage'
  | 'featureGate'
  | 'hostCapability'
  | 'upstreamRevertContract';

export type VersionAuthor = {
  readonly kind: 'user' | 'agent' | 'system' | 'unknown';
  readonly trust: 'trusted' | 'unknown' | 'redacted';
  readonly displayName?: string;
  readonly principalId?: string;
  readonly agentRunId?: string;
};

export type VersionDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface VersionDiagnostic {
  readonly code: string;
  readonly severity: VersionDiagnosticSeverity;
  readonly message: string;
  readonly owner?: string;
  readonly dependency?: VersionCapabilityDependency;
  readonly data?: Readonly<Record<string, JsonValue>>;
}

export interface VerificationSummary {
  readonly status: 'not_run' | 'passed' | 'failed' | 'blocked';
  readonly checks: readonly {
    readonly name: string;
    readonly status: 'passed' | 'failed' | 'blocked';
    readonly command?: string;
    readonly artifactRef?: string;
    readonly diagnostics: readonly VersionDiagnostic[];
  }[];
  readonly createdAt: string;
}

export interface RedactionSummary {
  readonly policy: RedactionPolicy;
  readonly redactedFields: readonly string[];
  readonly diagnostics: readonly VersionDiagnostic[];
}

export type RedactionPolicy = {
  readonly mode: 'default' | 'strict' | 'clean';
  readonly redactSecrets: boolean;
  readonly redactExternalLinks: boolean;
  readonly redactAgentTrace: boolean;
};

export type VersionCapabilityError = {
  readonly code: 'version_capability_unavailable';
  readonly capability: VersionCapability;
  readonly dependency?: VersionCapabilityDependency;
  readonly reason: string;
  readonly retryable: boolean;
  readonly diagnostics?: readonly VersionDiagnostic[];
};

export type VersionError =
  | VersionCapabilityError
  | { readonly code: 'not_found'; readonly target: string; readonly reason: string }
  | { readonly code: 'stale_revision'; readonly expectedRevision: number; readonly actualRevision: number }
  | { readonly code: 'stale_head'; readonly expectedHeadId: string; readonly actualHeadId: string }
  | { readonly code: 'invalid_state'; readonly state: string; readonly allowed: readonly string[]; readonly reason: string }
  | { readonly code: 'invalid_branch_name'; readonly branchName: string; readonly reason: string }
  | { readonly code: 'redaction_blocked'; readonly reason: string }
  | { readonly code: 'target_unavailable'; readonly target: string; readonly diagnostics: readonly VersionDiagnostic[] };

export type VersionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: VersionError };

export type PageCursor = string & {
  readonly __brand?: 'PageCursor';
};

export interface Paged<T> {
  readonly items: readonly T[];
  readonly nextCursor?: PageCursor;
  readonly limit: number;
  readonly totalEstimate?: number;
}
