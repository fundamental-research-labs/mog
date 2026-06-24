import type {
  VersionRecordRevision,
  VersionRef,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';

export const VERSION_HEAD_REF = 'HEAD';
export const VERSION_MAIN_REF = 'refs/heads/main';
export const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';
const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const REF_COUNTER_REVISION_VALUE_RE = /^(0|[1-9][0-9]*)$/;

export type MaybePromise<T> = T | Promise<T>;
export type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;
export type DeleteRefOperation = 'deleteBranch' | 'deleteRef';

export type DeleteCapableVersionRefLifecycleService = {
  deleteBranch?: (input: Readonly<Record<string, unknown>>) => MaybePromise<unknown>;
  readBranch?: (input: Readonly<Record<string, unknown>>) => MaybePromise<unknown>;
  listBranches?: (input?: Readonly<Record<string, unknown>>) => MaybePromise<unknown>;
  readRef?: (name: string) => MaybePromise<unknown>;
  getHead?: () => MaybePromise<unknown>;
  readHead?: () => MaybePromise<unknown>;
  readActiveCheckoutSession?: () => MaybePromise<unknown>;
  getActiveCheckoutSession?: () => MaybePromise<unknown>;
};

export type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export type ParsedDeleteRefOptions =
  | {
      readonly ok: true;
      readonly branchName: string;
      readonly expectedHead?: WorkbookCommitId;
      readonly expectedRefVersion: VersionRecordRevision;
      readonly refName: VersionRef['name'];
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export type ValidatedDeleteRefOptions = Extract<ParsedDeleteRefOptions, { readonly ok: true }>;

export type DeletePreflightRef =
  | {
      readonly status: 'checked';
      readonly commitId: WorkbookCommitId;
      readonly revision: VersionRecordRevision;
      readonly protected: boolean;
    }
  | { readonly status: 'missing'; readonly diagnostics: readonly VersionStoreDiagnostic[] }
  | { readonly status: 'unchecked' };

export type ActiveRefProjection =
  | { readonly status: 'ok'; readonly refName: VersionRef['name'] | null }
  | { readonly status: 'blocked'; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export type ProviderReadProjection =
  | { readonly status: 'read'; readonly value: unknown }
  | { readonly status: 'blocked'; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

export function toRevision(value: unknown): VersionRecordRevision | undefined {
  if (
    isRecord(value) &&
    value.kind === 'counter' &&
    typeof value.value === 'string' &&
    REF_COUNTER_REVISION_VALUE_RE.test(value.value)
  ) {
    return { kind: 'counter', value: value.value };
  }
  if (
    isRecord(value) &&
    value.kind === 'opaque' &&
    typeof value.value === 'string' &&
    value.value.length > 0
  ) {
    return { kind: 'opaque', value: value.value };
  }
  return undefined;
}

export function toCounterRevision(
  value: unknown,
): Extract<VersionRecordRevision, { readonly kind: 'counter' }> | undefined {
  const revision = toRevision(value);
  return revision?.kind === 'counter' ? revision : undefined;
}

export function publicRevisionToken(value: VersionRecordRevision): string | undefined {
  return value.kind === 'counter' ? `rv:n:${value.value}` : undefined;
}

export function revisionsEqual(left: VersionRecordRevision, right: VersionRecordRevision): boolean {
  return left.kind === right.kind && left.value === right.value;
}

export function isDeleteOperation(value: string): value is DeleteRefOperation {
  return value === 'deleteBranch' || value === 'deleteRef';
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
