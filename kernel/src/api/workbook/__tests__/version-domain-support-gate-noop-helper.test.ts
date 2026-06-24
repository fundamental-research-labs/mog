import { jest } from '@jest/globals';

import type { Workbook, WorkbookInternal } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../context';
import { DocumentFactory } from '../../document/document-factory';
import { validateVersionDomainSupportManifestGate } from '../version/domain-support/version-domain-support-gate';
import {
  VERSION_DOMAIN_DETECTOR_NOOP_SYNTHETIC_SHEET_ID,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_NOW as NOW,
  VERSION_DOMAIN_SUPPORT_MANIFEST_TEST_TEN_MINUTES_MS as TEN_MINUTES_MS,
  freshVersionDomainSupportManifest as freshManifest,
  installVersionDomainDetectorNoopsOnBridgeMock,
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
} from './version-domain-support-test-utils';

describe('WorkbookVersion domain support detector noop helper contract', () => {
  it('preserves real workbook sheet IDs and keeps synthetic IDs out of metadata and pivot refresh after post-init installation', async () => {
    const handle = await DocumentFactory.create({
      documentId: 'w8-01-domain-detector-noop-real-workbook',
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook();
      const ctx = workbookContext(wb);
      const computeBridge = ctx.computeBridge as unknown as Record<string, unknown>;
      const pivotBridge = ctx.pivot as unknown as Record<string, unknown>;
      const originalGetAllSheetIds = bindMethod<[], Promise<string[]>>(
        computeBridge,
        'getAllSheetIds',
      );
      const originalGetSheetName = bindMethod<[string], Promise<string | null>>(
        computeBridge,
        'getSheetName',
      );
      const originalIsSheetHidden = bindMethod<[string], Promise<boolean>>(
        computeBridge,
        'isSheetHidden',
      );
      const originalGetAllPivots = bindMethod<[string], Promise<unknown[]>>(
        pivotBridge,
        'getAllPivots',
      );

      const realSheetIds = await originalGetAllSheetIds();
      expect(realSheetIds.length).toBeGreaterThan(0);
      expect(realSheetIds).not.toContain(VERSION_DOMAIN_DETECTOR_NOOP_SYNTHETIC_SHEET_ID);

      installVersionDomainDetectorNoopsOnWorkbook(wb);

      await expect(originalGetAllSheetIds()).resolves.toEqual(realSheetIds);
      await expect(
        bindMethod<[], Promise<string[]>>(computeBridge, 'getAllSheetIds')(),
      ).resolves.toEqual(realSheetIds);

      const metadataSheetIds: string[] = [];
      const pivotSheetIds: string[] = [];
      computeBridge.getSheetName = jest.fn(async (sheetId: string) => {
        metadataSheetIds.push(sheetId);
        return originalGetSheetName(sheetId);
      });
      computeBridge.isSheetHidden = jest.fn(async (sheetId: string) => {
        metadataSheetIds.push(sheetId);
        return originalIsSheetHidden(sheetId);
      });
      pivotBridge.getAllPivots = jest.fn(async (sheetId: string) => {
        pivotSheetIds.push(sheetId);
        return originalGetAllPivots(sheetId);
      });

      await (wb as WorkbookInternal).refreshSheetMetadata();
      await wb.activeSheet.pivots.refreshAll();

      expect(metadataSheetIds).toEqual(expect.arrayContaining(realSheetIds));
      expect(metadataSheetIds).not.toContain(VERSION_DOMAIN_DETECTOR_NOOP_SYNTHETIC_SHEET_ID);
      expect(pivotSheetIds).toEqual([wb.activeSheet.sheetId]);
      expect(pivotSheetIds).not.toContain(VERSION_DOMAIN_DETECTOR_NOOP_SYNTHETIC_SHEET_ID);
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });

  it('uses the synthetic fallback only for explicit bridge mocks without a native sheet getter', async () => {
    const bridge: Record<string, unknown> = {};

    installVersionDomainDetectorNoopsOnBridgeMock(bridge);

    await expect(bindMethod<[], Promise<string[]>>(bridge, 'getAllSheetIds')()).resolves.toEqual([
      VERSION_DOMAIN_DETECTOR_NOOP_SYNTHETIC_SHEET_ID,
    ]);
    await expect(
      validateVersionDomainSupportManifestGate(
        {
          versioning: {
            domainSupportManifest: freshManifest(),
            domainSupportManifestOptions: {
              now: NOW,
              maxAgeMs: TEN_MINUTES_MS,
            },
          },
          computeBridge: bridge,
        } as any,
        'commit',
      ),
    ).resolves.toEqual([]);

    installVersionDomainDetectorNoopsOnHandles({ context: { computeBridge: bridge } });

    expect(bridge.getAllSheetIds).toBeUndefined();
  });

  it('does not synthesize sheet IDs for workbook targets without a native sheet getter', () => {
    const bridge: Record<string, unknown> = {};
    const wb = {
      version: {
        ctx: { computeBridge: bridge },
      },
    } as unknown as Pick<Workbook, 'version'>;

    installVersionDomainDetectorNoopsOnWorkbook(wb);

    expect(bridge.getAllSheetIds).toBeUndefined();
  });
});

function workbookContext(wb: Pick<Workbook, 'version'>): DocumentContext {
  const version = wb.version as unknown as {
    ctx?: DocumentContext;
    versionContext?: DocumentContext;
  };
  const ctx = version.ctx ?? version.versionContext;
  if (!ctx) throw new Error('expected workbook version context');
  return ctx;
}

function bindMethod<Args extends readonly unknown[], Result>(
  record: Record<string, unknown>,
  methodName: string,
): (...args: Args) => Result {
  const method = record[methodName];
  if (typeof method !== 'function') {
    throw new Error(`expected ${methodName} to be callable`);
  }
  return method.bind(record) as (...args: Args) => Result;
}
