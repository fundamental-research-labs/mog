import type { PivotTableConfig } from '@mog-sdk/contracts/pivot';
import {
  automaticPivotValueDisplayName,
  automaticPivotValuePlacementDisplayName,
  valuePlacementWithAggregate,
} from '../value-labels';

function makeConfig(overrides?: Partial<PivotTableConfig>): PivotTableConfig {
  return {
    id: 'pivot-1',
    name: 'SalesPivot',
    sourceSheetName: 'Sheet1',
    sourceRange: { startRow: 0, startCol: 0, endRow: 10, endCol: 2 },
    fields: [
      { id: 'Region', name: 'Region', dataType: 'string' },
      { id: 'Amount', name: 'Amount', dataType: 'number' },
    ],
    placements: [],
    filters: [],
    calculatedFields: [],
    outputLocation: { row: 0, col: 0 },
    ...overrides,
  };
}

describe('pivot value labels', () => {
  it('builds aggregate labels from source field names', () => {
    const config = makeConfig();

    expect(
      automaticPivotValueDisplayName({
        config,
        fieldId: 'Amount',
        aggregateFunction: 'min',
      }),
    ).toBe('Min of Amount');
  });

  it('updates automatic labels when aggregation changes', () => {
    const config = makeConfig();
    const placement = {
      fieldId: 'Amount',
      area: 'value' as const,
      position: 0,
      aggregateFunction: 'sum' as const,
      displayName: 'Sum of Amount',
    };

    expect(
      valuePlacementWithAggregate({
        config,
        placement,
        aggregateFunction: 'max',
      }),
    ).toEqual(expect.objectContaining({ aggregateFunction: 'max', displayName: 'Max of Amount' }));
  });

  it('updates legacy source-only labels but preserves custom labels', () => {
    const config = makeConfig();

    expect(
      valuePlacementWithAggregate({
        config,
        placement: {
          fieldId: 'Amount',
          area: 'value',
          position: 0,
          aggregateFunction: 'sum',
          displayName: 'Amount',
        },
        aggregateFunction: 'average',
      }).displayName,
    ).toBe('Average of Amount');

    expect(
      valuePlacementWithAggregate({
        config,
        placement: {
          fieldId: 'Amount',
          area: 'value',
          position: 0,
          aggregateFunction: 'sum',
          displayName: 'Total Sales',
        },
        aggregateFunction: 'average',
      }).displayName,
    ).toBe('Total Sales');
  });

  it('uses calculated field names for calculated value placements', () => {
    const config = makeConfig({
      calculatedFields: [
        {
          fieldId: 'CalcMargin',
          calculatedFieldId: 'CalcMargin' as any,
          name: 'Margin',
          formula: '=Amount / 2',
        },
      ],
    });

    expect(
      automaticPivotValuePlacementDisplayName({
        config,
        placement: {
          fieldId: 'CalcMargin',
          calculatedFieldId: 'CalcMargin' as any,
          area: 'value',
          position: 0,
          aggregateFunction: 'sum',
        },
      }),
    ).toBe('Sum of Margin');
  });
});
