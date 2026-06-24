import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb/backend';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  DOCUMENT_ID,
  expectedCellDiff,
} from './version-indexeddb-public-cell-edit-diff-test-utils';

export function registerDefaultRootPublicCellEditDiffScenario(): void {
  it('commits public cell edits after the default blank workbook root initializer', async () => {
    const documentId = `${DOCUMENT_ID}-default-root`;
    const handle = await DocumentFactory.create({
      documentId,
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
      const rootHeadResult = await wb.version.getHead();
      if (!rootHeadResult.ok) {
        throw new Error(`expected initialized blank root head: ${rootHeadResult.error.code}`);
      }
      const rootHead = rootHeadResult.value;
      expect(rootHead.refName).toBe('refs/heads/main');
      expect(rootHead.refRevision).toBeDefined();

      await wb.activeSheet.setCell('A1', 'blank-root-edit');

      const committedResult = await wb.version.commit({
        expectedHead: {
          commitId: rootHead.id,
          revision: rootHead.refRevision,
        },
      });
      if (!committedResult.ok) {
        throw new Error(`expected default-root public commit: ${committedResult.error.code}`);
      }
      expect(committedResult).toMatchObject({
        ok: true,
        value: {
          parents: [rootHead.id],
        },
      });
      await expectSettledCleanSurface(wb);

      const diffResult = await wb.version.diff(rootHead.id, committedResult.value.id);
      if (!diffResult.ok) {
        throw new Error(`expected default-root diff: ${JSON.stringify(diffResult.error)}`);
      }
      expect(diffResult.value.items).toEqual(
        expect.arrayContaining([expectedCellDiff('A1', 'blank-root-edit')]),
      );
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });
}

async function expectSettledCleanSurface(wb: Workbook): Promise<void> {
  let surface: Awaited<ReturnType<Workbook['version']['getSurfaceStatus']>> | null = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    surface = await wb.version.getSurfaceStatus();
    if (!wb.isDirty && !surface.dirty.hasUncommittedLocalChanges && surface.dirty.checkoutSafe) {
      expect(wb.isDirty).toBe(false);
      expect(surface).toMatchObject({
        dirty: {
          hasUncommittedLocalChanges: false,
          checkoutSafe: true,
        },
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  expect(wb.isDirty).toBe(false);
  expect(surface).toMatchObject({
    dirty: {
      hasUncommittedLocalChanges: false,
      checkoutSafe: true,
    },
  });
}
