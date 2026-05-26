import { jest } from '@jest/globals';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import type {
  PivotFieldPlacementFlat,
  PivotMemberKey,
  PivotColumnHeader,
  PivotRow,
  PivotTableConfig,
  PivotTableResult,
  PivotTupleKey,
} from '@mog-sdk/contracts/pivot';

jest.unstable_mockModule('../ui', () => ({
  Button: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <button {...props}>{children}</button>
  ),
}));

const { PivotTableView } = await import('./PivotTableView');

type TestPlacement = Omit<PivotFieldPlacementFlat, 'placementId'> & {
  placementId?: PivotFieldPlacementFlat['placementId'];
};

function placementId(id: string): PivotFieldPlacementFlat['placementId'] {
  return id as PivotFieldPlacementFlat['placementId'];
}

function memberKey(key: string): PivotMemberKey {
  return key as PivotMemberKey;
}

function tupleKey(key: string): PivotTupleKey {
  return key as PivotTupleKey;
}

function withPlacementIds(placements: TestPlacement[]): PivotTableConfig['placements'] {
  return placements.map((placement, index) => ({
    ...placement,
    placementId:
      placement.placementId ?? placementId(`${placement.area}:${placement.fieldId}:${index}`),
  }));
}

function baseConfig(placements: TestPlacement[]): PivotTableConfig {
  return {
    id: 'pivot-1',
    name: 'PivotTable1',
    sourceSheetName: 'Sheet1',
    sourceRange: { startRow: 0, startCol: 0, endRow: 4, endCol: 2 },
    outputSheetName: 'Sheet1',
    outputLocation: { row: 0, col: 5 },
    fields: [
      { id: 'Region', name: 'Region', sourceColumn: 0, dataType: 'string' },
      { id: 'Product', name: 'Product', sourceColumn: 1, dataType: 'string' },
      { id: 'Revenue', name: 'Revenue', sourceColumn: 2, dataType: 'number' },
    ],
    placements: withPlacementIds(placements),
    filters: [],
  };
}

function result(
  columnHeaders: PivotColumnHeader[],
  rows: PivotRow[],
  grandTotals: PivotTableResult['grandTotals'] = {},
): PivotTableResult {
  return {
    columnHeaders,
    rows,
    grandTotals,
    sourceRowCount: 5,
    renderedBounds: {
      totalRows: rows.length + columnHeaders.length,
      totalCols: 1,
      firstDataRow: columnHeaders.length,
      firstDataCol: 1,
      numDataCols: 0,
    },
  };
}

function row(key: string, value: string, values: PivotRow['values'] = []): PivotRow {
  return {
    key: tupleKey(key),
    headers: [
      {
        key: memberKey(key),
        value,
        fieldId: 'Region',
        depth: 0,
        span: 1,
        isExpandable: false,
        isExpanded: true,
        isSubtotal: false,
        isGrandTotal: value === 'Grand Total',
      },
    ],
    values,
    depth: 0,
    isSubtotal: false,
    isGrandTotal: value === 'Grand Total',
  };
}

describe('PivotTableView no-value framing', () => {
  test('renders a row-field frame without a synthetic Values column', () => {
    render(
      <PivotTableView
        config={baseConfig([{ fieldId: 'Region', area: 'row', position: 0 }])}
        result={result([], [row('east', 'East'), row('north', 'North'), row('gt', 'Grand Total')])}
      />,
    );

    const tableRows = screen.getAllByRole('row');
    expect(within(tableRows[0]).getByRole('columnheader')).toHaveTextContent('Region');
    expect(within(tableRows[0]).queryByText('Values')).not.toBeInTheDocument();
    expect(tableRows.map((tr) => tr.textContent)).toEqual([
      'Region',
      'East',
      'North',
      'Grand Total',
    ]);
  });

  test('renders column headers when columns exist without values', () => {
    render(
      <PivotTableView
        config={baseConfig([{ fieldId: 'Product', area: 'column', position: 0 }])}
        result={result(
          [
            {
              fieldId: 'Product',
              headers: [
                {
                  key: 'gadget',
                  value: 'Gadget',
                  fieldId: 'Product',
                  depth: 0,
                  span: 1,
                  isExpandable: false,
                  isExpanded: true,
                  isSubtotal: false,
                  isGrandTotal: false,
                },
                {
                  key: 'widget',
                  value: 'Widget',
                  fieldId: 'Product',
                  depth: 0,
                  span: 1,
                  isExpandable: false,
                  isExpanded: true,
                  isSubtotal: false,
                  isGrandTotal: false,
                },
              ],
            },
          ],
          [],
        )}
      />,
    );

    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Gadget',
      'Widget',
      'Grand Total',
    ]);
  });
});
