import { jest } from '@jest/globals';

import { trackExternalFormulaWrite } from '../../services/external-formulas';
import { WorkbookDiagnosticsImpl } from '../workbook/diagnostics';

describe('WorkbookDiagnosticsImpl', () => {
  it('checks formula error values across used ranges without treating constants as formula errors', async () => {
    const ctx = {
      computeBridge: {
        getAllSheetIds: jest.fn(async () => ['sheet-1']),
        getSheetName: jest.fn(async () => 'Sheet1'),
        getDataBounds: jest.fn(async () => ({ minRow: 0, minCol: 0, maxRow: 1, maxCol: 1 })),
        queryRange: jest.fn(async () => ({
          cells: [
            {
              row: 0,
              col: 0,
              cellId: 'cell-1',
              formula: '=A2',
              value: { type: 'error', value: 'Ref' },
            },
            {
              row: 0,
              col: 1,
              cellId: 'cell-2',
              value: '#DIV/0!',
            },
          ],
          merges: [],
        })),
      },
    };
    const diagnostics = new WorkbookDiagnosticsImpl(ctx as any);

    await expect(diagnostics.checkFormulaErrorValues()).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        findings: [
          expect.objectContaining({
            check: 'formula-error-values',
            code: 'FORMULA_ERROR_VALUE',
            sheetName: 'Sheet1',
            address: 'A1',
            currentValue: '#REF!',
            formula: '=A2',
          }),
        ],
      }),
    );
    expect(ctx.computeBridge.queryRange).toHaveBeenCalledWith('sheet-1', 0, 0, 1, 1);
  });

  it('checks explicit blank regions and reports address-bearing findings', async () => {
    const ctx = {
      computeBridge: {
        getAllSheetIds: jest.fn(async () => ['sheet-1']),
        getSheetName: jest.fn(async () => 'Inputs'),
        queryRange: jest.fn(async () => ({
          cells: [
            { row: 0, col: 0, cellId: 'cell-1', value: 'filled' },
            { row: 0, col: 1, cellId: 'cell-2', value: '   ' },
          ],
          merges: [],
        })),
      },
    };
    const diagnostics = new WorkbookDiagnosticsImpl(ctx as any);

    await expect(
      diagnostics.checkBlankRegions({
        ranges: [{ sheetName: 'Inputs', range: 'A1:B1', label: 'required inputs' }],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        findings: [
          expect.objectContaining({
            check: 'blank-regions',
            code: 'REQUIRED_REGION_BLANK',
            sheetName: 'Inputs',
            address: 'B1',
            range: 'A1:B1',
            details: { label: 'required inputs' },
          }),
        ],
      }),
    );
  });

  it('checks formula shape for hardcodes and formula-like text in formula-intended ranges', async () => {
    const ctx = {
      computeBridge: {
        getAllSheetIds: jest.fn(async () => ['sheet-1']),
        getSheetName: jest.fn(async () => 'Model'),
        queryRange: jest.fn(async () => ({
          cells: [
            { row: 0, col: 0, cellId: 'cell-1', value: 123 },
            { row: 0, col: 1, cellId: 'cell-2', value: '=SUM(A1:A2)' },
            { row: 0, col: 2, cellId: 'cell-3', formula: '=C2', value: 456 },
          ],
          merges: [],
        })),
      },
    };
    const diagnostics = new WorkbookDiagnosticsImpl(ctx as any);

    const result = await diagnostics.checkFormulaShape({
      ranges: [{ sheetName: 'Model', range: 'A1:C1', allowBlanks: true }],
    });

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      expect.objectContaining({
        code: 'HARDCODE_IN_FORMULA_RANGE',
        address: 'A1',
        currentValue: 123,
      }),
      expect.objectContaining({
        code: 'FORMULA_LIKE_TEXT_VALUE',
        address: 'B1',
        currentValue: '=SUM(A1:A2)',
      }),
    ]);
  });

  it('checks external references from formula diagnostics and workbook link statuses', async () => {
    const ctx = {
      workbookLinkScope: jest.fn(() => ({ requestingDocumentId: 'doc-1' })),
      workbookLinks: {
        list: jest.fn(() => [
          { linkId: 'link-1', displayName: 'Budget.xlsx', sourceKind: 'excel-workbook' },
        ]),
        getStatus: jest.fn(() => ({
          status: 'broken',
          statusReason: 'sourceUnavailable',
          canRefresh: false,
        })),
      },
      computeBridge: {
        getFormulaReferenceDiagnostics: jest.fn(async () => ({
          diagnostics: [
            {
              id: 'diag-1',
              type: 'reference-edge',
              kind: 'unresolved-external-reference',
              sourceKind: 'cell-formula',
              severity: 'error',
              code: 'unresolved_external_reference',
              location: {
                sheetId: 'sheet-1',
                address: 'C3',
                row: 2,
                col: 2,
                addressStatus: 'resolved',
              },
              formula: "='[Budget.xlsx]Sheet1'!A1",
              edge: {
                edgeId: 'edge-1',
                text: "'[Budget.xlsx]Sheet1'!A1",
                spanStart: 1,
                spanEnd: 24,
                targetKind: 'external',
                status: 'broken',
                reason: 'External source unavailable',
                linkId: 'link-1',
              },
            },
          ],
          snapshotVersion: 'v1',
        })),
      },
    };
    const diagnostics = new WorkbookDiagnosticsImpl(ctx as any);

    const result = await diagnostics.checkExternalReferences();

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      expect.objectContaining({
        code: 'unresolved-external-reference',
        address: 'C3',
        formula: "='[Budget.xlsx]Sheet1'!A1",
      }),
      expect.objectContaining({
        code: 'EXTERNAL_LINK_BROKEN',
        details: expect.objectContaining({ linkId: 'link-1', status: 'broken' }),
      }),
    ]);
    expect(ctx.computeBridge.getFormulaReferenceDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        includeWarnings: true,
        externalLinks: expect.objectContaining({
          records: [
            expect.objectContaining({
              linkId: 'link-1',
              status: 'broken',
              safeDisplayName: 'Budget.xlsx',
            }),
          ],
        }),
      }),
    );
  });

  it('explains unregistered external-style formulas when a matching local sheet exists', async () => {
    const ctx = {
      workbookLinkScope: jest.fn(() => ({ requestingDocumentId: 'doc-1' })),
      workbookLinks: {
        list: jest.fn(() => []),
        listRecords: jest.fn(() => []),
        getStatus: jest.fn(),
      },
      computeBridge: {
        getFormulaReferenceDiagnostics: jest.fn(async () => ({
          diagnostics: [],
          snapshotVersion: 'v1',
        })),
        getAllSheetIds: jest.fn(async () => ['model-sheet', 'source-gaap-sheet']),
        getSheetName: jest.fn(async (sheetId: string) =>
          sheetId === 'model-sheet' ? 'Model' : 'Source-GAAP',
        ),
      },
    };
    trackExternalFormulaWrite(ctx as any, 'model-sheet' as any, 0, 0, "='[1]Source-GAAP'!$L$17");
    const diagnostics = new WorkbookDiagnosticsImpl(ctx as any);

    const result = await diagnostics.checkExternalReferences();

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      expect.objectContaining({
        code: 'EXTERNAL_REFERENCE_UNBOUND_LOCAL_SHEET_CANDIDATE',
        severity: 'error',
        sheetName: 'Model',
        address: 'A1',
        formula: "='[1]Source-GAAP'!$L$17",
        suggestedNextApiCall:
          'await wb.getSheet("Model").then(ws => ws.setFormula("A1", "=\'Source-GAAP\'!$L$17"))',
        details: expect.objectContaining({
          diagnosticCode: 'EXTERNAL_REFERENCE_UNBOUND_LOCAL_SHEET_CANDIDATE',
          text: "'[1]Source-GAAP'!$L$17",
          workbookToken: '1',
          tokenKind: 'excel-internal-ordinal',
          localSheetName: 'Source-GAAP',
          localReference: "'Source-GAAP'!$L$17",
          suggestedFormula: "='Source-GAAP'!$L$17",
        }),
      }),
    ]);
    expect(result.findings[0]!.message).toContain('Excel internal external-link ordinal');
    expect(result.findings[0]!.message).toContain('Local sheet "Source-GAAP" exists');
    expect(result.findings[0]!.message).toContain(
      'readable name and write the formula with that name',
    );
  });

  it('composes validateWorkbook and reports requested unsupported checks instead of passing them', async () => {
    const ctx = {
      workbookLinkScope: jest.fn(() => ({ requestingDocumentId: 'doc-1' })),
      workbookLinks: {
        list: jest.fn(() => []),
        getStatus: jest.fn(),
      },
      computeBridge: {
        getAllSheetIds: jest.fn(async () => ['sheet-1']),
        getSheetName: jest.fn(async () => 'Sheet1'),
        getDataBounds: jest.fn(async () => null),
        getFormulaReferenceDiagnostics: jest.fn(async () => ({
          diagnostics: [],
          snapshotVersion: 'v1',
        })),
      },
    };
    const diagnostics = new WorkbookDiagnosticsImpl(ctx as any, {
      isDirty: () => true,
    });

    const result = await diagnostics.validateWorkbook({
      includeOpenXml: true,
      includeStaleValues: true,
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: 'formula-error-values', status: 'passed' }),
        expect.objectContaining({ check: 'external-references', status: 'passed' }),
        expect.objectContaining({ check: 'dirty-state', status: 'failed' }),
        expect.objectContaining({ check: 'openxml-loadability', status: 'unsupported' }),
        expect.objectContaining({ check: 'stale-cached-values', status: 'unsupported' }),
      ]),
    );
  });

  it('checkErrors runs the broad discoverable check set by default', async () => {
    const ctx = {
      workbookLinkScope: jest.fn(() => ({ requestingDocumentId: 'doc-1' })),
      workbookLinks: {
        list: jest.fn(() => []),
        getStatus: jest.fn(),
      },
      computeBridge: {
        getAllSheetIds: jest.fn(async () => ['sheet-1']),
        getSheetName: jest.fn(async () => 'Sheet1'),
        getDataBounds: jest.fn(async () => null),
        getFormulaReferenceDiagnostics: jest.fn(async () => ({
          diagnostics: [],
          snapshotVersion: 'v1',
        })),
      },
    };
    const diagnostics = new WorkbookDiagnosticsImpl(ctx as any, {
      isDirty: () => false,
    });

    const result = await diagnostics.checkErrors();

    expect(result.ok).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: 'formula-error-values', status: 'passed' }),
        expect.objectContaining({ check: 'external-references', status: 'passed' }),
        expect.objectContaining({ check: 'dirty-state', status: 'passed' }),
        expect.objectContaining({ check: 'openxml-loadability', status: 'unsupported' }),
        expect.objectContaining({ check: 'stale-cached-values', status: 'unsupported' }),
      ]),
    );
  });

  it('queries runtime diagnostics from compute and normalizes public fields', async () => {
    const ctx = {
      computeBridge: {
        getRuntimeDiagnostics: jest.fn(async () => ({
          diagnostics: [
            {
              id: 'runtime-diagnostic-1',
              sequence: '1',
              code: 'unsupported_filter_reapply',
              severity: 'unexpected',
              recoverability: 'unsupported_preserved',
              operation: 'applyFilter',
              sheetId: 'sheet-1',
              filterId: 'filter-1',
              filterKind: 'not-a-filter-kind',
              reason: 'iconFilterUnsupported',
              reasons: ['iconFilterUnsupported'],
            },
            {
              id: 'runtime-diagnostic-2',
              sequence: '2',
              code: 'unsupported_filter_reapply',
              severity: 'error',
              recoverability: 'unsupported_preserved',
              operation: 'applyFilter',
              sheetId: 'sheet-1',
              filterId: 'filter-2',
              filterKind: 'tableFilter',
            },
          ],
          nextSequence: '2',
          truncated: false,
        })),
      },
    };
    const diagnostics = new WorkbookDiagnosticsImpl(ctx as any);

    await expect(diagnostics.runtime({ sinceSequence: '1', limit: 10 })).resolves.toEqual({
      diagnostics: [
        expect.objectContaining({
          id: 'runtime-diagnostic-1',
          severity: 'warning',
          filterKind: undefined,
        }),
        expect.objectContaining({
          id: 'runtime-diagnostic-2',
          severity: 'error',
          filterKind: 'tableFilter',
        }),
      ],
      nextSequence: '2',
      truncated: false,
    });
    expect(ctx.computeBridge.getRuntimeDiagnostics).toHaveBeenCalledWith({
      sinceSequence: '1',
      limit: 10,
    });
  });

  it('captures a resolved chart spec through workbook diagnostics without exporting pixels', async () => {
    const resolvedChartSpec = {
      schemaVersion: 1,
      chartId: 'chart-1',
      sheetId: 'sheet-1',
      chartObject: { id: 'chart-1' },
      export: {
        kind: 'raster',
        format: 'png',
        width: 320,
        height: 180,
        pixelRatio: 2,
        physicalWidth: 640,
        physicalHeight: 360,
        backgroundColor: '#ffffff',
        fittingMode: 'fill',
        frame: {
          exportWidth: 320,
          exportHeight: 180,
          contentX: 0,
          contentY: 0,
          contentWidth: 320,
          contentHeight: 180,
        },
      },
      implementation: {
        renderAuthority: 'chartBridge',
        renderStatus: 'renderable',
        compilerPathId: 'ts-grammar',
        compilerInputHash: 'hash',
        compilerVersion: 1,
      },
      resolved: {
        chartType: 'bar',
        title: { present: false },
        legend: { present: false, entries: [], visibleEntries: [] },
        axes: {},
        series: [],
        categories: [],
        plot: {},
        ranges: {
          dataRange: null,
          categoryRange: null,
          seriesRange: null,
          seriesReferences: [],
          diagnostics: [],
        },
        dataHashes: {
          categoriesHash: 'categories',
          seriesHash: 'series',
        },
      },
      diagnostics: {
        compiler: [],
        unsupportedFeatures: [],
      },
    };
    const ctx = {
      charts: {
        getRenderSnapshotAtSize: jest.fn(async () => ({
          marks: [],
          resolvedChartSpec,
        })),
      },
    };

    const diagnostics = new WorkbookDiagnosticsImpl(ctx as any);

    await expect(
      diagnostics.getResolvedChartSpec({
        sheetId: 'sheet-1' as any,
        chartId: 'chart-1',
        exportOptions: {
          format: 'png',
          width: 320,
          height: 180,
          pixelRatio: 2,
          backgroundColor: '#ffffff',
        },
      }),
    ).resolves.toBe(resolvedChartSpec);
    expect(ctx.charts.getRenderSnapshotAtSize).toHaveBeenCalledWith(
      'sheet-1',
      'chart-1',
      320,
      180,
      expect.objectContaining({
        kind: 'raster',
        format: 'png',
        width: 320,
        height: 180,
        pixelRatio: 2,
        physicalWidth: 640,
        physicalHeight: 360,
        backgroundColor: '#ffffff',
        fittingMode: 'fill',
        frame: {
          exportWidth: 320,
          exportHeight: 180,
          contentX: 0,
          contentY: 0,
          contentWidth: 320,
          contentHeight: 180,
        },
      }),
    );
  });

  it('maps chart bridge not-found diagnostics to the public chart-not-found error', async () => {
    const ctx = {
      charts: {
        getRenderSnapshotAtSize: jest.fn(async () => ({
          code: 'CHART_NOT_FOUND',
          message: 'Chart not found',
          chartId: 'missing-chart',
        })),
      },
    };
    const diagnostics = new WorkbookDiagnosticsImpl(ctx as any);

    await expect(
      diagnostics.getResolvedChartSpec({
        sheetId: 'sheet-1' as any,
        chartId: 'missing-chart',
      }),
    ).rejects.toThrow('Chart "missing-chart" not found');
  });
});
