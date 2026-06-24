import {
  documentImportWarningsFromDiagnostics,
  mapDocumentImportWarningToMogImportWarning,
  projectImportDiagnostic,
} from '../import-diagnostics';

describe('import diagnostics projection', () => {
  it('preserves diagnostic identity, details, and structured warning location', () => {
    const diagnostic = projectImportDiagnostic({
      id: 'import-filter-1',
      code: { unsupportedFeature: null },
      severity: 'warning',
      feature: 'worksheet',
      recoverability: 'unsupportedPreserved',
      message: 'Imported filter criteria are preserved but not editable.',
      reference: {
        sheetIndex: 0,
        sheetName: 'Data',
        sourceRange: 'A1:D12',
        row: 0,
        col: 2,
        cellRef: 'C1',
        filterColId: 2,
      },
      details: {
        kind: 'unsupportedFilter',
        reasons: ['dateGroupUnsupported', 'unknownExtension'],
        filterId: 'filter-1',
        filterKind: 'autoFilter',
        filterColId: 2,
        resolvedCol: 2,
      },
      importPhases: ['parser', 'criticalSheet'],
      firstImportPhase: 'parser',
    } as never);

    const [warning] = documentImportWarningsFromDiagnostics([diagnostic]);

    expect(warning).toMatchObject({
      id: 'import-filter-1',
      type: 'unsupported_feature',
      severity: 'warning',
      recoverability: 'unsupportedPreserved',
      feature: 'worksheet',
      reason: 'dateGroupUnsupported',
      location: {
        sheet: 'Data',
        cell: 'C1',
        sheetIndex: 0,
        sheetName: 'Data',
        sourceRange: 'A1:D12',
        row: 0,
        col: 2,
        cellRef: 'C1',
        filterColId: 2,
      },
    });
    expect(warning?.diagnostic).toEqual(diagnostic);

    expect(mapDocumentImportWarningToMogImportWarning(warning!)).toMatchObject({
      id: 'import-filter-1',
      type: 'unsupported_feature',
      reason: 'dateGroupUnsupported',
      location: {
        sheet: 'Data',
        cell: 'C1',
        filterColId: 2,
      },
    });
  });

  it('projects diagnostics as JSON-compatible DTOs without undefined properties', () => {
    const diagnostic = projectImportDiagnostic({
      id: 'import-filter-json-safe',
      code: { unsupportedFeature: null },
      severity: 'warning',
      feature: 'worksheet',
      recoverability: 'unsupportedPreserved',
      message: 'Imported filter criteria are preserved but not editable.',
      details: {
        kind: 'unsupportedFilter',
        reasons: [undefined, 'unknownExtension'],
        missing: undefined,
        nested: {
          keep: 'value',
          drop: undefined,
        },
        array: [undefined, { keep: 1, drop: undefined }],
        nonFinite: Number.POSITIVE_INFINITY,
        negativeZero: -0,
      },
    } as never);

    expect(Object.prototype.hasOwnProperty.call(diagnostic, 'reason')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(diagnostic, 'reference')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(diagnostic, 'location')).toBe(false);
    expect(diagnostic.details).toEqual({
      kind: 'unsupportedFilter',
      reasons: [null, 'unknownExtension'],
      nested: {
        keep: 'value',
      },
      array: [null, { keep: 1 }],
      nonFinite: null,
      negativeZero: 0,
    });
    expect(containsUndefined(diagnostic)).toBe(false);
  });
});

function containsUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(containsUndefined);
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(containsUndefined);
}
