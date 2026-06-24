import { it } from '@jest/globals';
import type { Workbook } from '@mog-sdk/contracts/api';

import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb/backend';
import { DocumentFactory } from '../../document/document-factory';
import { withVersionManifest } from './version-domain-support-test-utils';
import { INDEXEDDB_PERSISTED_APPLY_DOCUMENT_ID as DOCUMENT_ID } from './version-indexeddb-persisted-apply-test-utils';
import {
  expectFastForwardCheckoutCells,
  expectPersistedFastForwardAppliesAfterReopen,
} from './version-indexeddb-persisted-apply-fast-forward-provider-selection-reopen-assertions';
import { stagePersistedFastForwardPreviewForProviderSelectionReopen } from './version-indexeddb-persisted-apply-fast-forward-provider-selection-reopen-stage';

type DocumentHandle = Awaited<ReturnType<typeof DocumentFactory.create>>;

export function registerProviderSelectionReopenFastForwardScenario(): void {
  it('applies a persisted fast-forward result after provider-selection reopen', async () => {
    const stage = await stagePersistedFastForwardPreviewForProviderSelectionReopen();
    let reopenedHandle: DocumentHandle | undefined;
    let reopenedWb: Workbook | undefined;
    let checkoutHandle: DocumentHandle | undefined;
    let checkoutWb: Workbook | undefined;

    try {
      reopenedHandle = await DocumentFactory.create({
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      reopenedWb = await openWorkbookWithIndexedDbProviderSelection(reopenedHandle);

      await expectPersistedFastForwardAppliesAfterReopen(reopenedWb, stage);

      checkoutHandle = await DocumentFactory.create({
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      checkoutWb = await openWorkbookWithIndexedDbProviderSelection(checkoutHandle);
      await expectFastForwardCheckoutCells(checkoutWb, stage);
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (checkoutHandle) await checkoutHandle.dispose();
      if (reopenedWb) await reopenedWb.close('skipSave');
      if (reopenedHandle) await reopenedHandle.dispose();
    }
  });
}

async function openWorkbookWithIndexedDbProviderSelection(
  handle: DocumentHandle,
): Promise<Workbook> {
  return handle.workbook({
    versioning: withVersionManifest({
      providerSelection: {
        kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
        requireDurablePersistence: true,
      },
    }),
  });
}
