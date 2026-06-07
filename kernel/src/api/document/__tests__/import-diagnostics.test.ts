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
});
