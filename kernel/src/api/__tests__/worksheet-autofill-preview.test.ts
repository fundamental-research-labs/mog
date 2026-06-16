import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import type { WorksheetImpl as WorksheetImplClass } from '../worksheet/worksheet-impl';
import { installWorksheetImplEsmMocks } from './helpers/worksheet-impl-esm-mocks';

installWorksheetImplEsmMocks();

const { WorksheetImpl } = await import('../worksheet/worksheet-impl');
const FillOps = await import('../worksheet/operations/fill-operations');

async function importActualFillOps(): Promise<
  typeof import('../worksheet/operations/fill-operations')
> {
  let realFillOps!: typeof import('../worksheet/operations/fill-operations');
  await jest.isolateModulesAsync(async () => {
    jest.unstable_unmockModule('../worksheet/operations/fill-operations');
    realFillOps = await import('../worksheet/operations/fill-operations');
  });
  return realFillOps;
}

const SHEET_ID = sheetId('sheet-1');

function previewBridgeResult() {
  return {
    patternType: 'copy',
    filledCellCount: 4,
    warnings: [],
    changes: [{ row: 1, col: 0, type: 'formula' }],
    formulas: [
      {
        row: 1,
        col: 0,
        sourceFormula: '=A1+1',
        formula: '=A2+1',
        adjustedRefs: [
          {
            refIndex: 0,
            targetRow: 1,
            targetCol: 0,
            targetEndRow: null,
            targetEndCol: null,
            outOfBounds: false,
          },
        ],
      },
    ],
    referenceDiagnostics: [
      {
        row: 1,
        col: 0,
        refIndex: 0,
        targetRow: 1,
        targetCol: 0,
        targetEndRow: null,
        targetEndCol: null,
        outOfBounds: false,
      },
    ],
  };
}

function previewReceipt() {
  return {
    kind: 'autofill.preview' as const,
    status: 'completed' as const,
    effects: [{ type: 'worksheetUnchanged' as const, sheetId: SHEET_ID, range: 'A2:A5' }],
    diagnostics: [],
    mode: 'copy' as const,
    worksheetChanged: false as const,
    undoChanged: false as const,
    ...previewBridgeResult(),
  };
}

function createWorksheetCtx(): any {
  return {
    writeGate: {
      assertWritable: jest.fn(),
    },
  };
}

function createFillOpsCtx(): any {
  return {
    awaitMaterialized: jest.fn().mockResolvedValue(undefined),
    computeBridge: {
      autoFill: jest.fn().mockResolvedValue(undefined),
      autoFillPreview: jest.fn().mockResolvedValue(previewBridgeResult()),
      beginUndoGroup: jest.fn().mockResolvedValue(undefined),
      endUndoGroup: jest.fn().mockResolvedValue(undefined),
    },
  };
}

describe('WorksheetImpl — autoFillPreview', () => {
  let ws: WorksheetImplClass;
  let ctx: any;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = createWorksheetCtx();
    ws = new WorksheetImpl(SHEET_ID, ctx);
    (FillOps.autoFillPreview as jest.Mock).mockResolvedValue(previewReceipt());
  });

  it('delegates without requiring write access', async () => {
    await ws.autoFillPreview('A1:A3', 'A4:A10', 'copy');

    expect(ctx.writeGate.assertWritable).not.toHaveBeenCalled();
    expect(FillOps.autoFillPreview).toHaveBeenCalledWith(
      expect.anything(),
      SHEET_ID,
      { startRow: 0, startCol: 0, endRow: 2, endCol: 0 },
      { startRow: 3, startCol: 0, endRow: 9, endCol: 0 },
      'copy',
    );
    expect(FillOps.autoFill).not.toHaveBeenCalled();
  });

  it('returns the preview receipt from FillOps', async () => {
    const result = await ws.autoFillPreview('A1', 'A2:A5', 'copy');

    expect(result.worksheetChanged).toBe(false);
    expect(result.undoChanged).toBe(false);
    expect(result.formulas[0]?.formula).toBe('=A2+1');
    expect(result.referenceDiagnostics[0]).toMatchObject({ refIndex: 0, outOfBounds: false });
  });
});

describe('fill-operations — autoFillPreview', () => {
  it('calls the read bridge without an undo group', async () => {
    const realFillOps = await importActualFillOps();
    const ctx = createFillOpsCtx();
    const source = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
    const target = { startRow: 1, startCol: 0, endRow: 4, endCol: 0 };

    const result = await realFillOps.autoFillPreview(ctx, SHEET_ID, source, target, 'copy');

    expect(ctx.computeBridge.autoFillPreview).toHaveBeenCalledTimes(1);
    expect(ctx.computeBridge.autoFillPreview).toHaveBeenCalledWith(SHEET_ID, {
      sourceRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
      targetRange: { startRow: 1, startCol: 0, endRow: 4, endCol: 0 },
      direction: 'down',
      mode: 'copy',
      stepValue: 1,
      includeFormulas: true,
      includeValues: true,
      includeFormats: true,
    });
    expect(ctx.computeBridge.autoFill).not.toHaveBeenCalled();
    expect(ctx.computeBridge.beginUndoGroup).not.toHaveBeenCalled();
    expect(ctx.computeBridge.endUndoGroup).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      kind: 'autofill.preview',
      status: 'completed',
      worksheetChanged: false,
      undoChanged: false,
      patternType: 'copy',
      filledCellCount: 4,
    });
    expect(result.effects).toEqual([
      {
        type: 'worksheetUnchanged',
        sheetId: SHEET_ID,
        range: 'A2:A5',
        details: { dryRun: true, sourceRange: 'A1' },
      },
    ]);
    expect(result.formulas[0]?.formula).toBe('=A2+1');
    expect(result.referenceDiagnostics[0]).toMatchObject({ row: 1, col: 0, refIndex: 0 });
  });
});
