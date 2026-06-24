import type {
  RedactionPolicy,
  VersionCommitOptions,
  VersionMainRefName,
  VersionRefName,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';

export type MaybePromise<T> = T | Promise<T>;
export type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

export type AttachedVersionWriteService = {
  commit?: (options?: VersionCommitOptions) => MaybePromise<unknown>;
  readonly capturesNormalCommit?: boolean;
};

export type NormalCommitCaptureAdmissionState = {
  readonly pendingCapturedNormalMutationCount: number;
  readonly pendingUncapturedNormalMutationCount: number;
};

export type VersionSurfaceDirtyAdmissionState = {
  readonly hasUncommittedLocalChanges: boolean;
};

export type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export type CommitValidationResult =
  | { readonly ok: true; readonly options: VersionCommitOptions }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export type NormalizedCommitOptions = {
  message?: string;
  targetRef?: VersionMainRefName | VersionRefName;
  redactionPolicy?: RedactionPolicy;
  expectedHead?: VersionCommitOptions['expectedHead'];
  mode?: { kind: 'normal' };
};
