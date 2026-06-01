import { jest } from '@jest/globals';

import { createEditEntryService } from '../../edit-entry-service';

const SHEET_ID = 'sheet-1' as any;

function createClipboardActor(hasCut = false) {
  return {
    getSnapshot: () => ({
      matches: (state: string) => state === 'hasCut' && hasCut,
      context: { data: null, sourceRanges: null },
    }),
  } as any;
}

function createEditorActor() {
  const sent: unknown[] = [];
  const context: any = {
    sheetId: null,
    editingCell: null,
    editorType: 'text',
    cellSchema: null,
    enumItems: null,
    isPickerOpen: false,
    pendingOpenDropdown: false,
  };
  return {
    actor: {
      getSnapshot: () => ({
        matches: (state: string) => state === 'editing' && context.editingCell != null,
        context,
      }),
      send: jest.fn((event: any) => {
        sent.push(event);
        if (event.type === 'START_EDITING') {
          context.sheetId = event.sheetId;
          context.editingCell = event.cell;
          context.pendingOpenDropdown = event.openDropdown ?? false;
        }
        if (event.type === 'SET_EDITOR_TYPE') {
          context.editorType = event.editorType;
          context.cellSchema = event.cellSchema;
          context.enumItems = event.enumItems;
          context.isPickerOpen =
            context.pendingOpenDropdown &&
            ((event.editorType === 'dropdown' && event.enumItems !== null) ||
              event.editorType === 'date');
          context.pendingOpenDropdown = false;
        }
        if (event.type === 'CLEAR_PENDING_PICKER_INTENT') {
          context.pendingOpenDropdown = false;
        }
      }),
    } as any,
    sent,
    context,
  };
}

function createSelectionActor() {
  const sent: unknown[] = [];
  return {
    actor: {
      getSnapshot: () => ({ context: {}, matches: () => false }),
      send: jest.fn((event: unknown) => sent.push(event)),
    } as any,
    sent,
  };
}

function createWorkbook(options?: {
  protected?: boolean;
  editable?: boolean;
  projectionSource?: { row: number; col: number } | null;
  viewportCell?: { editText?: string; hasFormula?: boolean; displayText?: unknown };
  editSource?: string | Promise<string>;
  validationRule?: any;
  validationPeek?: any;
  dropdownItems?: string[] | Promise<string[]>;
}) {
  const canEditCell = jest.fn(async () => options?.editable ?? true);
  const getValueForEditing = jest.fn(async () => options?.editSource ?? '');
  const getProjectionSource = jest.fn(async () =>
    options && 'projectionSource' in options ? options.projectionSource : null,
  );
  const workbook = {
    getSheetById: jest.fn(() => ({
      bindings: {
        getProjectionSource,
      },
      protection: {
        canEditCellFast: jest.fn(() => (options?.protected ? 'unknown' : true)),
        canEditCell,
      },
      getActiveCellEditSource: jest.fn(() => null),
      viewport: {
        getCellData: jest.fn(() => options?.viewportCell ?? null),
      },
      getValueForEditing,
      validations: {
        peek: jest.fn(() =>
          options && 'validationPeek' in options
            ? options.validationPeek
            : (options?.validationRule ?? null),
        ),
        get: jest.fn(async () => options?.validationRule ?? null),
        getDropdownItems: jest.fn(async () => options?.dropdownItems ?? []),
      },
    })),
  } as any;
  return { workbook, canEditCell, getValueForEditing, getProjectionSource };
}

function createService(workbook: any, editorActor: any, selectionActor: any) {
  return createEditEntryService({
    workbook,
    clipboardActor: createClipboardActor(),
    editorActor,
    selectionActor,
    isReadOnly: () => false,
  });
}

