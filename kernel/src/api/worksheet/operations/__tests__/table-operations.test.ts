import { bridgeTableToTableInfo } from '../table-operations';
import type { Table } from '../../../../bridges/compute/compute-types.gen';

function makeTable(style: string): Table {
  return {
    id: 'Table1',
    name: 'Table1',
    displayName: 'Table1',
    sheetId: 'sheet-1',
    range: { startRow: 0, startCol: 0, endRow: 1, endCol: 1 },
    columns: [
      {
        id: '1',
        name: 'Name',
        index: 0,
        totalsFunction: null,
        totalsLabel: null,
      },
    ],
    hasHeaderRow: true,
    hasTotalsRow: false,
    style,
    bandedRows: true,
    bandedColumns: false,
    emphasizeFirstColumn: false,
    emphasizeLastColumn: false,
    showFilterButtons: true,
    autoExpand: true,
    autoCalculatedColumns: true,
  };
}

describe('bridgeTableToTableInfo', () => {
  it('returns canonical built-in table style names for full compute IDs', () => {
    expect(bridgeTableToTableInfo(makeTable('TableStyleMedium4')).style).toBe('TableStyleMedium4');
  });

  it('canonicalizes short built-in table style IDs to public style names', () => {
    expect(bridgeTableToTableInfo(makeTable('medium4')).style).toBe('TableStyleMedium4');
  });

  it('preserves custom table style names', () => {
    expect(bridgeTableToTableInfo(makeTable('MyCustomStyle')).style).toBe('MyCustomStyle');
  });

  it('normalizes built-in table style casing and zero padding', () => {
    expect(bridgeTableToTableInfo(makeTable('tablestylemedium04')).style).toBe('TableStyleMedium4');
  });
});
