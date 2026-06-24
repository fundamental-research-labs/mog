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

export async function writePersistedActiveCheckoutMaterialization(
  ctx: DocumentContext,
  session: VersionSurfaceCheckoutSession,
): Promise<void> {
  if (session.detached || !session.branchName || !session.refHeadAtMaterialization) return;
  try {
    const store = await openStore(ctx);
    if (!store) return;
    await store.write({
      checkedOutCommitId: session.checkedOutCommitId,
      branchName: session.branchName,
      refHeadAtMaterialization: session.refHeadAtMaterialization,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // Durable active-checkout restore is opportunistic; live materialization already succeeded.
  }
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
