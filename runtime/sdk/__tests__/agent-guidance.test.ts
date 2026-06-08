import { api, analyzeMogCode, explainApiSymbol, validateApiGuidanceCatalog } from '../src';

describe('agent API guidance', () => {
  it('explains OfficeJS active worksheet access with a Mog replacement', () => {
    const explanation = api.guidance.explain('context.workbook.worksheets.getActiveWorksheet');

    expect(explanation?.kind).toBe('foreign-api-dialect');
    if (explanation?.kind !== 'foreign-api-dialect') return;
    expect(explanation.diagnostic.code).toBe('MOG001_FOREIGN_API_DIALECT');
    expect(explanation.diagnostic.dialect).toBe('officejs');
    expect(explanation.diagnostic.mogReplacements).toContainEqual({
      path: 'wb.activeSheet',
      snippet: 'const ws = wb.activeSheet;',
    });
  });

  it('explains generated Mog target metadata for sync properties', () => {
    const explanation = explainApiSymbol('wb.activeSheet');

    expect(explanation?.kind).toBe('mog-api');
    if (explanation?.kind !== 'mog-api') return;
    expect(explanation.target.kind).toBe('property');
    expect(explanation.target.asyncModel).toBe('sync');
    expect(explanation.target.signature).toContain('activeSheet');
  });

  it('analyzes common OfficeJS residue without reading comments or string literals', () => {
    const diagnostics = analyzeMogCode(`
      // Excel.run and context.sync() are documentation text.
      const text = "range.values = [[1]]";
      await Excel.run(async (context) => {
        const sheet = context.workbook.worksheets.getActiveWorksheet();
        const range = sheet.getRange("A1:B2");
        range.values = [[1, 2], [3, 4]];
        await context.sync();
      });
    `);

    expect(diagnostics.some((diagnostic) => diagnostic.matcherId === 'officejs.excel-run')).toBe(
      true,
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.matcherId === 'officejs.context-workbook-active-worksheet' &&
          diagnostic.mogReplacements.some((replacement) => replacement.path === 'wb.activeSheet'),
      ),
    ).toBe(true);
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.matcherId === 'officejs.range-values-assignment' &&
          diagnostic.mogReplacements.some((replacement) => replacement.path === 'ws.setRange'),
      ),
    ).toBe(true);
  });

  it('does not block comments, strings, valid Mog code, or unrelated local identifiers', () => {
    const diagnostics = api.guidance.analyze(`
      // Excel.run appears in a comment.
      const message = "context.sync() appears in documentation";
      const Excel = { run: () => "not OfficeJS" };
      const context = { sync: () => "local" };
      const ws = wb.activeSheet;
      await ws.setCell("A1", message + Excel.run() + context.sync());
      const values = Object.values({ a: 1 });
      await ws.getRange("A1");
    `);

    expect(diagnostics.filter((diagnostic) => diagnostic.blocking)).toEqual([]);
  });

  it('preflight blocks high-confidence wrong-dialect code', () => {
    const result = api.guidance.preflight(`
      await Excel.run(async (context) => {
        await context.sync();
      });
    `);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('MOG001_FOREIGN_API_DIALECT');
  });

  it('validates every catalog replacement against generated target metadata', () => {
    expect(validateApiGuidanceCatalog()).toEqual({ valid: true, issues: [] });
  });
});
