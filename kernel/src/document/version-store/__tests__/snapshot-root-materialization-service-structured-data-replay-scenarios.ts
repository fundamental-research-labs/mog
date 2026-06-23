import {
  cellRangeEquals,
  materializeAuthoredWorkbook,
} from './snapshot-root-materialization-service.test-helpers';

export function registerSnapshotRootMaterializationStructuredDataReplayScenarios(): void {
  it('materializes tables, validations, conditional formats, filters, and sorted cells', async () => {
    const fixture = await materializeAuthoredWorkbook({
      sourceDocumentId: 'structured-source-doc',
      materializedDocumentId: 'structured-materialized-doc',
      graphId: 'graph-structured-data',
      author: async (workbook) => {
        await workbook.activeSheet.setCell('D1', 'Region');
        await workbook.activeSheet.setCell('E1', 'Revenue');
        await workbook.activeSheet.setCell('D2', 'West');
        await workbook.activeSheet.setCell('E2', 12);
        await workbook.activeSheet.setCell('D3', 'East');
        await workbook.activeSheet.setCell('E3', 30);
        await workbook.activeSheet.setCell('D4', 'North');
        await workbook.activeSheet.setCell('E4', 18);
        await workbook.activeSheet.tables.add('D1:E4', {
          name: 'ReplaySales',
          hasHeaders: true,
          style: 'TableStyleMedium2',
        });
        await workbook.activeSheet.validations.setList('G1:G3', ['Open', 'Closed'], {
          allowBlank: false,
          showDropdown: true,
          showInputMessage: true,
          inputTitle: 'Replay status',
          inputMessage: 'Choose a replay status',
          errorTitle: 'Invalid status',
          errorMessage: 'Status must come from the replay list.',
        });
        await workbook.activeSheet.setCell('I1', 1);
        await workbook.activeSheet.setCell('I2', 2);
        await workbook.activeSheet.setCell('I3', 3);
        const conditionalFormat = await workbook.activeSheet.conditionalFormats.addFormula(
          'I1:I3',
          '=I1>1',
          { backgroundColor: '#fff2cc' },
        );
        await workbook.activeSheet.setCell('K1', 'Task');
        await workbook.activeSheet.setCell('L1', 'Status');
        await workbook.activeSheet.setCell('K2', 'Import');
        await workbook.activeSheet.setCell('L2', 'Open');
        await workbook.activeSheet.setCell('K3', 'Export');
        await workbook.activeSheet.setCell('L3', 'Closed');
        await workbook.activeSheet.setCell('K4', 'Replay');
        await workbook.activeSheet.setCell('L4', 'Open');
        const autoFilter = await workbook.activeSheet.filters.add('K1:L4');
        const autoFilterDetail = (await workbook.activeSheet.filters.list()).find(
          (filter) =>
            filter.filterKind === 'autoFilter' && cellRangeEquals(filter.range, 0, 10, 3, 11),
        );
        if (!autoFilterDetail) throw new Error('expected authored auto-filter detail');
        await workbook.activeSheet.filters.setColumnFilter(
          11,
          { type: 'value', values: ['Open'] },
          autoFilterDetail.id,
        );
        await workbook.activeSheet.setCell('N1', 'Name');
        await workbook.activeSheet.setCell('O1', 'Score');
        await workbook.activeSheet.setCell('N2', 'Beta');
        await workbook.activeSheet.setCell('O2', 20);
        await workbook.activeSheet.setCell('N3', 'Alpha');
        await workbook.activeSheet.setCell('O3', 40);
        await workbook.activeSheet.setCell('N4', 'Gamma');
        await workbook.activeSheet.setCell('O4', 10);
        await workbook.activeSheet.sortRange('N1:O4', {
          hasHeaders: true,
          columns: [{ column: 1, direction: 'desc' }],
        });

        return {
          autoFilterRange: autoFilter.range,
          conditionalFormatId: conditionalFormat.id,
        };
      },
    });

    try {
      const materializedSheet = fixture.materialized.workbook.activeSheet;
      const materializedTable = await materializedSheet.tables.get('ReplaySales');
      expect(materializedTable).toMatchObject({
        name: 'ReplaySales',
        range: 'D1:E4',
        hasHeaderRow: true,
        hasTotalsRow: false,
        style: 'TableStyleMedium2',
      });
      expect(materializedTable?.columns.map((column) => column.name)).toEqual([
        'Region',
        'Revenue',
      ]);
      await expect(materializedSheet.tables.getAtCell('E3')).resolves.toMatchObject({
        name: 'ReplaySales',
      });

      await expect(materializedSheet.validations.get('G2')).resolves.toMatchObject({
        type: 'list',
        range: 'G1:G3',
        values: ['Open', 'Closed'],
        allowBlank: false,
        showDropdown: true,
        inputTitle: 'Replay status',
        inputMessage: 'Choose a replay status',
        errorTitle: 'Invalid status',
        errorMessage: 'Status must come from the replay list.',
      });
      await expect(materializedSheet.validations.getCount()).resolves.toBe(1);

      await expect(
        materializedSheet.conditionalFormats.get(fixture.artifacts.conditionalFormatId),
      ).resolves.toMatchObject({
        id: fixture.artifacts.conditionalFormatId,
        ranges: [{ startRow: 0, startCol: 8, endRow: 2, endCol: 8 }],
        rules: [
          expect.objectContaining({
            type: 'formula',
            formula: '=I1>1',
            style: expect.objectContaining({ backgroundColor: '#fff2cc' }),
          }),
        ],
      });
      await expect(materializedSheet.conditionalFormats.getCount()).resolves.toBe(1);

      expect(fixture.artifacts.autoFilterRange).toBe('K1:L4');
      const materializedAutoFilter = (await materializedSheet.filters.list()).find(
        (filter) =>
          filter.filterKind === 'autoFilter' && cellRangeEquals(filter.range, 0, 10, 3, 11),
      );
      expect(materializedAutoFilter).toBeDefined();
      expect(Object.values(materializedAutoFilter?.columnFilters ?? {})).toEqual([
        expect.objectContaining({ type: 'value', values: ['Open'] }),
      ]);
      await expect(materializedSheet.filters.isDataFiltered()).resolves.toBe(true);

      await expect(materializedSheet.getCell('N2')).resolves.toMatchObject({
        value: 'Alpha',
      });
      await expect(materializedSheet.getCell('O2')).resolves.toMatchObject({
        value: 40,
      });
      await expect(materializedSheet.getCell('N4')).resolves.toMatchObject({
        value: 'Gamma',
      });
      await expect(materializedSheet.getCell('O4')).resolves.toMatchObject({
        value: 10,
      });

      await fixture.sourceWorkbook.activeSheet.tables.add('T1:U2', {
        name: 'SourceOnlyTable',
        hasHeaders: false,
      });
      await fixture.sourceWorkbook.activeSheet.validations.setList('G1:G3', ['SourceOnly']);
      await fixture.sourceWorkbook.activeSheet.conditionalFormats.clear();
      await fixture.sourceWorkbook.activeSheet.filters.clear();
      await expect(materializedSheet.tables.get('SourceOnlyTable')).resolves.toBeNull();
      await expect(materializedSheet.validations.get('G2')).resolves.toMatchObject({
        values: ['Open', 'Closed'],
      });
      await expect(
        materializedSheet.conditionalFormats.get(fixture.artifacts.conditionalFormatId),
      ).resolves.toMatchObject({
        id: fixture.artifacts.conditionalFormatId,
      });
      await expect(materializedSheet.filters.list()).resolves.toContainEqual(
        expect.objectContaining({
          id: materializedAutoFilter?.id,
        }),
      );
    } finally {
      await fixture.dispose();
    }
  });
}
