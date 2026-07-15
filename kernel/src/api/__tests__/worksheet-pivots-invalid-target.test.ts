import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { WorksheetPivotsImpl } from '../worksheet/pivots/index';

const SHEET_ID = sheetId('sheet-1');

function createMissingPivotApi(): WorksheetPivotsImpl {
  return new WorksheetPivotsImpl(
    {
      pivot: {
        getAllPivots: jest.fn().mockResolvedValue([]),
      },
    } as any,
    SHEET_ID,
  );
}

const missingMutationTargetCases: Array<
  [string, (pivots: WorksheetPivotsImpl) => Promise<unknown>]
> = [
  ['remove', (api) => api.remove('MissingPivot')],
  ['rename', (api) => api.rename('MissingPivot', 'RenamedPivot')],
  ['addField', (api) => api.addField('MissingPivot', 'Category', 'row')],
  ['removeField', (api) => api.removeField('MissingPivot', 'Category', 'row')],
  ['moveField', (api) => api.moveField('MissingPivot', 'Category', 'row', 'column', 0)],
  ['setAggregateFunction', (api) => api.setAggregateFunction('MissingPivot', 'Amount', 'sum')],
  [
    'setShowValuesAs',
    (api) => api.setShowValuesAs('MissingPivot', 'Amount', { type: 'percentOfGrandTotal' }),
  ],
  ['setSortOrder', (api) => api.setSortOrder('MissingPivot', 'Category', 'asc')],
  ['setFilter', (api) => api.setFilter('MissingPivot', 'Category', { includeValues: ['Travel'] })],
  ['removeFilter', (api) => api.removeFilter('MissingPivot', 'Category')],
  ['resetField', (api) => api.resetField('MissingPivot', 'Category')],
  ['setLayout', (api) => api.setLayout('MissingPivot', { layoutType: 'tabular' })],
  ['setStyle', (api) => api.setStyle('MissingPivot', { showRowHeaders: true })],
  [
    'setPivotItemVisibility',
    (api) => api.setPivotItemVisibility('MissingPivot', 'Category', { Travel: true }),
  ],
  [
    'setItemVisibility',
    (api) => api.setItemVisibility('MissingPivot', 'Category', { Travel: true }),
  ],
  ['toggleExpanded', (api) => api.toggleExpanded('MissingPivot', 'Category:Travel', true)],
  ['setAllExpanded', (api) => api.setAllExpanded('MissingPivot', true)],
  ['setDataSource', (api) => api.setDataSource('MissingPivot', 'Sheet1!A1:B5')],
  [
    'setAllowMultipleFiltersPerField',
    (api) => api.setAllowMultipleFiltersPerField('MissingPivot', true),
  ],
  ['setAutoFormat', (api) => api.setAutoFormat('MissingPivot', true)],
  ['setPreserveFormatting', (api) => api.setPreserveFormatting('MissingPivot', true)],
  [
    'setEnableMultipleFilterItems',
    (api) => api.setEnableMultipleFilterItems('MissingPivot', 'Category', true),
  ],
  [
    'addCalculatedField',
    (api) =>
      api.addCalculatedField('MissingPivot', {
        fieldId: 'Margin',
        name: 'Margin',
        formula: '=Amount',
      }),
  ],
  ['removeCalculatedField', (api) => api.removeCalculatedField('MissingPivot', 'Margin')],
  [
    'updateCalculatedField',
    (api) => api.updateCalculatedField('MissingPivot', 'Margin', { formula: '=Amount*2' }),
  ],
  ['refresh', (api) => api.refresh('MissingPivot')],
];

describe('WorksheetPivotsImpl invalid mutation targets', () => {
  it.each(missingMutationTargetCases)('%s rejects with PIVOT_NOT_FOUND', async (_name, action) => {
    await expect(action(createMissingPivotApi())).rejects.toMatchObject({
      code: 'PIVOT_NOT_FOUND',
    });
  });
});
