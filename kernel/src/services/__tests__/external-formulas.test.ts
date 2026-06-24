import { jest } from '@jest/globals';
import type { SheetId } from '@mog-sdk/contracts/core';

import type { MutationAdmissionOptions } from '../../bridges/compute';
import type { DocumentContext } from '../../context/types';
import {
  applyExternalFormulaReadbacks,
  getExternalFormulaReferences,
  getTrackedExternalFormula,
  installExternalFormulaReadbacks,
  localReferenceForExternalRef,
  maskExternalFormulaRefsForValidation,
  materializeExternalFormulas,
  prepareExternalFormulaWrite,
} from '../external-formulas';
import { registerExternalWorkbookSession } from '../workbook-links/session-registry';
import {
  createWorkbookLinkService,
  type WorkbookLinkResolver,
  type WorkbookLinkStatusScope,
} from '../workbook-links';

function scope(): WorkbookLinkStatusScope {
  return {
    requestingDocumentId: 'target-doc',
    requestingSessionId: 'target-session',
    actor: 'agent',
    principal: { tags: [] },
  };
}

function mutationOptions(): MutationAdmissionOptions {
  return {
    operationContext: {
      operationId: 'workbook.calculate.externalFormulas:1:1',
      kind: 'mutation',
      author: { authorId: 'agent', actorKind: 'user' },
      createdAt: '2026-05-29T00:00:00.000Z',
      workbookId: 'target-doc',
      sheetIds: ['sheet-1'],
      domainIds: ['cells'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    },
  };
}

function createContext(
  sourceValues: Record<string, Record<string, unknown>>,
  options: {
    readonly resolver?: WorkbookLinkResolver;
    readonly computeBridge?: Record<string, unknown>;
  } = {},
): DocumentContext {
  const workbookLinks = createWorkbookLinkService({
    resolver: options.resolver ?? {
      resolve: (request) => ({
        linkId: request.linkId,
        status: 'ready',
        sourceSessionId: 'source-session',
        sourceWorkbookId: request.expectedWorkbookId ?? undefined,
        sourceVersion: 'v1',
        authorization: 'read',
      }),
    },
    now: () => '2026-05-29T00:00:00.000Z',
  });
  workbookLinks.create({
    linkId: 'link-budget',
    expectedWorkbookId: 'source-workbook',
    target: { kind: 'open-session', sessionId: 'source-session' },
    displayName: 'Budget.xlsx',
    sourceKind: 'mog-workbook',
  });

  const computeBridge = options.computeBridge ?? {
    setCellsByPosition: jest.fn(async () => ({ success: true })),
  };

  return {
    workbookLinks,
    workbookLinkScope: scope,
    computeBridge,
  } as unknown as DocumentContext;
}

describe('external formula materialization', () => {
  let unregister: (() => void) | undefined;

  afterEach(() => {
    unregister?.();
    unregister = undefined;
  });

  it('materializes external single-cell writes before they reach compute', async () => {
    const sourceValues = { Inputs: { A1: 125 } };
    unregister = registerExternalWorkbookSession('source-session', {
      workbook: {
        async getSheet(name: string) {
          return {
            async getValue(address: string) {
              return sourceValues[name]?.[address] ?? null;
            },
          };
        },
      },
    });
    const ctx = createContext(sourceValues);

    await expect(
      prepareExternalFormulaWrite(ctx, 'sheet-1' as SheetId, 0, 0, '=[Budget.xlsx]Inputs!A1'),
    ).resolves.toBe('=125');
  });

  it('retains the original external formula for later recalculation', async () => {
    const sourceValues = { Inputs: { A1: 125 } };
    unregister = registerExternalWorkbookSession('source-session', {
      workbook: {
        async getSheet(name: string) {
          return {
            async getValue(address: string) {
              return sourceValues[name]?.[address] ?? null;
            },
          };
        },
      },
    });
    const ctx = createContext(sourceValues);
    const sheetId = 'sheet-1' as SheetId;

    await prepareExternalFormulaWrite(ctx, sheetId, 0, 0, '=[Budget.xlsx]Inputs!A1');
    sourceValues.Inputs.A1 = 200;
    await expect(materializeExternalFormulas(ctx)).resolves.toBe(1);

    expect(ctx.computeBridge.setCellsByPosition).toHaveBeenCalledWith(sheetId, [
      { row: 0, col: 0, input: { kind: 'parse', text: '=200' } },
    ]);
  });

  it('forwards admission options while batching materialized writes by sheet', async () => {
    const sourceValues = { Inputs: { A1: 125, A2: 25 } };
    unregister = registerExternalWorkbookSession('source-session', {
      workbook: {
        async getSheet(name: string) {
          return {
            async getValue(address: string) {
              return sourceValues[name]?.[address] ?? null;
            },
          };
        },
      },
    });
    const ctx = createContext(sourceValues);
    const sheetId = 'sheet-1' as SheetId;
    const options = mutationOptions();

    await prepareExternalFormulaWrite(ctx, sheetId, 0, 0, '=[Budget.xlsx]Inputs!A1');
    await prepareExternalFormulaWrite(ctx, sheetId, 1, 0, '=[Budget.xlsx]Inputs!A2');
    await expect(materializeExternalFormulas(ctx, options)).resolves.toBe(2);

    expect(ctx.computeBridge.setCellsByPosition).toHaveBeenCalledTimes(1);
    expect(ctx.computeBridge.setCellsByPosition).toHaveBeenCalledWith(
      sheetId,
      [
        { row: 0, col: 0, input: { kind: 'parse', text: '=125' } },
        { row: 1, col: 0, input: { kind: 'parse', text: '=25' } },
      ],
      options,
    );
  });

  it('overlays tracked external formulas on range readbacks', async () => {
    const sourceValues = { Inputs: { A1: 125 } };
    unregister = registerExternalWorkbookSession('source-session', {
      workbook: {
        async getSheet(name: string) {
          return {
            async getValue(address: string) {
              return sourceValues[name]?.[address] ?? null;
            },
          };
        },
      },
    });
    const ctx = createContext(sourceValues);
    const sheetId = 'sheet-1' as SheetId;

    await prepareExternalFormulaWrite(ctx, sheetId, 0, 0, '=[Budget.xlsx]Inputs!A1');

    expect(getTrackedExternalFormula(ctx, sheetId, 0, 0)).toBe('=[Budget.xlsx]Inputs!A1');
    expect(
      applyExternalFormulaReadbacks(ctx, sheetId, {
        cells: [{ row: 0, col: 0, cellId: 'cell-1', value: 125, formula: '=125' }],
        merges: [],
      }).cells[0]?.formula,
    ).toBe('=[Budget.xlsx]Inputs!A1');
  });

  it('installs external formula overlays on compute bridge range queries', async () => {
    const sourceValues = { Inputs: { A1: 125 } };
    unregister = registerExternalWorkbookSession('source-session', {
      workbook: {
        async getSheet(name: string) {
          return {
            async getValue(address: string) {
              return sourceValues[name]?.[address] ?? null;
            },
          };
        },
      },
    });

    const queryRange = jest.fn(async () => ({
      cells: [{ row: 0, col: 0, cellId: 'cell-1', value: 125, formula: '=125' }],
      merges: [],
    }));
    const queryRanges = jest.fn(async () => ({
      entries: [
        {
          status: 'ok' as const,
          sheetId: 'sheet-1',
          sheetName: 'Sheet1',
          startRow: 0,
          startCol: 0,
          endRow: 0,
          endCol: 0,
          result: {
            cells: [{ row: 0, col: 0, cellId: 'cell-1', value: 125, formula: '=125' }],
            merges: [],
          },
        },
      ],
    }));
    const getRawCellData = jest.fn(async () => ({
      raw: 125,
      computed: 125,
      formula: '=125',
    }));
    const refreshActiveCell = jest.fn(async () => undefined);
    const getCellPosition = jest.fn(async () => ({
      sheetId: 'sheet-1',
      sheetName: 'Sheet1',
      row: 0,
      col: 0,
    }));
    const getActiveCellData = jest.fn(() => ({
      cellId: 'cell-1',
      value: 125,
      formula: '=125',
      isFormulaHidden: false,
    }));
    const ctx = createContext(sourceValues, {
      computeBridge: {
        setCellsByPosition: jest.fn(async () => ({ success: true })),
        queryRange,
        queryRanges,
        getRawCellData,
        refreshActiveCell,
        getCellPosition,
        getActiveCellData,
      },
    });
    const sheetId = 'sheet-1' as SheetId;

    await prepareExternalFormulaWrite(ctx, sheetId, 0, 0, '=[Budget.xlsx]Inputs!A1');
    installExternalFormulaReadbacks(ctx);

    await expect(ctx.computeBridge.queryRange(sheetId, 0, 0, 0, 0)).resolves.toMatchObject({
      cells: [{ formula: '=[Budget.xlsx]Inputs!A1' }],
    });
    await expect(ctx.computeBridge.queryRanges([{ sheetName: 'Sheet1' }])).resolves.toMatchObject({
      entries: [{ result: { cells: [{ formula: '=[Budget.xlsx]Inputs!A1' }] } }],
    });
    await expect(ctx.computeBridge.getRawCellData(sheetId, 0, 0, true)).resolves.toMatchObject({
      formula: '=[Budget.xlsx]Inputs!A1',
    });
    await ctx.computeBridge.refreshActiveCell(sheetId, 'cell-1');
    expect(ctx.computeBridge.getActiveCellData()).toMatchObject({
      formula: '=[Budget.xlsx]Inputs!A1',
    });
  });

  it('refreshes ready workbook links while materializing external references', async () => {
    const sourceValues = { Inputs: { A1: 125 } };
    unregister = registerExternalWorkbookSession('source-session', {
      workbook: {
        async getSheet(name: string) {
          return {
            async getValue(address: string) {
              return sourceValues[name]?.[address] ?? null;
            },
          };
        },
      },
    });
    const resolve = jest.fn<WorkbookLinkResolver['resolve']>((request) => ({
      linkId: request.linkId,
      status: 'ready',
      sourceSessionId: 'source-session',
      sourceWorkbookId: request.expectedWorkbookId ?? undefined,
      sourceVersion: 'v1',
      authorization: 'read',
    }));
    const ctx = createContext(sourceValues, { resolver: { resolve } });
    const sheetId = 'sheet-1' as SheetId;

    await ctx.workbookLinks.refresh('link-budget', scope());
    resolve.mockClear();

    await prepareExternalFormulaWrite(ctx, sheetId, 0, 0, '=[Budget.xlsx]Inputs!A1');

    expect(resolve).toHaveBeenCalledTimes(1);
    resolve.mockClear();

    await materializeExternalFormulas(ctx);

    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('materializes external range references as array constants', async () => {
    const sourceValues = { Inputs: { A1: 125, A2: 25 } };
    unregister = registerExternalWorkbookSession('source-session', {
      workbook: {
        async getSheet(name: string) {
          return {
            async getValue(address: string) {
              return sourceValues[name]?.[address] ?? null;
            },
          };
        },
      },
    });
    const ctx = createContext(sourceValues);

    await expect(
      prepareExternalFormulaWrite(
        ctx,
        'sheet-1' as SheetId,
        1,
        0,
        '=SUM([Budget.xlsx]Inputs!A1:A2)',
      ),
    ).resolves.toBe('=SUM({125;25})');
  });

  it('rejects unbound Excel ordinal references with a matching local-sheet suggestion', async () => {
    const workbookLinks = createWorkbookLinkService();
    const ctx = {
      workbookLinks,
      workbookLinkScope: scope,
      computeBridge: {
        getAllSheetIds: jest.fn(async () => ['model-sheet', 'source-gaap-sheet']),
        getSheetName: jest.fn(async (id: string) =>
          id === 'model-sheet' ? 'Model' : 'Source-GAAP',
        ),
      },
    } as unknown as DocumentContext;
    const sheetId = 'model-sheet' as SheetId;

    await expect(
      prepareExternalFormulaWrite(ctx, sheetId, 0, 0, "='[1]Source-GAAP'!$L$17"),
    ).rejects.toMatchObject({
      code: 'API_INVALID_ARGUMENT',
      path: ['formula'],
      suggestion:
        "Use ='Source-GAAP'!$L$17 for a local reference, or create or bind an external workbook link with a readable name and write the formula with that name instead of [1].",
      context: expect.objectContaining({
        diagnosticCode: 'EXTERNAL_REFERENCE_UNBOUND_LOCAL_SHEET_CANDIDATE',
        tokenKind: 'excel-internal-ordinal',
        workbookToken: '1',
        localSheetName: 'Source-GAAP',
        localReference: "'Source-GAAP'!$L$17",
        suggestedFormula: "='Source-GAAP'!$L$17",
      }),
    });
    expect(getTrackedExternalFormula(ctx, sheetId, 0, 0)).toBeUndefined();
  });

  it('masks external references for interactive syntax and circular validation', () => {
    expect(maskExternalFormulaRefsForValidation('=[Budget.xlsx]Inputs!A1')).toBe('=0');
    expect(maskExternalFormulaRefsForValidation('=SUM([Budget.xlsx]Inputs!A1:A2)+A1')).toBe(
      '=SUM(0)+A1',
    );
  });

  it('preserves external reference text for diagnostics and local-reference suggestions', () => {
    const refs = getExternalFormulaReferences("='[1]Source-GAAP'!$L$17");

    expect(refs).toEqual([
      expect.objectContaining({
        text: "'[1]Source-GAAP'!$L$17",
        start: 1,
        end: 23,
        workbookToken: '1',
        sheetName: 'Source-GAAP',
        address: 'L17',
        addressText: '$L$17',
      }),
    ]);
    expect(localReferenceForExternalRef(refs[0]!)).toBe("'Source-GAAP'!$L$17");
  });
});
