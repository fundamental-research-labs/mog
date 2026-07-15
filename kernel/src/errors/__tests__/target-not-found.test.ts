import { targetNotFoundError } from '../target-not-found';

describe('targetNotFoundError', () => {
  it('builds a typed resource error with stable target context', () => {
    const error = targetNotFoundError({
      code: 'FILTER_NOT_FOUND',
      resourceType: 'filter',
      resourceId: 'filter-7',
      operation: 'filters.apply',
      sheetId: 'sheet-1',
      path: ['filterId'],
    });

    expect(error).toMatchObject({
      code: 'FILTER_NOT_FOUND',
      message: 'filter "filter-7" not found',
      path: ['filterId'],
      context: {
        resourceType: 'filter',
        resourceId: 'filter-7',
        operation: 'filters.apply',
        sheetId: 'sheet-1',
      },
    });
  });
});
