import type {
  VersionMainRefName,
  VersionRefName,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../context';
import { publicDiagnostic } from './commit/version-commit-diagnostics';
import { getWorkbookVersionStatus } from './status/version-status';
import { getWorkbookVersionSurfaceStatus } from './surface-status/version-surface-status';

export type ActiveCheckoutWriteRefName = VersionMainRefName | VersionRefName;

export type ActiveCheckoutWriteContext =
  | { readonly status: 'absent' }
  | { readonly status: 'detached' }
  | {
      readonly status: 'attached';
      readonly refName: ActiveCheckoutWriteRefName;
    }
  | { readonly status: 'stale'; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export async function readActiveCheckoutWriteContext(
  ctx: DocumentContext,
  operation: 'commitGraphWrite' | 'revertGraphWrite',
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
  return { status: 'attached', refName: refNameFromBranchName(current.branchName) };
}

export function recordActiveCheckoutBranchCommit(
  ctx: DocumentContext,
  refName: ActiveCheckoutWriteRefName,
  commitId: string,
): void {
  const recorder = readSurfaceStatusRecorder(ctx);
  recorder?.recordActiveCheckoutBranchCommit?.({ commitId, refName });
}

function refNameFromBranchName(branchName: string): ActiveCheckoutWriteRefName {
  return branchName === 'main' ? 'refs/heads/main' : (`refs/heads/${branchName}` as VersionRefName);
}

function staleImplicitCheckoutWriteDiagnostic(
  operation: 'commitGraphWrite' | 'revertGraphWrite',
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

function readSurfaceStatusRecorder(ctx: DocumentContext): {
  readonly recordActiveCheckoutBranchCommit?: (input: {
    readonly commitId: string;
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
    const method = candidate.recordActiveCheckoutBranchCommit;
    if (typeof method !== 'function') continue;
    return {
      recordActiveCheckoutBranchCommit: (input) => {
        Reflect.apply(method, candidate, [input]);
      },
    };
  }
  return null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
