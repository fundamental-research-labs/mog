import type { Workbook } from '@mog-sdk/contracts/api';

export async function authorVc06State(wb: Workbook): Promise<void> {
  const sheet = wb.activeSheet;
  await sheet.setCell('A1', 'Region');
  await sheet.setCell('B1', 'Revenue');
  await sheet.setCell('C1', 'Commentary');
  await sheet.setCell('A2', 'West');
  await sheet.setCell('B2', 12);
  await sheet.setCell('C2', 'Needs review');
  await sheet.setCell('A3', 'East');
  await sheet.setCell('B3', 30);
  await sheet.setCell('C3', 'Accepted');
  await sheet.setCell('D1', 7);
  await sheet.setCell('D2', '=D1*6');
  await sheet.setCell('E1', 'Status');
  await sheet.setCell('E2', 'Open');
  await wb.names.add('RevenueCells', 'Sheet1!B2:B3', 'VC-06 named range');
  await sheet.tables.add('A1:B3', {
    name: 'SalesTable',
    hasHeaders: true,
  });
  await sheet.comments.addNote('C2', { text: 'Revenue note', author: 'Analyst' });
  await sheet.comments.add('C3', { text: 'Investigate east result', author: 'Reviewer' });
  await sheet.validations.setList('E2:E3', ['Open', 'Closed'], {
    allowBlank: false,
    showDropdown: true,
    showErrorAlert: true,
    errorStyle: 'stop',
    errorTitle: 'Invalid status',
    errorMessage: 'Pick a status from the list.',
  });
  await sheet.conditionalFormats.addFormula('B2:B3', '=B2>20', {
    backgroundColor: '#fff2cc',
    fontColor: '#9c6500',
    bold: true,
  });
  await sheet.filters.add('A1:B3');
  const filter = (await sheet.filters.list()).find((entry) => entry.filterKind === 'autoFilter');
  const revenueHeader = (await sheet.filters.listHeaderInfo()).find(
    (entry) =>
      entry.filterId === filter?.id && entry.sourceType === 'sheetAutoFilter' && entry.col === 1,
  );
  if (!filter || !revenueHeader) {
    throw new Error('expected auto-filter metadata to be readable before commit');
  }
  await sheet.filters.setSortState(filter.id, {
    column: revenueHeader.headerCellId,
    direction: 'desc',
  });
  await sheet.charts.add({
    type: 'column',
    name: 'RevenueChart',
    title: 'Revenue by Region',
    dataRange: 'A1:B3',
    anchorRow: 4,
    anchorCol: 0,
    width: 360,
    height: 240,
  });
  await sheet.shapes.add({
    type: 'rect',
    name: 'RevenueCallout',
    anchorRow: 4,
    anchorCol: 3,
    width: 160,
    height: 60,
    fill: { type: 'solid', color: '#d9ead3' },
    text: {
      runs: [{ text: 'Tracked in VC-06' }],
    },
  });
}
