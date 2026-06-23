import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import type { RangeSchema } from '../../../bridges/compute/compute-bridge';
import { createEventBus } from '../../../context/event-bus';
import type { DocumentContext } from '../../../context/types';
import { createHandleLiveness } from '../../lifecycle/handle-liveness';
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
    clock: {
      now: jest.fn(() => 1_700_000_000_000),
    },
    workbookLinkScope: jest.fn(() => ({
      actor: 'test-user',
      requestingDocumentId: 'doc-1',
      requestingSessionId: 'session-1',
    })),
    writeGate: {
      assertWritable: jest.fn(),
    },
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
      queryRange: jest.fn(async () => ({
        cells: [],
        merges: [],
      })),
      validateCellValueInDoc: jest.fn(async () => ({
        valid: true,
        enforcement: 'none',
      })),
    },
  } as unknown as TestDocumentContext;
}

function expectValidationAdmissionOptions(
  value: unknown,
  operationPrefix: string,
  groupId?: string,
): void {
  expect(value).toEqual({
    operationContext: expect.objectContaining({
      operationId: expect.stringMatching(new RegExp(`^${operationPrefix}:`)),
      kind: 'mutation',
      author: {
        authorId: 'test-user',
        actorKind: 'user',
        sessionId: 'session-1',
      },
      createdAt: '2023-11-14T22:13:20.000Z',
      workbookId: 'doc-1',
      sheetIds: [SHEET_ID],
      domainIds: ['data-validation'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
      ...(groupId ? { groupId } : {}),
    }),
  });
}

describe('WorksheetValidationImpl sheet cache', () => {
  it('rejects stale validation reads and writes after the worksheet liveness is invalidated', async () => {
    const ctx = createCtx([makeSchema()]);
    const liveness = createHandleLiveness({
      label: 'Worksheet',
      metadata: { label: 'Worksheet', sheetId: String(SHEET_ID) },
    });
    const validations = new WorksheetValidationImpl(ctx, SHEET_ID, liveness);

    expect(await validations.list()).toHaveLength(1);
    expect(validations.peek(0, 0)?.type).toBe('list');

    liveness.invalidate({
      operation: 'workbook.dispose',
      message: 'Workbook is closed or disposed. Create a new workbook to continue.',
    });

    await expect(validations.list()).rejects.toThrow(/disposed|closed/i);
    await expect(validations.get(0, 0)).rejects.toThrow(/disposed|closed/i);
    expect(() => validations.peek(0, 0)).toThrow(/disposed|closed/i);
    await expect(
      validations.set('A1', {
        type: 'textLength',
        operator: 'greaterThan',
        formula1: '0',
        errorStyle: 'stop',
      }),
    ).rejects.toThrow(/disposed|closed/i);
  });

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

    const receipt = await validations.remove(0, 0);
    await validations.get(0, 0);

    expect(receipt).toMatchObject({
      kind: 'validationRemove',
      status: 'applied',
      address: 'R0C0',
      removed: {
        ids: ['old'],
        ranges: ['A1:A1'],
        count: 1,
      },
      effects: [
        {
          type: 'changedValidation',
          sheetId: SHEET_ID,
          range: 'A1:A1',
          count: 1,
        },
        {
          type: 'changedRange',
          sheetId: SHEET_ID,
          range: 'A1:A1',
        },
      ],
      diagnostics: [],
    });
    expect(ctx.computeBridge.deleteRangeSchema).toHaveBeenCalledWith(
      SHEET_ID,
      'old',
      expect.any(Object),
    );
    expectValidationAdmissionOptions(
      (ctx.computeBridge.deleteRangeSchema as jest.Mock).mock.calls[0]?.[2],
      'validation.remove',
    );
    expect(ctx.computeBridge.getRangeSchemasForSheet).toHaveBeenCalledTimes(2);
    expect(validations.peek(0, 0)).toBeNull();
  });

  it('removes every schema covering a cell', async () => {
    const ctx = createCtx([
      makeSchema({ id: 'first', ranges: [{ startId: '0:0', endId: '1:1' }] }),
      makeSchema({ id: 'second', ranges: [{ startId: '0:0', endId: '0:0' }] }),
    ]);
    const validations = new WorksheetValidationImpl(ctx, SHEET_ID);

    const receipt = await validations.remove(0, 0);

    expect(ctx.computeBridge.deleteRangeSchema).toHaveBeenCalledWith(
      SHEET_ID,
      'first',
      expect.any(Object),
    );
    expect(ctx.computeBridge.deleteRangeSchema).toHaveBeenCalledWith(
      SHEET_ID,
      'second',
      expect.any(Object),
    );
    const deleteCalls = (ctx.computeBridge.deleteRangeSchema as jest.Mock).mock.calls;
    expectValidationAdmissionOptions(
      deleteCalls[0]?.[2],
      'validation.remove',
      'validation.remove:1700000000000',
    );
    expectValidationAdmissionOptions(
      deleteCalls[1]?.[2],
      'validation.remove',
      'validation.remove:1700000000000',
    );
    expect(receipt.removed).toEqual({
      address: 'R0C0',
      ids: ['first', 'second'],
      ranges: ['A1:B2', 'A1:A1'],
      count: 2,
    });
  });

  it('returns a no-op clear receipt when no validation overlaps the range', async () => {
    const ctx = createCtx();
    const validations = new WorksheetValidationImpl(ctx, SHEET_ID);

    await expect(validations.clearInRange('C3:D4')).resolves.toMatchObject({
      kind: 'validationClear',
      status: 'noOp',
      address: 'C3:D4',
      removed: {
        ids: [],
        ranges: [],
        count: 0,
      },
      effects: [{ type: 'worksheetUnchanged', sheetId: SHEET_ID, range: 'C3:D4' }],
      diagnostics: [],
    });
  });

  it('removeById returns the removed validation ID and affected range', async () => {
    const ctx = createCtx([
      makeSchema({ id: 'target-rule', ranges: [{ startId: '2:2', endId: '4:2' }] }),
    ]);
    const validations = new WorksheetValidationImpl(ctx, SHEET_ID);

    await expect(validations.removeById('target-rule')).resolves.toMatchObject({
      kind: 'validationRemove',
      status: 'applied',
      address: 'target-rule',
      removed: {
        address: 'target-rule',
        ids: ['target-rule'],
        ranges: ['C3:C5'],
        count: 1,
      },
      effects: [
        {
          type: 'changedValidation',
          sheetId: SHEET_ID,
          range: 'C3:C5',
          count: 1,
        },
        {
          type: 'changedRange',
          sheetId: SHEET_ID,
          range: 'C3:C5',
        },
      ],
      diagnostics: [],
    });
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

describe('WorksheetValidationImpl list validation', () => {
  function makeRangeBackedListSchema(overrides: Partial<RangeSchema> = {}): RangeSchema {
    return makeSchema({
      id: 'list-range',
      ranges: [{ startId: '4:4', endId: '4:4' }],
      schema: {
        constraints: {
          enumSource: { startId: '0:0', endId: '1:0' },
          allowBlank: false,
        },
      },
      enforcement: 'strict',
      ui: {
        errorMessage: {
          title: 'Choose from list',
          message: 'Use one of the allowed values.',
        },
      },
      ...overrides,
    });
  }

  function createRangeListCtx(schema: RangeSchema = makeRangeBackedListSchema()) {
    const ctx = createCtx([schema]);
    (ctx.computeBridge.queryRange as jest.Mock).mockResolvedValue({
      cells: [
        { row: 0, col: 0, value: { type: 'Text', value: 'Alpha' }, formatted: 'Alpha' },
        { row: 1, col: 0, value: { type: 'Text', value: 'Beta' }, formatted: 'Beta' },
      ],
      merges: [],
    });
    return ctx;
  }

  it('rejects values outside a resolved range-backed list and preserves alert metadata', async () => {
    const ctx = createRangeListCtx();
    const validations = new WorksheetValidationImpl(ctx, SHEET_ID);

    await expect(validations.validate(4, 4, 'BAD')).resolves.toEqual({
      valid: false,
      errorStyle: 'stop',
      errorTitle: 'Choose from list',
      errorMessage: 'Use one of the allowed values.',
    });
    expect(ctx.computeBridge.validateCellValueInDoc).not.toHaveBeenCalled();
  });

  it('setList creates an inline list validation with UI metadata', async () => {
    const ctx = createCtx();
    const validations = new WorksheetValidationImpl(ctx, SHEET_ID);

    const receipt = await validations.setList('B2:B4', ['Red', 'Blue'], {
      allowBlank: false,
      errorTitle: 'Choose from list',
      errorMessage: 'Use one of the allowed values.',
    });

    expect(receipt).toMatchObject({
      kind: 'validationSet',
      status: 'applied',
      address: 'B2:B4',
      validation: {
        address: 'B2:B4',
        ranges: ['B2:B4'],
      },
      effects: [
        {
          type: 'changedValidation',
          sheetId: SHEET_ID,
          range: 'B2:B4',
        },
        {
          type: 'changedRange',
          sheetId: SHEET_ID,
          range: 'B2:B4',
          count: 3,
        },
      ],
      diagnostics: [],
    });
    expect(receipt.validation.id).toEqual(expect.stringMatching(/^rs-/));
    expectValidationAdmissionOptions(
      (ctx.computeBridge.setRangeSchema as jest.Mock).mock.calls[0]?.[2],
      'validation.set',
    );

    const schema = Array.from(ctx.__schemas.values())[0];
    expect(schema.ranges).toEqual([{ startId: '1:1', endId: '3:1' }]);
    expect(schema.schema).toEqual({
      type: undefined,
      constraints: {
        enum: ['Red', 'Blue'],
        allowBlank: false,
      },
    });
    expect(schema.ui).toEqual({
      showDropdown: true,
      errorMessage: {
        title: 'Choose from list',
        message: 'Use one of the allowed values.',
      },
    });
  });

  it('setList accepts CellRange list sources without callers building schema fields', async () => {
    const ctx = createCtx();
    const validations = new WorksheetValidationImpl(ctx, SHEET_ID);

    await validations.setList(
      { startRow: 4, startCol: 1, endRow: 6, endCol: 1 },
      { startRow: 0, startCol: 3, endRow: 2, endCol: 3 },
    );

    const schema = Array.from(ctx.__schemas.values())[0];
    expect(schema.ranges).toEqual([{ startId: '4:1', endId: '6:1' }]);
    expect(schema.schema.constraints).toMatchObject({
      enumSource: { startId: '0:3', endId: '2:3' },
    });
  });

  it('setList returns schema-aware diagnostics for empty sources', async () => {
    const ctx = createCtx();
    const validations = new WorksheetValidationImpl(ctx, SHEET_ID);

    await expect(validations.setList('A1', [])).rejects.toMatchObject({
      code: 'API_INVALID_ARGUMENT',
      path: ['source'],
      suggestion: expect.stringContaining('["Red", "Blue"]'),
      context: expect.objectContaining({
        issueCode: 'VALIDATION_LIST_SOURCE_EMPTY',
        expected: expect.stringContaining('non-empty'),
      }),
    });
    expect(ctx.computeBridge.setRangeSchema).not.toHaveBeenCalled();
  });

  it('accepts resolved range-backed list values case-insensitively', async () => {
    const ctx = createRangeListCtx();
    const validations = new WorksheetValidationImpl(ctx, SHEET_ID);

    await expect(validations.validate(4, 4, 'Alpha')).resolves.toMatchObject({
      valid: true,
      errorStyle: 'stop',
    });
    await expect(validations.validate(4, 4, 'alpha')).resolves.toMatchObject({
      valid: true,
      errorStyle: 'stop',
    });
    expect(ctx.computeBridge.validateCellValueInDoc).not.toHaveBeenCalled();
  });

  it('honors allowBlank for resolved list validation', async () => {
    const allowBlankCtx = createRangeListCtx(
      makeRangeBackedListSchema({
        id: 'blank-allowed',
        schema: {
          constraints: {
            enumSource: { startId: '0:0', endId: '1:0' },
            allowBlank: true,
          },
        },
      }),
    );
    const rejectBlankCtx = createRangeListCtx();

    await expect(
      new WorksheetValidationImpl(allowBlankCtx, SHEET_ID).validate(4, 4, ''),
    ).resolves.toMatchObject({
      valid: true,
      errorStyle: 'stop',
    });
    await expect(
      new WorksheetValidationImpl(rejectBlankCtx, SHEET_ID).validate(4, 4, ''),
    ).resolves.toMatchObject({
      valid: false,
      errorStyle: 'stop',
    });
  });

  it('falls back to document validation when no rule covers the cell', async () => {
    const ctx = createCtx();
    const validations = new WorksheetValidationImpl(ctx, SHEET_ID);

    await expect(validations.validate(9, 9, 'anything')).resolves.toEqual({
      valid: true,
      errorMessage: undefined,
      errorTitle: undefined,
      errorStyle: 'none',
    });
    expect(ctx.computeBridge.validateCellValueInDoc).toHaveBeenCalledWith(
      SHEET_ID,
      9,
      9,
      'anything',
    );
  });

  it('falls back to document validation for unresolved formula list sources', async () => {
    const ctx = createCtx([
      makeRangeBackedListSchema({
        id: 'formula-list',
        schema: {
          constraints: {
            enumSourceFormula: 'NamedRange',
            allowBlank: false,
          },
        },
      }),
    ]);
    const validations = new WorksheetValidationImpl(ctx, SHEET_ID);

    await expect(validations.validate(4, 4, 'BAD')).resolves.toEqual({
      valid: true,
      errorMessage: undefined,
      errorTitle: undefined,
      errorStyle: 'none',
    });
    expect(ctx.computeBridge.validateCellValueInDoc).toHaveBeenCalledWith(SHEET_ID, 4, 4, 'BAD');
  });
});
