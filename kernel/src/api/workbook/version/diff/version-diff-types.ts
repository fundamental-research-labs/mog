import type {
  VersionDiffGroupDetailOptions,
  VersionDiffOverviewOptions,
  VersionPageToken,
  VersionRefSelector,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

export type MaybePromise<T> = T | Promise<T>;

export type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

export type NormalizedDiffCommitish =
  | {
      readonly kind: 'commit';
      readonly id: WorkbookCommitId;
    }
  | {
      readonly kind: 'ref';
      readonly name: VersionRefSelector;
    };

export type NormalizedDiffOptions = {
  readonly pageSize?: number;
  readonly pageToken?: VersionPageToken;
  readonly includeDerivedImpact?: boolean;
  readonly includeDiagnostics?: boolean;
};

export type DiffValidationResult =
  | {
      readonly ok: true;
      readonly base: NormalizedDiffCommitish;
      readonly target: NormalizedDiffCommitish;
      readonly options: NormalizedDiffOptions;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export type AttachedVersionDiffService = {
  diff: (
    base: NormalizedDiffCommitish,
    target: NormalizedDiffCommitish,
    options?: NormalizedDiffOptions,
  ) => MaybePromise<unknown>;
  diffOverview?: (
    base: NormalizedDiffCommitish,
    target: NormalizedDiffCommitish,
    options?: VersionDiffOverviewOptions,
  ) => MaybePromise<unknown>;
  diffGroupDetail?: (
    base: NormalizedDiffCommitish,
    target: NormalizedDiffCommitish,
    options: VersionDiffGroupDetailOptions,
  ) => MaybePromise<unknown>;
};

export type AttachedVersionServices = {
  readonly diffService?: unknown;
  readonly versionDiffService?: unknown;
  readonly publicService?: unknown;
  readonly readService?: unknown;
  readonly graphService?: unknown;
  readonly graphStore?: unknown;
  readonly graph?: unknown;
};
