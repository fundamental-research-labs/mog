import type { SnapshotRootFreshLifecycleHydrationInput } from '../snapshot-root-reload-service';

import { materializeAuthoredWorkbook } from './snapshot-root-materialization-service.test-helpers';

describe('SnapshotRootMaterializationService', () => {
  it('reads a committed snapshot root and materializes it through a fresh lifecycle', async () => {
    const fixture = await materializeAuthoredWorkbook({
      sourceDocumentId: 'stored-source-doc',
      materializedDocumentId: 'stored-materialized-doc',
      author: async (workbook) => {
        await workbook.activeSheet.setCell('A1', 7);
        await workbook.activeSheet.setCell('A2', '=A1*6');
        await workbook.activeSheet.view.freezePanes(2, 1);
        await workbook.names.add('ReplayRevenue', 'Sheet1!A1:A2', 'VC-06 replay range');
        await workbook.activeSheet.comments.setNote('B1', 'Replay note', 'VC Agent');
      },
    });

    try {
      expect(fixture.result.commitId).toBe(fixture.initialized.rootCommit.id);
      expect(fixture.result.snapshotRootDigest).toEqual(fixture.snapshotRootRecord.digest);
      expect(fixture.result.snapshotRootRecord.digest).toEqual(fixture.snapshotRootRecord.digest);
      expect(fixture.result.mutationGuarantee).toBe('no-current-workbook-mutation');
      expect(fixture.hydrateYrsFullState).toHaveBeenCalledTimes(1);
      const hydrationInput = fixture.hydrateYrsFullState.mock.calls[0]?.[0] as
        | SnapshotRootFreshLifecycleHydrationInput
        | undefined;
      expect(hydrationInput).toMatchObject({
        source: 'record',
        objectDigest: fixture.snapshotRootRecord.digest,
        byteLength: fixture.snapshotRootPayload.byteLength,
      });
      expect(hydrationInput?.yrsFullStateBytes.byteLength).toBe(
        fixture.snapshotRootPayload.byteLength,
      );
      expect(fixture.materialized.documentId).toBe('stored-materialized-doc');

      await expect(fixture.materialized.workbook.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 7,
      });
      await expect(fixture.materialized.workbook.activeSheet.getCell('A2')).resolves.toMatchObject({
        value: 42,
      });
      await expect(
        fixture.materialized.workbook.activeSheet.view.getFrozenPanes(),
      ).resolves.toEqual({
        rows: 2,
        cols: 1,
      });
      await expect(fixture.materialized.workbook.names.get('ReplayRevenue')).resolves.toMatchObject(
        {
          name: 'ReplayRevenue',
          reference: 'Sheet1!A1:A2',
          comment: 'VC-06 replay range',
        },
      );
      await expect(
        fixture.materialized.workbook.activeSheet.comments.getNote('B1'),
      ).resolves.toMatchObject({
        content: 'Replay note',
        author: 'VC Agent',
        cellAddress: 'B1',
      });

      await fixture.sourceWorkbook.activeSheet.setCell('A1', 99);
      await fixture.sourceWorkbook.names.add(
        'SourceOnly',
        'Sheet1!A1',
        'not in materialized replay',
      );
      await fixture.sourceWorkbook.activeSheet.comments.setNote(
        'B1',
        'Source-only note',
        'VC Agent',
      );
      await expect(fixture.materialized.workbook.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 7,
      });
      await expect(fixture.materialized.workbook.names.get('SourceOnly')).resolves.toBeNull();
      await expect(
        fixture.materialized.workbook.activeSheet.comments.getNote('B1'),
      ).resolves.toMatchObject({
        content: 'Replay note',
      });
    } finally {
      await fixture.dispose();
    }
  });
});
