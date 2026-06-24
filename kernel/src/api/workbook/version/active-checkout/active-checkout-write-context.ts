import type {
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionRecordRevision,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import { publicDiagnostic } from '../commit/version-commit-diagnostics';
import { getWorkbookVersionStatus } from '../status/version-status';
import { getWorkbookVersionSurfaceStatus } from '../surface-status/version-surface-status';
import { readActiveCheckoutHead } from './version-active-checkout-head';

export type ActiveCheckoutWriteRefName = VersionMainRefName | VersionRefName;
export type ActiveCheckoutWriteOperation =
  | 'commitGraphWrite'
  | 'revertGraphWrite'
  | 'applyMergeGraphWrite';

export type ActiveCheckoutWriteContext =
  | { readonly status: 'absent' }
  | { readonly status: 'detached' }
  | {
      readonly status: 'attached';
      readonly refName: ActiveCheckoutWriteRefName;
      readonly commitId: WorkbookCommitId;
      readonly refRevision: VersionRecordRevision;
    }
  | {
      readonly status: 'blocked' | 'stale';
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export async function readActiveCheckoutWriteContext(
  ctx: DocumentContext,
  operation: ActiveCheckoutWriteOperation,
): Promise<ActiveCheckoutWriteContext> {
  const surface = await getWorkbookVersionSurfaceStatus(ctx, getWorkbookVersionStatus(ctx));
  const current = surface.current;
  if (!current.checkedOutCommitId) return { status: 'absent' };
  if (current.stale) {
    return {
      status: 'stale',
      diagnostics: [staleImplicitCheckoutWriteDiagnostic(operation)],
    };
  }
  if (!current.branchName || current.detached) return { status: 'detached' };
  const refName = refNameFromBranchName(current.branchName);
  const activeHead = await readActiveCheckoutHead(ctx);
  if (activeHead.status === 'degraded') {
    return { status: 'blocked', diagnostics: activeHead.result.diagnostics };
  }
  if (
    activeHead.status !== 'resolved' ||
    activeHead.session.detached ||
    activeHead.head.refName !== refName ||
    !activeHead.head.refRevision
  ) {
    return {
      status: 'blocked',
      diagnostics: [unresolvedActiveCheckoutWriteDiagnostic(operation)],
    };
  }
  return {
    status: 'attached',
    refName,
    commitId: activeHead.head.id,
    refRevision: activeHead.head.refRevision,
  };
}

export function expectedHeadFromActiveCheckout(
  context: Extract<ActiveCheckoutWriteContext, { readonly status: 'attached' }>,
): VersionCommitExpectedHead {
  return {
    commitId: context.commitId,
    revision: context.refRevision,
  };
}

export function detachedImplicitCheckoutWriteDiagnostic(
  operation: ActiveCheckoutWriteOperation,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_OPTIONS',
    'Version write is blocked because detached HEAD has no implicit targetRef; pass a concrete targetRef.',
    {
      severity: 'error',
      recoverability: 'none',
      payload: {
        operation,
        reason: 'detachedCheckout',
        option: 'targetRef',
      },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

export function recordActiveCheckoutBranchCommit(
  ctx: DocumentContext,
  refName: ActiveCheckoutWriteRefName,
  commitId: string,
): void {
  const recorder = readSurfaceStatusRecorder(ctx);
  recorder?.recordActiveCheckoutBranchCommit?.({ commitId, refName });
}

export function recordActiveCheckoutBranchRefMove(
  ctx: DocumentContext,
  refName: ActiveCheckoutWriteRefName,
  checkedOutCommitId: string,
  refHeadCommitId: string,
): void {
  const recorder = readSurfaceStatusRecorder(ctx);
  recorder?.recordActiveCheckoutBranchRefMove?.({ checkedOutCommitId, refHeadCommitId, refName });
}

function refNameFromBranchName(branchName: string): ActiveCheckoutWriteRefName {
  return branchName === 'main' ? 'refs/heads/main' : (`refs/heads/${branchName}` as VersionRefName);
}

function staleImplicitCheckoutWriteDiagnostic(
  operation: ActiveCheckoutWriteOperation,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD',
    'Version write is blocked because the active checkout session is stale relative to its branch head.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload: {
        operation,
        reason: 'staleCheckoutSession',
      },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

function unresolvedActiveCheckoutWriteDiagnostic(
  operation: ActiveCheckoutWriteOperation,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_FAILED',
    'Version write is blocked because the active checkout branch head could not be resolved.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload: {
        operation,
        reason: 'activeCheckoutHeadUnresolved',
      },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

function readSurfaceStatusRecorder(ctx: DocumentContext): {
  readonly recordActiveCheckoutBranchCommit?: (input: {
    readonly commitId: string;
    readonly refName: string;
  }) => void;
  readonly recordActiveCheckoutBranchRefMove?: (input: {
    readonly checkedOutCommitId: string;
    readonly refHeadCommitId: string;
    readonly refName: string;
  }) => void;
} | null {
  const runtime = ctx as {
    readonly versioning?: unknown;
    readonly versionStore?: unknown;
    readonly version?: unknown;
  };
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return null;
  for (const candidate of [
    services.surfaceStatusService,
    services.versionSurfaceStatusService,
    services.statusService,
    services.dirtyStatusService,
    services,
  ]) {
    if (!isRecord(candidate)) continue;
    const recordCommit = candidate.recordActiveCheckoutBranchCommit;
    const recordRefMove = candidate.recordActiveCheckoutBranchRefMove;
    if (typeof recordCommit !== 'function' && typeof recordRefMove !== 'function') continue;
    return {
      ...(typeof recordCommit === 'function'
        ? {
            recordActiveCheckoutBranchCommit: (input) => {
              Reflect.apply(recordCommit, candidate, [input]);
            },
          }
        : {}),
      ...(typeof recordRefMove === 'function'
        ? {
            recordActiveCheckoutBranchRefMove: (input) => {
              Reflect.apply(recordRefMove, candidate, [input]);
            },
          }
        : {}),
    };
  }
  return null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
