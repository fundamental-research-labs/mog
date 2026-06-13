import type { ColumnFilterCriteria } from '@mog-sdk/contracts/filter';

import {
  columnFilterCriteriaToCompute,
  computeColumnFilterToCriteria,
  identityFormulaToWire,
  wireToIdentityFormula,
} from '../compute-wire-converters';

describe('compute wire filter converters', () => {
  it('preserves blank-only value filters', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: [],
      includeBlanks: true,
    };

    expect(columnFilterCriteriaToCompute(criteria)).toEqual({
      type: 'values',
      values: [],
      includeBlanks: true,
    });
  });

  it('honors explicit includeBlanks false before legacy blank values', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: [null, 'A'],
      includeBlanks: false,
    };

    expect(columnFilterCriteriaToCompute(criteria)).toEqual({
      type: 'values',
      values: ['A'],
      includeBlanks: false,
    });
  });

  it('roundtrips explicit includeBlanks through compute criteria', () => {
    const criteria = computeColumnFilterToCriteria({
      type: 'values',
      values: ['A'],
      includeBlanks: true,
    });

    expect(criteria).toEqual({
      type: 'value',
      values: ['A'],
      includeBlanks: true,
    });
  });

  it('serializes color filters using generated compute wire fields', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'color',
      colorFilter: {
        type: 'font',
        color: '#00ff00',
      },
    };

    expect(columnFilterCriteriaToCompute(criteria)).toEqual({
      type: 'color',
      color: '#00ff00',
      byFont: true,
    });
  });

  it('serializes icon filters using generated compute wire fields', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'icon',
      iconFilter: {
        iconSet: '3TrafficLights1',
        iconIndex: 0,
      },
    };

    expect(columnFilterCriteriaToCompute(criteria)).toEqual({
      type: 'icon',
      iconSetName: '3TrafficLights1',
      iconIndex: 0,
    });
  });

  it('accepts icon filter fields from compute', () => {
    expect(
      computeColumnFilterToCriteria({
        type: 'icon',
        iconSetName: '3TrafficLights1',
        iconIndex: 1,
      }),
    ).toEqual({
      type: 'icon',
      iconFilter: {
        iconSet: '3TrafficLights1',
        iconIndex: 1,
      },
    });
  });
});

describe('compute wire identity formula converters', () => {
  it('roundtrips RectRange refs without dropping row/column identities', () => {
    const wire = {
      template: '{0}',
      refs: [
        {
          RectRange: {
            sheet_id: '00000000000000000000000000004037',
            start_row_id: '0000000000000000000000000001cdbc',
            start_col_id: '0000000000000000000000000001ce26',
            end_row_id: '0000000000000000000000000001cdde',
            end_col_id: '0000000000000000000000000001ce38',
            start_row_absolute: true,
            start_col_absolute: true,
            end_row_absolute: true,
            end_col_absolute: true,
          },
        },
      ],
      is_dynamic_array: false,
      is_volatile: false,
    };

    const contract = wireToIdentityFormula(wire);

    expect(contract.refs[0]).toEqual({
      type: 'rectRange',
      sheetId: '00000000000000000000000000004037',
      startRowId: '0000000000000000000000000001cdbc',
      startColId: '0000000000000000000000000001ce26',
      endRowId: '0000000000000000000000000001cdde',
      endColId: '0000000000000000000000000001ce38',
      startRowAbsolute: true,
      startColAbsolute: true,
      endRowAbsolute: true,
      endColAbsolute: true,
    });
    expect(identityFormulaToWire(contract)).toEqual(wire);
  });
});
