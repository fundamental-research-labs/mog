import type { Workbook } from '@mog-sdk/contracts/api';

export async function expectVc06SnapshotRootDomains(checkoutWb: Workbook): Promise<void> {
  await expect(checkoutWb.activeSheet.getCell('D1')).resolves.toMatchObject({ value: 7 });
  await expect(checkoutWb.activeSheet.getCell('D2')).resolves.toMatchObject({ value: 42 });
  expect(checkoutWb.activeSheet.name).toBe('Sheet1');
  expect(checkoutWb.activeSheet.index).toBe(0);
  expect(
    (await checkoutWb.getSheets()).map((sheet) => ({
      name: sheet.name,
      index: sheet.index,
    })),
  ).toEqual([{ name: 'Sheet1', index: 0 }]);
  await expect(checkoutWb.activeSheet.view.getFrozenPanes()).resolves.toEqual({
    rows: 2,
    cols: 1,
  });

  await expect(checkoutWb.names.get('RevenueCells')).resolves.toMatchObject({
    name: 'RevenueCells',
    reference: 'Sheet1!B2:B3',
    comment: 'VC-06 named range',
  });
  await expect(checkoutWb.names.list()).resolves.toEqual([
    expect.objectContaining({
      name: 'RevenueCells',
      reference: 'Sheet1!B2:B3',
      comment: 'VC-06 named range',
    }),
  ]);

  const table = await checkoutWb.activeSheet.tables.get('SalesTable');
  expect(table).toMatchObject({
    name: 'SalesTable',
    range: 'A1:B3',
    hasHeaderRow: true,
    hasTotalsRow: false,
  });
  expect(table?.columns.map((column) => column.name)).toEqual(['Region', 'Revenue']);

  await expect(checkoutWb.activeSheet.comments.getNote('C2')).resolves.toMatchObject({
    content: 'Revenue note',
    author: 'Analyst',
    cellAddress: 'C2',
  });
  await expect(checkoutWb.activeSheet.comments.noteCount()).resolves.toBe(1);
  await expect(checkoutWb.activeSheet.comments.listNotes()).resolves.toEqual([
    expect.objectContaining({
      content: 'Revenue note',
      author: 'Analyst',
    }),
  ]);
  await expect(checkoutWb.activeSheet.comments.getForCell('C3')).resolves.toEqual([
    expect.objectContaining({
      content: 'Investigate east result',
      author: 'Reviewer',
      commentType: 'threadedComment',
    }),
  ]);

  await expect(checkoutWb.activeSheet.validations.get('E2')).resolves.toMatchObject({
    type: 'list',
    values: ['Open', 'Closed'],
    allowBlank: false,
    showDropdown: true,
    errorStyle: 'stop',
    errorTitle: 'Invalid status',
    errorMessage: 'Pick a status from the list.',
  });
  await expect(checkoutWb.activeSheet.validations.getDropdownItems('E2')).resolves.toEqual([
    'Open',
    'Closed',
  ]);
  await expect(checkoutWb.activeSheet.validations.validate('E2', 'Blocked')).resolves.toEqual({
    valid: false,
    errorStyle: 'stop',
    errorTitle: 'Invalid status',
    errorMessage: 'Pick a status from the list.',
  });

  const conditionalFormats = await checkoutWb.activeSheet.conditionalFormats.list();
  expect(conditionalFormats).toHaveLength(1);
  expect(conditionalFormats[0]).toMatchObject({
    ranges: [{ startRow: 1, startCol: 1, endRow: 2, endCol: 1 }],
    rules: [
      expect.objectContaining({
        type: 'formula',
        formula: '=B2>20',
        style: expect.objectContaining({
          backgroundColor: '#fff2cc',
          fontColor: '#9c6500',
          bold: true,
        }),
      }),
    ],
  });

  const filters = await checkoutWb.activeSheet.filters.list();
  const autoFilter = filters.find((filter) => filter.filterKind === 'autoFilter');
  expect(autoFilter).toEqual(
    expect.objectContaining({
      range: { startRow: 0, startCol: 0, endRow: 2, endCol: 1 },
      columnFilters: {},
    }),
  );
  await expect(checkoutWb.activeSheet.filters.get()).resolves.toEqual({
    range: 'A1:B3',
    columnFilters: {},
  });
  await expect(checkoutWb.activeSheet.filters.getSortState(autoFilter!.id)).resolves.toEqual({
    column: expect.any(String),
    direction: 'desc',
  });

  const chart = await checkoutWb.activeSheet.charts.getByName('RevenueChart');
  expect(chart).toMatchObject({
    type: 'column',
    name: 'RevenueChart',
    title: 'Revenue by Region',
    dataRange: 'A1:B3',
    anchorRow: 4,
    anchorCol: 0,
    width: 360,
    height: 240,
  });
  await expect(checkoutWb.activeSheet.charts.usesRange('A1:B3')).resolves.toBe(true);

  const shape = await checkoutWb.activeSheet.shapes.getItemAt(0);
  expect(shape).toMatchObject({
    type: 'shape',
    shapeType: 'rect',
  });
  await expect(checkoutWb.activeSheet.objects.getInfo(shape!.id)).resolves.toMatchObject({
    type: 'shape',
    name: 'RevenueCallout',
    width: 160,
    height: 60,
  });
  await expect(shape?.getData()).resolves.toMatchObject({
    type: 'shape',
    name: 'RevenueCallout',
    position: expect.objectContaining({
      anchorType: 'oneCell',
      from: expect.objectContaining({
        cellId: expect.any(String),
      }),
    }),
  });
}
