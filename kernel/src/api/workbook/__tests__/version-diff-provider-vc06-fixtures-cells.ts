import { semanticRecord, sheetAddressDisplay } from './version-diff-provider-fixtures';

export function vc06CellSemanticChanges() {
  return [
    semanticRecord({
      changeId: 'vc06-cell-value',
      domain: 'cells.values',
      entityId: 'sheet-1!A1',
      propertyPath: ['value'],
      before: null,
      after: 42,
      display: sheetAddressDisplay('Sheet1', 'A1'),
    }),
    semanticRecord({
      changeId: 'vc06-cell-formula',
      domain: 'cells.formulas',
      entityId: 'sheet-1!B1',
      propertyPath: ['formula'],
      before: null,
      after: { kind: 'formula', formula: '=A1*2', result: 84 },
      display: sheetAddressDisplay('Sheet1', 'B1'),
    }),
  ];
}
