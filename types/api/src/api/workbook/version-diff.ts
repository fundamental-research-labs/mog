import type {
  ObjectDigest,
  Paged,
  VersionDiffCursor,
  VersionDiffDisplayValue,
  VersionDiffOptions,
  VersionDiffResourceLimitSummary,
  VersionPageToken,
  VersionRecordRevision,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from './version';

export type VersionDiffOperation = 'added' | 'removed' | 'changed' | 'mixed';

export type VersionDiffGroupBy = 'sheet-domain-range';

export interface VersionDiffAddressFilter {
  readonly sheetId?: string;
  readonly a1Address?: string;
}

export interface VersionDiffSearchFilter {
  readonly query: string;
  readonly fields?: readonly ('formula' | 'text')[];
}

export interface VersionDiffFilters {
  readonly sheetIds?: readonly string[];
  readonly domains?: readonly string[];
  readonly operations?: readonly Exclude<VersionDiffOperation, 'mixed'>[];
  readonly address?: VersionDiffAddressFilter;
  readonly search?: VersionDiffSearchFilter;
}

export interface VersionDiffUnsupportedFilter {
  readonly filter: 'sheet' | 'domain' | 'operation' | 'address' | 'search';
  readonly reason: string;
  readonly diagnostics: readonly VersionStoreDiagnostic[];
}

export interface VersionDiffOverviewOptions {
  readonly includeDiagnostics?: boolean;
  readonly groupLimit?: number;
  readonly groupPageToken?: VersionDiffCursor | VersionPageToken | string;
  readonly groupBy?: VersionDiffGroupBy;
  readonly filters?: VersionDiffFilters;
}

export type VersionDiffCountPrecision = 'exact' | 'estimated' | 'lowerBound' | 'unavailable';

export interface VersionDiffDomainCount {
  readonly domain: string;
  readonly exactCount?: number;
  readonly totalEstimate?: number;
  readonly minimumCount?: number;
  readonly countPrecision: VersionDiffCountPrecision;
}

export interface VersionDiffOperationCount {
  readonly operation: Exclude<VersionDiffOperation, 'mixed'>;
  readonly exactCount?: number;
  readonly totalEstimate?: number;
  readonly minimumCount?: number;
  readonly countPrecision: VersionDiffCountPrecision;
}

export interface VersionDiffSummary {
  readonly exactTotalChanges?: number;
  readonly totalEstimate?: number;
  readonly minimumChangeCount?: number;
  readonly countPrecision: VersionDiffCountPrecision;
  readonly exactTotalCountUnavailable?: boolean;
  readonly sheetCount?: number;
  readonly domainCounts: readonly VersionDiffDomainCount[];
  readonly operationCounts: readonly VersionDiffOperationCount[];
  readonly redactedChangeCount?: number;
  readonly unsupportedChangeCount?: number;
  readonly incomplete: boolean;
  readonly diagnostics: readonly VersionStoreDiagnostic[];
}

export type VersionDiffGroupId = string & {
  readonly __brand?: 'VersionDiffGroupId';
};

export type VersionDiffGroupKind =
  | 'cellRange'
  | 'cellSet'
  | 'sheet'
  | 'domain'
  | 'structure'
  | 'redacted'
  | 'unsupported';

export type VersionDiffGroupKey =
  | {
      readonly kind: 'cellRange';
      readonly sheetId: string;
      readonly domain: string;
      readonly operation: VersionDiffOperation;
      readonly rowStart: number;
      readonly rowEnd: number;
      readonly columnStart: number;
      readonly columnEnd: number;
    }
  | {
      readonly kind: 'cellSet';
      readonly sheetId?: string;
      readonly domain: string;
      readonly operation: VersionDiffOperation;
      readonly setDigest: ObjectDigest;
    }
  | {
      readonly kind: Exclude<VersionDiffGroupKind, 'cellRange' | 'cellSet'>;
      readonly sheetId?: string;
      readonly domain: string;
      readonly operation: VersionDiffOperation;
      readonly keyDigest: ObjectDigest;
    };

export interface VersionDiffGroup {
  readonly groupId: VersionDiffGroupId;
  readonly key: VersionDiffGroupKey;
  readonly kind: VersionDiffGroupKind;
  readonly domain: string;
  readonly sheetId?: string;
  readonly sheetName?: VersionDiffDisplayValue;
  readonly address?: VersionDiffDisplayValue;
  readonly operation: VersionDiffOperation;
  readonly changeCount?: number;
  readonly totalEstimate?: number;
  readonly minimumChangeCount?: number;
  readonly countPrecision: VersionDiffCountPrecision;
  readonly sampleChangeIds: readonly string[];
  readonly hasDetail: boolean;
  readonly diagnostics: readonly VersionStoreDiagnostic[];
}

export interface VersionDiffOverview {
  readonly baseCommitId: WorkbookCommitId;
  readonly targetCommitId: WorkbookCommitId;
  readonly readRevision: VersionRecordRevision;
  readonly order: 'semantic-change-order';
  readonly summary: VersionDiffSummary;
  readonly groups: Paged<VersionDiffGroup>;
  readonly unsupportedFilters: readonly VersionDiffUnsupportedFilter[];
  readonly diagnostics: readonly VersionStoreDiagnostic[];
  readonly resourceLimits?: VersionDiffResourceLimitSummary;
}

export interface VersionDiffGroupDetailOptions extends VersionDiffOptions {
  readonly groupId: VersionDiffGroupId;
  readonly filters?: VersionDiffFilters;
}
