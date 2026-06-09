import generatedGuidance from '../src/generated/api-guidance.json';
import { api, apiSpec } from '../src/api-describe';
import {
  analyzeMogCode,
  apiCompatibility,
  apiGuidanceCatalog,
  apiGuidanceCatalogValidation,
  preflightMogCode,
  resolveGuidanceTarget,
} from '../src/agent-guidance';

describe('SDK agent API guidance', () => {
  it('keeps the generated guidance artifact in sync with the typed catalog', () => {
    expect(generatedGuidance.entries).toEqual(apiGuidanceCatalog);
    expect(generatedGuidance.compatibility.entries).toEqual(apiCompatibility.entries);
  });

  it('validates every catalog replacement path against generated guidance targets or root imports', () => {
    expect(apiGuidanceCatalogValidation).toEqual({ valid: true, issues: [] });

    for (const entry of apiGuidanceCatalog) {
      for (const replacement of entry.mogReplacements) {
        expect(resolveGuidanceTarget(replacement.path)).toBeTruthy();
      }
    }
  });

  it('explains wrong OfficeJS symbols and real Mog paths through api.guidance', () => {
    const wrong = api.guidance.explain('context.workbook.worksheets.getActiveWorksheet');

    expect(wrong?.kind).toBe('foreign-api-dialect');
    if (wrong?.kind !== 'foreign-api-dialect') throw new Error('expected foreign guidance');
    expect(wrong.diagnostic.code).toBe('MOG001_FOREIGN_API_DIALECT');
    expect(wrong.diagnostic.mogReplacements).toContainEqual(
      expect.objectContaining({ path: 'wb.activeSheet' }),
    );

    const activeSheet = api.guidance.explain('wb.activeSheet');
    expect(activeSheet?.kind).toBe('mog-api');
    if (activeSheet?.kind !== 'mog-api') throw new Error('expected Mog API guidance');
    expect(activeSheet.target.kind).toBe('property');
    expect(activeSheet.target.interface).toBe('Workbook');

    const rootImport = api.guidance.explain('createWorkbook');
    expect(rootImport?.kind).toBe('mog-api');
    if (rootImport?.kind !== 'mog-api') throw new Error('expected root import guidance');
    expect(rootImport.target.kind).toBe('rootImport');
  });

  it('explains versioned Mog API compatibility decisions', () => {
    const getCharts = api.guidance.explain('ws.getCharts');
    expect(getCharts?.kind).toBe('mog-api-compatibility');
    if (getCharts?.kind !== 'mog-api-compatibility') {
      throw new Error('expected compatibility guidance');
    }
    expect(getCharts.entry.status).toBe('supported_alias');
    expect(getCharts.entry.canonicalPath).toBe('ws.charts.list');
    expect(getCharts.target?.path).toBe('ws.charts.list');

    const canonical = api.guidance.explain('ws.charts.list');
    expect(canonical?.kind).toBe('mog-api');
    if (canonical?.kind !== 'mog-api') throw new Error('expected canonical Mog guidance');
    expect(canonical.target.compatibility?.map((entry) => entry.id)).toContain(
      'mog-api.worksheet.getCharts.alias',
    );

    const method = api.describe('ws.getCharts');
    expect(method && 'compatibility' in method ? method.compatibility : []).toContainEqual(
      expect.objectContaining({ id: 'mog-api.worksheet.getCharts.alias' }),
    );
  });

  it('analyzes and preflights common OfficeJS residue without executing code', () => {
    const source = `
      await Excel.run(async (context) => {
        const sheet = context.workbook.worksheets.getActiveWorksheet();
        const range = sheet.getRange("A1:B2");
        range.values = [[1, 2], [3, 4]];
        await context.sync();
      });
    `;

    const diagnostics = analyzeMogCode(source);
    const matcherIds = diagnostics.map((diagnostic) => diagnostic.matcherId);

    expect(matcherIds).toContain('officejs.excel-run');
    expect(matcherIds).toContain('officejs.context-workbook-active-worksheet');
    expect(matcherIds).toContain('officejs.range-values-assignment');
    expect(matcherIds).toContain('officejs.context-sync');
    expect(
      diagnostics.filter((diagnostic) => diagnostic.entryId === 'officejs.active-sheet'),
    ).toHaveLength(1);
    expect(diagnostics.some((diagnostic) => diagnostic.blocking)).toBe(true);
    expect(
      diagnostics
        .flatMap((diagnostic) => diagnostic.mogReplacements)
        .map((replacement) => replacement.path),
    ).toContain('ws.setRange');

    const preflight = preflightMogCode(source);
    expect(preflight.ok).toBe(false);
    expect(preflight.diagnostics).toEqual(diagnostics);
  });

  it('detects formatting, table/filter, names, file, and range-navigation categories', () => {
    const source = `
      await Excel.run(async (context) => {
        const sheet = context.workbook.worksheets.getActiveWorksheet();
        const range = sheet.getRange("A1:B2");
        range.format.fill.color = "#fff";
        range.getUsedRangeOrNullObject();
        const table = sheet.tables.add("A1:B2", true);
        table.sort.apply([{ key: 0, ascending: true }]);
        context.workbook.names.add("Total", "=Sheet1!A1");
        Office.context.document.getFileAsync("compressed", () => {});
      });
    `;

    const categories = new Set(analyzeMogCode(source).map((diagnostic) => diagnostic.category));

    expect(categories.has('formatting')).toBe(true);
    expect(categories.has('filters')).toBe(true);
    expect(categories.has('names')).toBe(true);
    expect(categories.has('file-io')).toBe(true);
    expect(categories.has('range')).toBe(true);
    expect(categories.has('tables')).toBe(true);
  });

  it('does not match comments, strings, valid Mog code, or ordinary local Excel/context identifiers', () => {
    const source = `
      // await Excel.run(async (context) => context.sync());
      const text = "context.workbook.worksheets.getActiveWorksheet(); range.values = []";
      const worksheet = wb.activeSheet;
      await worksheet.tables.add("A1:B2", { hasHeaders: true });
      await ws.setRange("A1:B2", [[1, 2], [3, 4]]);
      const Excel = { run() {} };
      const context = { sync() {} };
      Excel.run();
      context.sync();
      console.log(text, Excel, context);
    `;

    expect(analyzeMogCode(source)).toEqual([]);
    expect(api.guidance.preflight(source)).toEqual({ ok: true, diagnostics: [] });
  });

  it('preflights Mog-version compatibility diagnostics without blocking supported aliases', () => {
    const supported = preflightMogCode('const charts = await ws.getCharts();');
    expect(supported).toEqual({ ok: true, diagnostics: [] });

    const deprecated = preflightMogCode('const charts = await ws.listCharts();');
    expect(deprecated.ok).toBe(true);
    expect(deprecated.diagnostics).toEqual([
      expect.objectContaining({
        code: 'MOG002_MOG_API_USAGE',
        dialect: 'mog-version',
        entryId: 'mog-api.chart.root.listCharts.deprecated',
        compatibilityStatus: 'deprecated_alias',
        blocking: false,
      }),
    ]);

    const rejected = preflightMogCode(`
      await ws.addChart({ type: "bar", dataRange: "A1:B2" });
      const handle = await ws.pivots.get("SalesPivot");
      await handle.describe();
    `);
    expect(rejected.ok).toBe(false);
    expect(rejected.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entryId: 'mog-api.chart.root.addChart.unsupported',
          blocking: true,
        }),
        expect.objectContaining({
          entryId: 'mog-api.pivot.handle.describe.unsupported',
          blocking: true,
        }),
      ]),
    );
  });

  it('blocks observed wrong Mog worksheet API paths with structured guidance', () => {
    const source = `
      const cellValue = await ws.getCellValue("A1");
      const raw = await ws.rawCellData("A1");
      const displayedFormat = await ws.getFormat("A1");
      const address = ws.indexToAddress(1, 1);
      const position = ws.addressToIndex("A1");
      const col = ws._colLetter(1);
      console.log(cellValue, raw, displayedFormat, address, position, col);
    `;

    const preflight = preflightMogCode(source);
    expect(preflight.ok).toBe(false);

    const byId = new Map(
      preflight.diagnostics.map((diagnostic) => [diagnostic.entryId, diagnostic]),
    );
    const expectedEntryIds = [
      'mog-api.worksheet.getCellValue.unsupported',
      'mog-api.worksheet.rawCellData.unsupported',
      'mog-api.worksheet.getFormat.unsupported',
      'mog-api.worksheet.indexToAddress.unsupported',
      'mog-api.worksheet.addressToIndex.unsupported',
      'mog-api.worksheet.privateColLetter.unsupported',
    ];

    for (const entryId of expectedEntryIds) {
      expect(byId.get(entryId)).toEqual(
        expect.objectContaining({
          code: 'MOG002_MOG_API_USAGE',
          dialect: 'mog-version',
          compatibilityStatus: 'structured_diagnostic',
          blocking: true,
        }),
      );
    }

    expect(byId.get('mog-api.worksheet.getCellValue.unsupported')?.mogReplacements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'ws.getValue' }),
        expect.objectContaining({ path: 'ws.getCell' }),
      ]),
    );
    expect(byId.get('mog-api.worksheet.getFormat.unsupported')?.mogReplacements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'ws.formats.getDisplayedCellProperties' }),
        expect.objectContaining({ path: 'ws.formats.get' }),
      ]),
    );
  });

  it('blocks missing await on workbook getSheet before worksheet getValue', () => {
    const preflight = preflightMogCode(`
      const a = await workbook.getSheet("Data").getValue("A1");
      const b = await wb.getSheet("Data").getValue("B1");
      console.log(a, b);
    `);

    expect(preflight.ok).toBe(false);
    expect(preflight.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MOG002_MOG_API_USAGE',
          entryId: 'mog-api.workbook.getSheet.missing-await',
          matcherId: 'compatibility.mog-api.workbook.getSheet.missing-await.workbook',
          blocking: true,
          message: expect.stringContaining('getSheet is async'),
          suggestion: expect.stringContaining('const ws = await wb.getSheet(name);'),
        }),
        expect.objectContaining({
          code: 'MOG002_MOG_API_USAGE',
          entryId: 'mog-api.workbook.getSheet.missing-await',
          matcherId: 'compatibility.mog-api.workbook.getSheet.missing-await.wb',
          blocking: true,
        }),
      ]),
    );
  });

  it('does not flag comments, strings, valid Mog calls, or unrelated local helper names for Mog API guidance', () => {
    const source = `
      // await ws.getCellValue("A1");
      const text = 'ws.rawCellData("A1"); ws.getFormat("A1"); ws._colLetter(1); workbook.getSheet("S").getValue("A1")';
      const helpers = {
        getCellValue() {},
        rawCellData() {},
        getFormat() {},
        indexToAddress() {},
        addressToIndex() {},
        _colLetter() {},
      };
      helpers.getCellValue();
      helpers.rawCellData();
      helpers.getFormat();
      helpers.indexToAddress();
      helpers.addressToIndex();
      helpers._colLetter();
      const ws2 = await wb.getSheet("S");
      await ws.getValue("A1");
      await ws.getRawCellData("A1");
      await ws.formats.getDisplayedCellProperties("A1");
      await ws.formats.get("A1");
      wb.indexToAddress(1, 1);
      wb.addressToIndex("A1");
      const ws3 = await workbook.getSheet("S");
      await ws3.getValue("A1");
      console.log(text, helpers, ws2, ws3);
    `;

    const mogApiDiagnostics = analyzeMogCode(source).filter((diagnostic) =>
      diagnostic.entryId.startsWith('mog-api.'),
    );
    expect(mogApiDiagnostics).toEqual([]);
  });

  it('surfaces pivot handle getInfo in generated API metadata and describe output', () => {
    expect(apiSpec.types.PivotTableHandle?.definition).toContain(
      'getInfo(options?: PivotHandleInfoOptions): Promise<PivotHandleInfo>;',
    );
    expect(apiSpec.types.PivotTableHandle?.definition).not.toContain('describe(');
    expect(apiSpec.types.PivotHandleInfoOptions?.definition).toContain('includeItems?: boolean');
    expect(apiSpec.types.PivotHandleInfo?.definition).toContain('contentArea: string');
    expect(apiSpec.types.PivotHandleInfo?.definition).toContain('rowFields: string[]');
    expect(apiSpec.types.PivotHandleInfo?.definition).toContain('availableMethods: string[]');

    const handleDescription = api.describe('type:PivotTableHandle');
    expect(handleDescription).toEqual(
      expect.objectContaining({
        name: 'PivotTableHandle',
        definition: expect.stringContaining(
          'getInfo(options?: PivotHandleInfoOptions): Promise<PivotHandleInfo>;',
        ),
      }),
    );

    const getDescription = api.describe('ws.pivots.get');
    if (!getDescription || !('types' in getDescription)) {
      throw new Error('expected ws.pivots.get method metadata');
    }
    expect(getDescription.types.PivotTableHandle?.definition).toContain(
      'getInfo(options?: PivotHandleInfoOptions): Promise<PivotHandleInfo>;',
    );
    expect(getDescription.types.PivotHandleInfo?.definition).toContain('contentArea: string');

    const handleDescribeDiagnostic = api.guidance.explain('ws.pivots.get(...).describe');
    expect(handleDescribeDiagnostic?.kind).toBe('mog-api-compatibility');
    if (handleDescribeDiagnostic?.kind !== 'mog-api-compatibility') {
      throw new Error('expected pivot handle describe compatibility guidance');
    }
    expect(handleDescribeDiagnostic.entry.id).toBe('mog-api.pivot.handle.describe.unsupported');
    expect(handleDescribeDiagnostic.entry.diagnostics?.replacements).toContain(
      'type:PivotTableHandle.getInfo',
    );
  });
});
