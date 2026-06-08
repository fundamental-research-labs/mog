import type {
  ApiCompatibilityEntry,
  ApiCompatibilityReference,
  ApiCompatibilityStatus,
} from '../api-compatibility/types';

export type ApiGuidanceDialect = 'officejs' | 'mog-version';

export type ApiGuidanceCategory =
  | 'bootstrap'
  | 'sync-load'
  | 'workbook'
  | 'worksheet'
  | 'range'
  | 'formatting'
  | 'tables'
  | 'filters'
  | 'compatibility'
  | 'charts'
  | 'pivots'
  | 'names'
  | 'file-io'
  | 'host';

export type ApiGuidanceMatcherKind = 'member-chain' | 'call' | 'assignment' | 'token' | 'compound';

export interface ApiGuidanceBaseMatcher {
  readonly id: string;
  readonly confidence?: number;
  readonly blocking?: boolean;
}

export interface ApiGuidanceSymbolMatcher extends ApiGuidanceBaseMatcher {
  readonly kind: Exclude<ApiGuidanceMatcherKind, 'compound'>;
  readonly symbol: string;
}

export interface ApiGuidanceCompoundMatcher extends ApiGuidanceBaseMatcher {
  readonly kind: 'compound';
  readonly symbols: readonly string[];
  readonly confidence: number;
  readonly blocking: boolean;
}

export type ApiGuidanceMatcher = ApiGuidanceSymbolMatcher | ApiGuidanceCompoundMatcher;

export interface MogReplacement {
  readonly path: string;
  readonly snippet?: string;
  readonly note?: string;
}

export interface ApiGuidanceEntry {
  readonly id: string;
  readonly dialect: ApiGuidanceDialect;
  readonly category: ApiGuidanceCategory;
  readonly matchers: readonly ApiGuidanceMatcher[];
  readonly message: string;
  readonly suggestion: string;
  readonly mogReplacements: readonly MogReplacement[];
  readonly confidence: number;
  readonly blocking: boolean;
}

export interface SourceSpan {
  readonly start: number;
  readonly end: number;
  readonly line?: number;
  readonly column?: number;
}

export type ApiGuidanceDiagnosticCode =
  | 'MOG001_FOREIGN_API_DIALECT'
  | 'MOG002_MOG_API_USAGE'
  | 'MOG003_COMPATIBILITY_REJECTED';

export interface ApiGuidanceDiagnostic {
  readonly code: ApiGuidanceDiagnosticCode;
  readonly severity: 'error' | 'warning' | 'info';
  readonly dialect?: ApiGuidanceDialect;
  readonly category: ApiGuidanceCategory;
  readonly entryId: string;
  readonly matcherId: string;
  readonly offendingSymbol: string;
  readonly message: string;
  readonly suggestion: string;
  readonly mogReplacements: readonly MogReplacement[];
  readonly references: readonly string[];
  readonly confidence: number;
  readonly blocking: boolean;
  readonly compatibilityId?: string;
  readonly compatibilityStatus?: ApiCompatibilityStatus;
  readonly span?: SourceSpan;
}

export type ApiGuidanceTargetKind = 'method' | 'property' | 'subApiAccessor' | 'rootImport';

export type ApiGuidanceTargetRoot = 'workbook' | 'worksheet' | 'subApi' | 'rootImport';

export interface ApiGuidanceSourceLocation {
  readonly file: string;
  readonly line?: number;
}

export interface ApiGuidanceTarget {
  readonly schemaVersion?: '1';
  readonly path: string;
  readonly stableId?: string;
  readonly root: ApiGuidanceTargetRoot;
  readonly parentRoot?: 'workbook' | 'worksheet';
  readonly kind: ApiGuidanceTargetKind;
  readonly interface?: string;
  readonly member?: string;
  readonly asyncModel: 'sync' | 'promise';
  readonly signature: string;
  readonly typeText: string;
  readonly visibility: 'public' | 'internal' | 'deprecated';
  readonly targetInterface?: string;
  readonly source?: ApiGuidanceSourceLocation;
  readonly ownerPackage: string;
  readonly compatibility?: readonly ApiCompatibilityReference[];
}

export interface ApiGuidanceCatalogValidationIssue {
  readonly entryId: string;
  readonly path: string;
  readonly reason: string;
}

export interface ApiGuidanceCatalogValidation {
  readonly valid: boolean;
  readonly issues: readonly ApiGuidanceCatalogValidationIssue[];
}

export interface ForeignApiGuidanceExplanation {
  readonly kind: 'foreign-api-dialect';
  readonly symbol: string;
  readonly diagnostic: ApiGuidanceDiagnostic;
  readonly entry: ApiGuidanceEntry;
}

export interface MogApiGuidanceExplanation {
  readonly kind: 'mog-api';
  readonly path: string;
  readonly target: ApiGuidanceTarget;
  readonly examples: readonly string[];
  readonly recommendedBy: readonly string[];
}

export interface MogApiCompatibilityExplanation {
  readonly kind: 'mog-api-compatibility';
  readonly path: string;
  readonly entry: ApiCompatibilityEntry;
  readonly target: ApiGuidanceTarget | null;
}

export type ApiGuidanceExplanation =
  | ForeignApiGuidanceExplanation
  | MogApiGuidanceExplanation
  | MogApiCompatibilityExplanation;

export interface ApiGuidancePreflightResult {
  readonly ok: boolean;
  readonly diagnostics: readonly ApiGuidanceDiagnostic[];
}

export interface ApiGuidanceApi {
  readonly analyze: (code: string) => ApiGuidanceDiagnostic[];
  readonly preflight: (code: string) => ApiGuidancePreflightResult;
  readonly explain: (symbolOrPath: string) => ApiGuidanceExplanation | null;
  readonly catalog: readonly ApiGuidanceEntry[];
  readonly targets: readonly ApiGuidanceTarget[];
}
