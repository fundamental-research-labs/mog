import generatedGuidance from '../src/generated/api-guidance.json';
import { api } from '../src/api-describe';
import {
  analyzeMogCode,
  apiGuidanceCatalog,
  apiGuidanceCatalogValidation,
  preflightMogCode,
  resolveGuidanceTarget,
} from '../src/agent-guidance';

describe('SDK agent API guidance', () => {
  it('keeps the generated guidance artifact in sync with the typed catalog', () => {
    expect(generatedGuidance.entries).toEqual(apiGuidanceCatalog);
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
    expect(diagnostics.some((diagnostic) => diagnostic.blocking)).toBe(true);
    expect(
      diagnostics.flatMap((diagnostic) => diagnostic.mogReplacements).map((replacement) => replacement.path),
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
});
