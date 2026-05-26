import { jest } from '@jest/globals';

import { FormulaMetadataCache, createFormulaNameCompletionStore } from '../formula-metadata-cache';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeWorkbook() {
  const handlers = new Map<string, Set<() => void>>();
  const sheet = {
    getSheetId: jest.fn(() => 'sheet-1'),
    tables: {
      list: jest.fn(async () => [
        {
          id: 'table-id',
          name: 'Sales',
          displayName: 'Sales',
          sheetId: 'sheet-1',
          range: 'A1:B3',
          columns: [{ id: 'col-1', name: 'Revenue', index: 0 }],
          hasHeaderRow: true,
          hasTotalsRow: false,
          style: 'TableStyleMedium2',
          bandedRows: true,
          bandedColumns: false,
          emphasizeFirstColumn: false,
          emphasizeLastColumn: false,
          showFilterButtons: true,
        },
      ]),
    },
  };

  const wb = {
    names: {
      list: jest.fn(async () => [
        {
          name: 'LocalRevenue',
          reference: 'Sheet1!$A$1',
          scope: 'Sheet1',
        },
      ]),
    },
    getSheetNames: jest.fn(async () => ['Sheet1']),
    getSheet: jest.fn(async () => sheet),
    getSheetById: jest.fn(() => sheet),
    on: jest.fn((event: string, handler: () => void) => {
      let eventHandlers = handlers.get(event);
      if (!eventHandlers) {
        eventHandlers = new Set();
        handlers.set(event, eventHandlers);
      }
      eventHandlers.add(handler);
      return () => eventHandlers?.delete(handler);
    }),
    emit: (event: string) => {
      for (const handler of handlers.get(event) ?? []) {
        handler();
      }
    },
  };

  return { wb, sheet };
}

describe('FormulaMetadataCache', () => {
  it('shares one in-flight metadata load across duplicate consumers', async () => {
    const { wb, sheet } = makeWorkbook();
    const namesLoad = deferred<Array<{ name: string; reference: string }>>();
    wb.names.list.mockReturnValueOnce(namesLoad.promise);
    const cache = new FormulaMetadataCache(wb);

    const subscriberA = jest.fn();
    const subscriberB = jest.fn();
    cache.subscribe(subscriberA);
    cache.subscribe(subscriberB);

    const first = cache.request();
    const second = cache.request();

    expect(first).toBe(second);
    expect(wb.names.list).toHaveBeenCalledTimes(1);
    expect(wb.getSheetNames).toHaveBeenCalledTimes(1);
    expect(cache.getSnapshot().status).toBe('loading');

    namesLoad.resolve([{ name: 'Revenue', reference: 'Sheet1!$A$1' }]);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBe(secondResult);
    expect(sheet.tables.list).toHaveBeenCalledTimes(1);
    expect(cache.getSnapshot().status).toBe('ready');
    expect(cache.getSnapshot().metadata?.namedRanges).toHaveLength(1);
    expect(subscriberA).toHaveBeenCalled();
    expect(subscriberB).toHaveBeenCalled();
  });

  it('invalidates on workbook metadata events and reloads on the next request', async () => {
    const { wb } = makeWorkbook();
    const cache = new FormulaMetadataCache(wb);

    await cache.request();
    expect(wb.names.list).toHaveBeenCalledTimes(1);

    wb.emit('name:created');

    expect(cache.getSnapshot().status).toBe('idle');
    expect(cache.getSnapshot().metadata).toBeNull();

    await cache.request();
    expect(wb.names.list).toHaveBeenCalledTimes(2);
  });

  it('normalizes sheet-scoped names to sheet ids for name completion', async () => {
    const { wb } = makeWorkbook();
    const cache = new FormulaMetadataCache(wb);

    const metadata = await cache.request();
    const store = createFormulaNameCompletionStore(metadata);

    expect(store.getDefinedNames().LocalRevenue).toEqual({
      refersTo: 'Sheet1!$A$1',
      scope: 'sheet-1',
      comment: undefined,
    });
  });
});