describe('createEditEntryService', () => {
  it('uses the unprotected mirror fast path without async canEditCell', async () => {
    const { actor: editorActor, sent: editorEvents } = createEditorActor();
    const { actor: selectionActor } = createSelectionActor();
    const { workbook, canEditCell } = createWorkbook({ viewportCell: { editText: '=A1+B1' } });
    const service = createService(workbook, editorActor, selectionActor);

    const result = await service.beginEditSession({
      sheetId: SHEET_ID,
      cell: { row: 0, col: 2 },
      entryMode: 'F2',
    });

    expect(result.success).toBe(true);
    expect(canEditCell).not.toHaveBeenCalled();
    expect(editorEvents).toContainEqual(
      expect.objectContaining({
        type: 'START_EDITING',
        initialValue: '=A1+B1',
        entryMode: 'F2',
      }),
    );
  });

  it('checks protected cells before reading backend formula source', async () => {
    const { actor: editorActor, sent: editorEvents } = createEditorActor();
    const { actor: selectionActor } = createSelectionActor();
    const { workbook, canEditCell, getValueForEditing } = createWorkbook({
      protected: true,
      editable: false,
      viewportCell: { hasFormula: true },
      editSource: '=A1+B1',
    });
    const service = createService(workbook, editorActor, selectionActor);

    const result = await service.beginEditSession({
      sheetId: SHEET_ID,
      cell: { row: 0, col: 2 },
      entryMode: 'doubleClick',
    });

    expect(result.success).toBe(false);
    expect(canEditCell).toHaveBeenCalledTimes(1);
    expect(getValueForEditing).not.toHaveBeenCalled();
    expect(editorEvents).toHaveLength(0);
  });

  it('blocks projected spill members before reading edit source', async () => {
    const { actor: editorActor, sent: editorEvents } = createEditorActor();
    const { actor: selectionActor, sent: selectionEvents } = createSelectionActor();
    const { workbook, getValueForEditing, getProjectionSource } = createWorkbook({
      projectionSource: { row: 0, col: 2 },
      viewportCell: { hasFormula: true },
      editSource: '=SORT(A1:A5)',
    });
    const service = createService(workbook, editorActor, selectionActor);

    const result = await service.beginEditSession({
      sheetId: SHEET_ID,
      cell: { row: 2, col: 2 },
      entryMode: 'typing',
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('You cannot change part of an array formula.');
    expect(getProjectionSource).toHaveBeenCalledWith(2, 2);
    expect(getValueForEditing).not.toHaveBeenCalled();
    expect(selectionEvents).toHaveLength(0);
    expect(editorEvents).toHaveLength(0);
  });

  it('treats undefined projection source as editable', async () => {
    const { actor: editorActor, sent: editorEvents } = createEditorActor();
    const { actor: selectionActor } = createSelectionActor();
    const { workbook } = createWorkbook({
      projectionSource: undefined,
      viewportCell: { editText: '=A1+B1' },
    });
    const service = createService(workbook, editorActor, selectionActor);

    const result = await service.beginEditSession({
      sheetId: SHEET_ID,
      cell: { row: 0, col: 2 },
      entryMode: 'typing',
    });

    expect(result.success).toBe(true);
    expect(editorEvents).toContainEqual(
      expect.objectContaining({
        type: 'START_EDITING',
        initialValue: '=A1+B1',
      }),
    );
  });

  it('drops stale edit-source completions after a newer edit request', async () => {
    let resolveSource: (value: string) => void = () => {};
    const sourcePromise = new Promise<string>((resolve) => {
      resolveSource = resolve;
    });
    const { actor: editorActor, sent: editorEvents } = createEditorActor();
    const { actor: selectionActor } = createSelectionActor();
    const { workbook } = createWorkbook({
      viewportCell: { hasFormula: true },
      editSource: sourcePromise,
    });
    const service = createService(workbook, editorActor, selectionActor);

    const first = service.beginEditSession({
      sheetId: SHEET_ID,
      cell: { row: 0, col: 2 },
      entryMode: 'doubleClick',
    });
    const second = service.beginEditSession({
      sheetId: SHEET_ID,
      cell: { row: 1, col: 2 },
      entryMode: 'typing',
      initialTextHint: 'x',
    });

    resolveSource('=A1+B1');
    await Promise.all([first, second]);

    expect(editorEvents).toHaveLength(1);
    expect(editorEvents[0]).toEqual(
      expect.objectContaining({
        type: 'START_EDITING',
        cell: { row: 1, col: 2 },
        initialValue: 'x',
      }),
    );
  });

  it('passes pre-edit ranges to the editor before activating edit focus', async () => {
    const { actor: editorActor, sent: editorEvents } = createEditorActor();
    const { actor: selectionActor, sent: selectionEvents } = createSelectionActor();
    const { workbook } = createWorkbook({ viewportCell: { editText: '=A1:A3*B1:B3' } });
    const preEditSelectionRanges = [{ startRow: 0, startCol: 3, endRow: 2, endCol: 3 }];
    const getPreEditSelectionRanges = jest.fn(() => {
      expect(selectionEvents).toHaveLength(0);
      return preEditSelectionRanges;
    });
    const service = createEditEntryService({
      workbook,
      clipboardActor: createClipboardActor(),
      editorActor,
      selectionActor,
      isReadOnly: () => false,
      getPreEditSelectionRanges,
    });

    const result = await service.beginEditSession({
      sheetId: SHEET_ID,
      cell: { row: 0, col: 3 },
      entryMode: 'typing',
    });

    expect(result.success).toBe(true);
    expect(getPreEditSelectionRanges).toHaveBeenCalledTimes(1);
    expect(selectionEvents[0]).toEqual({
      type: 'BEGIN_CELL_EDIT',
      cell: { row: 0, col: 3 },
    });
    expect(editorEvents[0]).toEqual(
      expect.objectContaining({
        type: 'START_EDITING',
        preEditSelectionRanges,
      }),
    );
  });

  it('configures warm inline list validation as a dropdown and opens pending picker intent', async () => {
    const { actor: editorActor, sent: editorEvents, context } = createEditorActor();
    const { actor: selectionActor } = createSelectionActor();
    const { workbook } = createWorkbook({
      viewportCell: { editText: '' },
      validationRule: {
        type: 'list',
        values: ['Red', 'Green', 'Blue'],
        showDropdown: true,
        allowBlank: true,
      },
    });
    const service = createService(workbook, editorActor, selectionActor);

    const result = await service.beginEditSession({
      sheetId: SHEET_ID,
      cell: { row: 0, col: 1 },
      entryMode: 'typing',
      initialTextHint: '',
      openDropdown: true,
    });

    expect(result.success).toBe(true);
    expect(editorEvents).toContainEqual(
      expect.objectContaining({
        type: 'SET_EDITOR_TYPE',
        editorType: 'dropdown',
        enumItems: ['Red', 'Green', 'Blue'],
      }),
    );
    expect(context.isPickerOpen).toBe(true);
    expect(context.pendingOpenDropdown).toBe(false);
  });

  it('keeps showDropdown false list validation as text and consumes pending picker intent', async () => {
    const { actor: editorActor, sent: editorEvents, context } = createEditorActor();
    const { actor: selectionActor } = createSelectionActor();
    const { workbook } = createWorkbook({
      viewportCell: { editText: '' },
      validationRule: {
        type: 'list',
        values: ['Red', 'Green'],
        showDropdown: false,
        allowBlank: true,
      },
    });
    const service = createService(workbook, editorActor, selectionActor);

    await service.beginEditSession({
      sheetId: SHEET_ID,
      cell: { row: 0, col: 1 },
      entryMode: 'typing',
      initialTextHint: '',
      openDropdown: true,
    });

    expect(editorEvents).toContainEqual(
      expect.objectContaining({
        type: 'SET_EDITOR_TYPE',
        editorType: 'text',
        enumItems: null,
      }),
    );
    expect(context.isPickerOpen).toBe(false);
    expect(context.pendingOpenDropdown).toBe(false);
  });

  it('does not block edit entry on cold range-backed dropdown hydration', async () => {
    let resolveItems: (items: string[]) => void = () => {};
    const itemsPromise = new Promise<string[]>((resolve) => {
      resolveItems = resolve;
    });
    const { actor: editorActor, sent: editorEvents, context } = createEditorActor();
    const { actor: selectionActor } = createSelectionActor();
    const { workbook } = createWorkbook({
      viewportCell: { editText: '' },
      validationPeek: undefined,
      validationRule: {
        type: 'list',
        listSource: '=A1:A2',
        showDropdown: true,
        allowBlank: true,
      },
      dropdownItems: itemsPromise,
    });
    const service = createService(workbook, editorActor, selectionActor);

    const result = await service.beginEditSession({
      sheetId: SHEET_ID,
      cell: { row: 0, col: 1 },
      entryMode: 'typing',
      initialTextHint: '',
      openDropdown: true,
    });

    expect(result.success).toBe(true);
    expect(editorEvents[0]).toEqual(expect.objectContaining({ type: 'START_EDITING' }));
    expect(context.pendingOpenDropdown).toBe(true);
    expect(editorEvents.some((event: any) => event.type === 'SET_EDITOR_TYPE')).toBe(false);

    resolveItems(['Red', 'Green']);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(editorEvents).toContainEqual(
      expect.objectContaining({
        type: 'SET_EDITOR_TYPE',
        editorType: 'dropdown',
        enumItems: ['Red', 'Green'],
      }),
    );
    expect(context.isPickerOpen).toBe(true);
  });
});
