import type { DocumentContext } from '../../../../context';

export type MaybePromise<T> = T | Promise<T>;
export type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

export type PendingRemotePromotionServiceLike = {
  promotePendingRemoteSegments(): MaybePromise<unknown>;
};

export type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};
