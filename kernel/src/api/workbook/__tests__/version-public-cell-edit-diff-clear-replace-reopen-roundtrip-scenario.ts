import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  DOCUMENT_ID,
  DOCUMENT_SCOPE,
  expectInitializeSuccess,
  initializeInput,
} from './version/public-cell-edit-diff.helpers';
import { commitClearReplacePublicCellEdits } from './version-public-cell-edit-diff-clear-replace-reopen-clear-replace-scenario';
import { commitInitialPublicCellEdits } from './version-public-cell-edit-diff-clear-replace-reopen-initial-edits-scenario';
import { verifyPublicCellEditDiffAfterReopen } from './version-public-cell-edit-diff-clear-replace-reopen-reopen-scenario';

export function registerPublicCellEditClearReplaceReopenRoundtripScenario(): void {
  it('commits real worksheet value and formula edits from public APIs, then lists and diffs after reopen', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);

    const handle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let wb: Workbook | undefined;
    let reopenedHandle: Awaited<ReturnType<typeof DocumentFactory.create>> | undefined;
    let reopenedWb: Workbook | undefined;

    try {
      wb = await handle.workbook({ versioning: withVersionManifest({ provider }) });

      const { committed, committedHead } = await commitInitialPublicCellEdits({
        wb,
        provider,
        initialized,
      });
      const clearReplaceCommitted = await commitClearReplacePublicCellEdits({
        wb,
        committed,
        committedHead,
      });

      await wb.close('skipSave');
      wb = undefined;
      await handle.dispose();

      reopenedHandle = await DocumentFactory.create({
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      reopenedWb = await reopenedHandle.workbook({ versioning: withVersionManifest({ provider }) });

      await verifyPublicCellEditDiffAfterReopen({
        reopenedWb,
        initialized,
        committed,
        clearReplaceCommitted,
      });
    } finally {
      if (reopenedWb) await reopenedWb.close('skipSave');
      if (reopenedHandle) await reopenedHandle.dispose();
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });
}
