import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import type { RangeSchema } from '../../../bridges/compute/compute-bridge';
import { createEventBus } from '../../../context/event-bus';
import type { DocumentContext } from '../../../context/types';
import { WorksheetValidationImpl } from '../validation';
import { disposeWorksheetValidationCache, getWorksheetValidationCache } from '../validation-cache';

const SHEET_ID = sheetId('sheet-1');

function makeSchema(overrides: Partial<RangeSchema> = {}): RangeSchema {
  return {
    id: 'rs-1',
    createdAt: 1,
    ranges: [{ startId: '0:0', endId: '0:0' }],
    schema: { constraints: { enum: ['Red', 'Blue'] } },
    enforcement: 'strict',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type TestDocumentContext = DocumentContext & {
  __schemas: Map<string, RangeSchema>;
  __emitUndo: (trigger: 'push' | 'undo' | 'redo' | 'clear' | 'external') => void;
};

function createCtx(initialSchemas: RangeSchema[] = []): TestDocumentContext {
  const schemas = new Map(initialSchemas.map((schema) => [schema.id, schema]));
  const undoListeners = new Set<
    (event: { trigger: 'push' | 'undo' | 'redo' | 'clear' | 'external' }) => void
  >();
  return {
    __schemas: schemas,
    __emitUndo: (trigger) => {
      for (const listener of undoListeners) listener({ trigger });
    },
    eventBus: createEventBus(),
    services: {
      undo: {
        subscribe: jest.fn((listener) => {
          undoListeners.add(listener);
          listener({ trigger: 'external' });
          return Object.assign(() => undoListeners.delete(listener), {
            dispose: () => undoListeners.delete(listener),
          });
        }),
      },
    },
    computeBridge: {
      getRangeSchemasForSheet: jest.fn(async () => Array.from(schemas.values())),
      setRangeSchema: jest.fn(async (_sheetId: string, schema: RangeSchema) => {
        schemas.set(schema.id, schema);
        return { success: true };
      }),
      deleteRangeSchema: jest.fn(async (_sheetId: string, schemaId: string) => {
        schemas.delete(schemaId);
        return { success: true };
      }),
    },
  } as unknown as TestDocumentContext;
}

describe('WorksheetValidationImpl sheet cache', () => {
  it('hydrates a sheet-scoped cache once and supports warm synchronous peek', async () => {
    const ctx = createCtx([makeSchema()]);
    const validations = new WorksheetValidationImpl(ctx, SHEET_ID);

    expect(validations.peek(0, 0)).toBeUndefined();

    const first = await validations.get(0, 0);
    const second = await validations.get(0, 0);

    expect(first?.type).toBe('list');
    expect(second?.type).toBe('list');
    expect(validations.peek(0, 0)?.type).toBe('list');
    expect(ctx.computeBridge.getRangeSchemasForSheet).toHaveBeenCalledTimes(1);
  });

  it('invalidates the sheet cache through validation mutations', async () => {
    const ctx = createCtx([makeSchema({ id: 'old' })]);
    const validations = new WorksheetValidationImpl(ctx, SHEET_ID);

    await validations.get(0, 0);
    expect(ctx.computeBridge.getRangeSchemasForSheet).toHaveBeenCalledTimes(1);

    await validations.remove(0, 0);
    await validations.get(0, 0);

    expect(ctx.computeBridge.deleteRangeSchema).toHaveBeenCalledWith(SHEET_ID, 'old');
    expect(ctx.computeBridge.getRangeSchemasForSheet).toHaveBeenCalledTimes(2);
    expect(validations.peek(0, 0)).toBeNull();
  });

  it('removes every schema covering a cell', async () => {
    const ctx = createCtx([
      makeSchema({ id: 'first', ranges: [{ startId: '0:0', endId: '1:1' }] }),
      makeSchema({ id: 'second', ranges: [{ startId: '0:0', endId: '0:0' }] }),
    ]);
    const validations = new WorksheetValidationImpl(ctx, SHEET_ID);

    await validations.remove(0, 0);

    expect(ctx.computeBridge.deleteRangeSchema).toHaveBeenCalledWith(SHEET_ID, 'first');
    expect(ctx.computeBridge.deleteRangeSchema).toHaveBeenCalledWith(SHEET_ID, 'second');
  });

  it('does not let stale hydration survive an import/load invalidation', async () => {
    const ctx = createCtx();
    const firstHydration = deferred<RangeSchema[]>();
    const importedSchema = makeSchema({ id: 'imported' });
    (ctx.computeBridge.getRangeSchemasForSheet as jest.Mock)
      .mockImplementationOnce(() => firstHydration.promise)
      .mockImplementationOnce(async () => [importedSchema]);

    const validations = new WorksheetValidationImpl(ctx, SHEET_ID);
    const staleRead = validations.get(0, 0);

    ctx.eventBus.emit({
      type: 'import:complete',
      timestamp: Date.now(),
      success: true,
      sheetCount: 1,
      cellCount: 1,
      durationMs: 1,
    });
    firstHydration.resolve([makeSchema({ id: 'stale' })]);
    await staleRead;

    expect(validations.peek(0, 0)).toBeUndefined();

    const afterImport = await validations.get(0, 0);

    expect(afterImport?.id).toBe('imported');
    expect(ctx.computeBridge.getRangeSchemasForSheet).toHaveBeenCalledTimes(2);
  });

  it('invalidates stale sheet data when a sheet is removed', async () => {
    const ctx = createCtx([makeSchema({ id: 'deleted-sheet-rule' })]);
    const validations = new WorksheetValidationImpl(ctx, SHEET_ID);

    expect(await validations.get(0, 0)).not.toBeNull();
    ctx.__schemas.clear();
    ctx.eventBus.emit({
      type: 'sheet:deleted',
      timestamp: Date.now(),
      sheetId: SHEET_ID,
      name: 'Sheet1',
      source: 'user',
    });

    expect(validations.peek(0, 0)).toBeUndefined();
    expect(await validations.get(0, 0)).toBeNull();
    expect(ctx.computeBridge.getRangeSchemasForSheet).toHaveBeenCalledTimes(2);
  });

  it('invalidates cached schemas after undo service mutations', async () => {
    const ctx = createCtx([makeSchema({ id: 'undo-created' })]);
    const validations = new WorksheetValidationImpl(ctx, SHEET_ID);

    expect(await validations.get(0, 0)).not.toBeNull();
    expect(ctx.computeBridge.getRangeSchemasForSheet).toHaveBeenCalledTimes(1);

    ctx.__schemas.clear();
    ctx.__emitUndo('undo');

    expect(validations.peek(0, 0)).toBeUndefined();
    expect(await validations.get(0, 0)).toBeNull();
    expect(ctx.computeBridge.getRangeSchemasForSheet).toHaveBeenCalledTimes(2);
  });

  it('does not cache async hydration results after disposal', async () => {
    const ctx = createCtx();
    const hydration = deferred<RangeSchema[]>();
    (ctx.computeBridge.getRangeSchemasForSheet as jest.Mock)
      .mockImplementationOnce(() => hydration.promise)
      .mockResolvedValueOnce([]);

    const cache = getWorksheetValidationCache(ctx);
    const read = cache.getSchemaForCell(SHEET_ID, 0, 0);
    disposeWorksheetValidationCache(ctx);
    hydration.resolve([makeSchema({ id: 'disposed-stale' })]);

    await expect(read).resolves.not.toBeNull();

    const newCache = getWorksheetValidationCache(ctx);
    expect(newCache.peekSchemaForCell(SHEET_ID, 0, 0)).toBeUndefined();
    await expect(newCache.getSchemaForCell(SHEET_ID, 0, 0)).resolves.toBeNull();
    expect(ctx.computeBridge.getRangeSchemasForSheet).toHaveBeenCalledTimes(2);
  });
});
