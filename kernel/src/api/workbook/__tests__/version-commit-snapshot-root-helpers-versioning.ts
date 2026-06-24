import type { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';
import {
  installVersionDomainDetectorNoopsOnBridgeMock,
  versioningWithDomainSupportManifest,
} from './version-domain-support-test-utils';

export type InMemoryVersionStoreProvider = ReturnType<typeof createInMemoryVersionStoreProvider>;

export function createWorkbookVersion(
  versioning: Parameters<typeof attachWorkbookVersioning>[1],
): WorkbookVersionImpl {
  const ctx = createVersionTestContext();
  attachWorkbookVersioning(ctx, versioningWithDomainSupportManifest(versioning as any));
  return new WorkbookVersionImpl(ctx);
}

export function createProviderBackedVersion(
  provider: InMemoryVersionStoreProvider,
  encodeDiff: (stateVector: Uint8Array) => Promise<Uint8Array>,
): WorkbookVersionImpl {
  const ctx = createVersionTestContext();
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

function createVersionTestContext() {
  const computeBridge = {
    semanticWorkbookStateEnvelope: async () => ({
      state: {
        schemaVersion: 'semantic-workbook-state.v1',
        workbookId: 'workbook-1',
        domains: {
          sheets: {
            domainId: 'sheets',
            domainClass: 'authored',
            capabilityState: 'supported',
          },
        },
        sheets: {},
      },
      stateDigest: digest('state'),
    }),
    diffSemanticWorkbookStates: async () => ({
      beforeDigest: digest('before'),
      afterDigest: digest('after'),
      changes: [
        {
          changeId: 'test-rust-diff:sheet:0',
          kind: 'updated',
          domainId: 'sheets',
          objectId: 'sheet-created',
          objectKind: 'sheet',
          beforeDigest: digest('sheet-before'),
          afterDigest: digest('sheet-after'),
        },
      ],
    }),
  };
  installVersionDomainDetectorNoopsOnBridgeMock(computeBridge);
  return { computeBridge } as any;
}

function digest(seed: string) {
  const repeated = seed.repeat(Math.ceil(64 / seed.length)).slice(0, 64);
  return { algorithm: 'sha256' as const, digest: repeated };
}
