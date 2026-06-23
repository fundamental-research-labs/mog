export function reviewCellA1ValueChange() {
  return {
    changeId: 'change-cell-a1',
    domain: 'cell',
    entityId: 'sheet-1!A1',
    propertyPath: ['value'],
    before: { kind: 'value', value: null },
    after: { kind: 'value', value: 42 },
    display: { address: { kind: 'value', value: 'A1' } },
  };
}

export function reviewSheetOrderChange() {
  return {
    changeId: 'change-sheet-order',
    domain: 'sheet',
    entityId: 'sheet-2',
    propertyPath: ['order'],
    before: { kind: 'value', value: 1 },
    after: { kind: 'value', value: 2 },
    display: { entityLabel: { kind: 'value', value: 'Sheet 2' } },
  };
}

export function hiddenUnsupportedMacroChange() {
  return {
    changeId: 'change-vba-module',
    domain: 'macros.vba',
    entityId: 'module-1',
    propertyPath: ['source'],
    before: { kind: 'value', value: null },
    after: { kind: 'value', value: 'private macro source' },
  };
}
