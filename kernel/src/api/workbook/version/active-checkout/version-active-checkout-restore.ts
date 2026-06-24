import type { DocumentContext } from '../../../../context';
import {
  checkoutWorkbookVersion,
  type VersionCheckoutTransactionGuard,
} from '../../version-checkout';
import {
  readVersionSurfaceCheckoutSession,
  restoreVersionSurfaceCheckoutSession,
  type AttachedVersionSurfaceStatusService,
  type VersionSurfaceCheckoutSession,
} from '../surface-status/version-surface-status-service';

const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';

export async function restoreAttachedActiveCheckoutMaterialization(input: {
  readonly ctx: DocumentContext;
  readonly surfaceStatusService: AttachedVersionSurfaceStatusService | null;
  readonly session: VersionSurfaceCheckoutSession;
}): Promise<VersionSurfaceCheckoutSession | null> {
  if (input.session.detached) return null;
  const refName = publicRefNameFromBranchName(input.session.branchName);
  if (!refName) return null;

  const transactionGuard = readCheckoutTransactionGuard(input.ctx);
  if (!transactionGuard) return null;

  try {
    const result = await checkoutWorkbookVersion(
      input.ctx,
      { kind: 'ref', name: refName },
      {},
      transactionGuard,
    );
    if (result.status !== 'success' || result.materialization !== 'applied') return null;
    return (
      (await readVersionSurfaceCheckoutSession(input.surfaceStatusService, [])) ??
      (await restoreVersionSurfaceCheckoutSession(input.surfaceStatusService, input.session))
    );
  } catch {
    return null;
  }
}

function publicRefNameFromBranchName(branchName: string | undefined): string | null {
  if (!branchName) return null;
  if (branchName === 'main') return 'refs/heads/main';
  return branchName.startsWith(VERSION_BRANCH_REF_PREFIX)
    ? branchName
    : `${VERSION_BRANCH_REF_PREFIX}${branchName}`;
}

function readCheckoutTransactionGuard(
  ctx: DocumentContext,
): VersionCheckoutTransactionGuard | null {
  const runtime = ctx as { readonly versioning?: unknown; readonly versionStore?: unknown };
  const services = runtime.versioning ?? runtime.versionStore ?? null;
  if (!isRecord(services)) return null;
  const guard = services.checkoutTransactionGuard;
  if (!isRecord(guard)) return null;
  return typeof guard.beginCheckoutTransaction === 'function' &&
    typeof guard.endCheckoutTransaction === 'function'
    ? (guard as unknown as VersionCheckoutTransactionGuard)
    : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
