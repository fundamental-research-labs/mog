export type ApiCompatibilityStatus =
  | 'canonical'
  | 'contract_extension'
  | 'supported_alias'
  | 'input_alias'
  | 'deprecated_alias'
  | 'semantic_compatibility'
  | 'structured_diagnostic'
  | 'rejected';

export type ApiCompatibilitySurface =
  | 'typescript'
  | 'kernel'
  | 'executeCode-preflight'
  | 'api-describe'
  | 'agent-guidance'
  | 'docs'
  | 'python'
  | 'api-eval';

export type ApiCompatibilityAppliesTo = 'method' | 'property' | 'argument' | 'handle' | 'result';

export type ApiCompatibilityEvidenceSource =
  | 'trace'
  | 'eval'
  | 'docs'
  | 'training'
  | 'prior_version'
  | 'source';

export type ApiCompatibilityDiagnosticCode =
  | 'MOG002_MOG_API_USAGE'
  | 'MOG003_COMPATIBILITY_REJECTED';

export interface ApiCompatibilityEvidence {
  readonly source: ApiCompatibilityEvidenceSource;
  readonly reference: string;
}

export interface ApiCompatibilityDiagnostic {
  readonly code: ApiCompatibilityDiagnosticCode;
  readonly message: string;
  readonly replacements: readonly string[];
}

export interface ApiCompatibilityEntry {
  readonly id: string;
  readonly observedPath: string;
  readonly canonicalPath: string | null;
  readonly status: ApiCompatibilityStatus;
  readonly appliesTo: ApiCompatibilityAppliesTo;
  readonly ownerTheme: string;
  readonly ownerPackage: string;
  readonly firstObservedVersion: string | null;
  readonly canonicalSince: string | null;
  readonly deprecatedSince: string | null;
  readonly removeAfter: string | null;
  readonly evidence: readonly ApiCompatibilityEvidence[];
  readonly behavior: string;
  readonly runtimeSurfaces: readonly ApiCompatibilitySurface[];
  readonly surfaceDisposition: Partial<Record<ApiCompatibilitySurface, ApiCompatibilityStatus>>;
  readonly diagnostics?: ApiCompatibilityDiagnostic;
  readonly verification: readonly string[];
  readonly notes?: string;
}

export interface ApiCompatibilityReference {
  readonly id: string;
  readonly observedPath: string;
  readonly canonicalPath: string | null;
  readonly status: ApiCompatibilityStatus;
  readonly appliesTo: ApiCompatibilityAppliesTo;
}

export interface ApiCompatibilityIndex {
  readonly schemaVersion: '1';
  readonly entries: readonly ApiCompatibilityEntry[];
  readonly byId: Record<string, ApiCompatibilityEntry>;
  readonly byObservedPath: Record<string, readonly ApiCompatibilityEntry[]>;
  readonly byCanonicalPath: Record<string, readonly ApiCompatibilityEntry[]>;
}
