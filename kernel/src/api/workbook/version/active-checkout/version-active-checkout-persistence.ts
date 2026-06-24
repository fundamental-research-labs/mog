import type { VersionCheckoutResult } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import type {
  ActiveCheckoutMaterializationRecord,
  ActiveCheckoutMaterializationStore,
} from '../../../../document/version-store/active-checkout-materialization-store';
import type { VersionSurfaceCheckoutSession } from '../surface-status/version-surface-status-service';

export async function readPersistedActiveCheckoutMaterialization(
  ctx: DocumentContext,
): Promise<VersionSurfaceCheckoutSession | null> {
  const store = await openStore(ctx);
  if (!store) return null;
  try {
    const record = await store.read();
    return record ? sessionFromRecord(record) : null;
  } catch {
    return null;
  }
}

export async function clearPersistedActiveCheckoutMaterialization(
  ctx: DocumentContext,
): Promise<void> {
  try {
    const store = await openStore(ctx);
    if (!store) return;
    await store.clear();
  } catch {
    // Durable active-checkout restore is opportunistic; a clear failure must not mask checkout.
  }
}

export async function writePersistedActiveCheckoutMaterialization(
  ctx: DocumentContext,
  session: VersionSurfaceCheckoutSession,
): Promise<void> {
  if (session.detached || !session.branchName || !session.refHeadAtMaterialization) return;
  const record = {
    checkedOutCommitId: session.checkedOutCommitId,
    branchName: session.branchName,
    refHeadAtMaterialization: session.refHeadAtMaterialization,
    updatedAt: new Date().toISOString(),
  };
  try {
    const store = await openStore(ctx);
    if (!store) return;
    await clearStoreBestEffort(store);
    try {
      await store.write(record);
    } catch {
      await clearStoreBestEffort(store);
    }
  } catch {
    // Durable active-checkout restore is opportunistic; live materialization already succeeded.
  }
}

export async function updatePersistedActiveCheckoutMaterializationAfterCheckout(
  ctx: DocumentContext,
  result: VersionCheckoutResult,
  options: { readonly materializationAttempted?: boolean } = {},
): Promise<void> {
  if (result.status === 'degraded') {
    if (
      options.materializationAttempted ||
      result.mutationGuarantee === 'unknown-after-partial-mutation'
    ) {
      await clearPersistedActiveCheckoutMaterialization(ctx);
    }
    return;
  }

  if (result.materialization !== 'applied') return;

  const target = result.plan.target;
  if (target.kind === 'commit') {
    await clearPersistedActiveCheckoutMaterialization(ctx);
    return;
  }

  await writePersistedActiveCheckoutMaterialization(ctx, {
    checkedOutCommitId: target.commitId,
    branchName: branchNameFromRefName(target.refName),
    refHeadAtMaterialization: target.commitId,
    detached: false,
  });
}

function sessionFromRecord(
  record: ActiveCheckoutMaterializationRecord,
): VersionSurfaceCheckoutSession {
  return {
    checkedOutCommitId: record.checkedOutCommitId,
    branchName: record.branchName,
    refHeadAtMaterialization: record.refHeadAtMaterialization,
    detached: false,
  };
}

async function openStore(ctx: DocumentContext): Promise<ActiveCheckoutMaterializationStore | null> {
  const provider = readProvider(ctx);
  if (!provider?.openActiveCheckoutMaterializationStore) return null;
  return provider.openActiveCheckoutMaterializationStore();
}

async function clearStoreBestEffort(store: ActiveCheckoutMaterializationStore): Promise<void> {
  try {
    await store.clear();
  } catch {
    // Durable active-checkout restore is opportunistic; stale markers are cleared best-effort.
  }
}

function branchNameFromRefName(refName: string): string {
  return refName.startsWith('refs/heads/') ? refName.slice('refs/heads/'.length) : refName;
}

function readProvider(ctx: DocumentContext): {
  readonly openActiveCheckoutMaterializationStore?: () => Promise<ActiveCheckoutMaterializationStore>;
} | null {
  const runtime = ctx as { readonly versioning?: unknown; readonly versionStore?: unknown };
  const services = runtime.versioning ?? runtime.versionStore ?? null;
  if (!isRecord(services)) return null;
  const provider = services.provider;
  return isRecord(provider) ? provider : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
