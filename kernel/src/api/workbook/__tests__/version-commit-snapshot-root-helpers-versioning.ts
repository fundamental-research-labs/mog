import type { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';
import { versioningWithDomainSupportManifest } from './version-domain-support-test-utils';

export type InMemoryVersionStoreProvider = ReturnType<typeof createInMemoryVersionStoreProvider>;

export function createWorkbookVersion(
  versioning: Parameters<typeof attachWorkbookVersioning>[1],
): WorkbookVersionImpl {
  const ctx = {} as any;
  attachWorkbookVersioning(ctx, versioningWithDomainSupportManifest(versioning as any));
  return new WorkbookVersionImpl(ctx);
}

export function createProviderBackedVersion(
  provider: InMemoryVersionStoreProvider,
  encodeDiff: (stateVector: Uint8Array) => Promise<Uint8Array>,
): WorkbookVersionImpl {
  const ctx = {} as any;
  attachWorkbookVersioning(
    ctx,
    versioningWithDomainSupportManifest({
      provider,
      snapshotRootByteSyncPort: { encodeDiff },
    }),
  );
  return new WorkbookVersionImpl(ctx);
}

export function versionContext(version: WorkbookVersionImpl): any {
  return (version as any).ctx;
}
