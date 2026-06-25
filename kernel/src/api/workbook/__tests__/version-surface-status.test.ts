import 'fake-indexeddb/auto';

import { jest } from '@jest/globals';

import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb/backend';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';
import { WorkbookVersionImpl } from '../version';
import { withVersionManifest } from './version-domain-support-test-utils';
import { SURFACE_CAPABILITY_KEYS, createMockCtx } from './version-surface-status-test-utils';

describe('WorkbookVersion surface status facade', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await deleteVersionStoreIndexedDbForTesting();
  });

  afterEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });

  it('returns off surface status with disabled capabilities when no services are attached', async () => {
    const version = new WorkbookVersionImpl(createMockCtx());

    const surface = await version.getSurfaceStatus();

    expect(surface.schemaVersion).toBe(1);
    expect(surface.documentId).toBe('document-1');
    expect(surface.stage).toBe('off');
    expect(surface.featureGateEnabled).toBe(true);
    expect(surface.storage).toMatchObject({
      ready: false,
      backend: 'unknown',
    });
    expect(surface.dirty).toMatchObject({
      source: 'VC-05',
      checkoutSafe: false,
      checkoutPreflightToken: 'VC-05-checkout-preflight-unavailable',
    });
    expect(Object.keys(surface.capabilities).sort()).toEqual([...SURFACE_CAPABILITY_KEYS].sort());
    expect(Object.values(surface.capabilities).every((capability) => !capability.enabled)).toBe(
      true,
    );
    expect(surface.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'version.surfaceStatus.featureGateDefaultEnabled',
        'version.surfaceStatus.storageUnavailable',
        'version.surfaceStatus.readUnavailable',
        'version.surfaceStatus.dirtyTokenUnavailable',
      ]),
    );
  });

  it('reports ready storage and a main ref head for a blank IndexedDB-backed document', async () => {
    const handle = await DocumentFactory.create({
      documentId: 'vc-shell-default-versioning-blank',
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook({
        versioning: withVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        }),
      });

      const surface = await wb.version.getSurfaceStatus();
      const diagnosticCodes = surface.diagnostics.map((diagnostic) => diagnostic.code);

      expect(surface.storage).toMatchObject({
        ready: true,
        backend: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
      });
      for (const code of [
        'version.surfaceStatus.storageUnavailable',
        'version.surfaceStatus.readUnavailable',
        'version.surfaceStatus.currentReadFailed',
      ]) {
        expect(diagnosticCodes).not.toContain(code);
      }

      const head = await wb.version.getHead();
      expect(head).toMatchObject({
        ok: true,
        value: {
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          refRevision: expect.anything(),
        },
      });
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });
});
