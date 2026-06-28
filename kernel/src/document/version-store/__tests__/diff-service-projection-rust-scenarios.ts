import { createWorkbookVersionDiffService } from '../diff-service';
import { graphWithRootAndChild } from './diff-service-fixtures';

export function registerDiffServiceProjectionRustScenarios(): void {
  it('projects raw Rust semantic cell changes when a payload has no review changes', async () => {
    const rustChanges = [
      rawCellValueChange({
        changeId: 'rust-cell-a1',
        sheetId: 'sheet#0',
        row: 0,
        column: 0,
        value: 42,
      }),
      rawSheetAggregateChange('sheet#0'),
      rawCellFormulaChange({
        changeId: 'rust-formula-c2',
        sheetId: 'sheet#0',
        row: 1,
        column: 2,
        formula: '=SUM(A1:B1)',
      }),
    ];
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: {
        schemaVersion: 1,
        source: {
          kind: 'rustSemanticDiff',
          beforeStateDigest: 'before-digest',
          afterStateDigest: 'after-digest',
        },
        changes: rustChanges,
        semanticDiff: {
          beforeDigest: 'before-digest',
          afterDigest: 'after-digest',
          changes: rustChanges,
          diagnostics: [],
        },
        reviewChanges: [],
      },
    });
    const service = createWorkbookVersionDiffService({ provider });

    await expect(
      service.diff({ kind: 'commit', id: rootCommitId }, { kind: 'commit', id: childCommitId }),
    ).resolves.toMatchObject({
      status: 'success',
      items: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'rust-cell-a1',
            domain: 'cells.values',
            entityId: 'sheet#0!A1',
            propertyPath: ['value'],
          },
          before: { kind: 'value', value: { kind: 'blank' } },
          after: { kind: 'value', value: 42 },
          display: { address: { kind: 'value', value: 'A1' } },
          historical: { cell: { sheetId: 'sheet#0', row: 0, column: 0 } },
        },
        {
          structural: {
            kind: 'metadata',
            changeId: 'rust-formula-c2',
            domain: 'cells.formulas',
            entityId: 'sheet#0!C2',
            propertyPath: ['formula'],
          },
          before: { kind: 'value', value: { kind: 'blank' } },
          after: { kind: 'value', value: { kind: 'formula', formula: '=SUM(A1:B1)' } },
          display: { address: { kind: 'value', value: 'C2' } },
          historical: { cell: { sheetId: 'sheet#0', row: 1, column: 2 } },
        },
      ],
      diagnostics: [],
    });
  });

  it('projects a Rust cell value edit once when aggregate and child value changes are both present', async () => {
    const rustChanges = [
      rawCellValueChange({
        changeId: 'rust-cell-a1-aggregate',
        sheetId: 'sheet#0',
        row: 0,
        column: 0,
        value: 'hello',
      }),
      rawCellValueChildChange({
        changeId: 'rust-cell-a1-value',
        sheetId: 'sheet#0',
        row: 0,
        column: 0,
        value: 'hello',
      }),
    ];
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: {
        schemaVersion: 1,
        source: {
          kind: 'rustSemanticDiff',
          beforeStateDigest: 'before-digest',
          afterStateDigest: 'after-digest',
        },
        changes: rustChanges,
        semanticDiff: {
          beforeDigest: 'before-digest',
          afterDigest: 'after-digest',
          changes: rustChanges,
          diagnostics: [],
        },
        reviewChanges: [],
      },
    });
    const service = createWorkbookVersionDiffService({ provider });

    const result = await service.diff(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      structural: {
        kind: 'metadata',
        changeId: 'rust-cell-a1-value',
        domain: 'cells.values',
        entityId: 'sheet#0!A1',
        propertyPath: ['value'],
      },
      before: { kind: 'value', value: { kind: 'blank' } },
      after: { kind: 'value', value: 'hello' },
      display: { address: { kind: 'value', value: 'A1' } },
      historical: { cell: { sheetId: 'sheet#0', row: 0, column: 0 } },
    });
  });

  it('projects raw Rust semantic sheet structural changes', async () => {
    const rustChanges = [
      rawSheetCreateChange({
        changeId: 'rust-sheet-add',
        sheetId: 'sheet#2',
        name: 'Sheet 2',
      }),
      rawSheetRenameChange({
        changeId: 'rust-sheet-rename',
        sheetId: 'sheet#1',
        beforeName: 'Old Sheet',
        afterName: 'New Sheet',
      }),
      rawSheetRemoveChange({
        changeId: 'rust-sheet-remove',
        sheetId: 'sheet#3',
        name: 'Archive',
      }),
      rawSheetShapeChange({
        changeId: 'rust-sheet-shape',
        sheetId: 'sheet#4',
        name: 'Data',
        beforeRowCount: 1000,
        afterRowCount: 1200,
      }),
    ];
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: {
        schemaVersion: 1,
        source: {
          kind: 'rustSemanticDiff',
          beforeStateDigest: 'before-digest',
          afterStateDigest: 'after-digest',
        },
        changes: rustChanges,
        semanticDiff: {
          beforeDigest: 'before-digest',
          afterDigest: 'after-digest',
          changes: rustChanges,
          diagnostics: [],
        },
        reviewChanges: [],
      },
    });
    const service = createWorkbookVersionDiffService({ provider });

    const result = await service.diff(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.items).toEqual([
      expect.objectContaining({
        structural: {
          kind: 'metadata',
          changeId: 'rust-sheet-add',
          domain: 'sheet',
          entityId: 'sheet#2',
          propertyPath: ['sheet'],
        },
        before: { kind: 'value', value: null },
        after: rustSheetDiffValue('Sheet 2'),
        display: { entityLabel: { kind: 'value', value: 'Sheet 2' } },
      }),
      expect.objectContaining({
        structural: {
          kind: 'metadata',
          changeId: 'rust-sheet-rename',
          domain: 'sheet',
          entityId: 'sheet#1',
          propertyPath: ['name'],
        },
        before: { kind: 'value', value: 'Old Sheet' },
        after: { kind: 'value', value: 'New Sheet' },
        display: { entityLabel: { kind: 'value', value: 'New Sheet' } },
      }),
      expect.objectContaining({
        structural: {
          kind: 'metadata',
          changeId: 'rust-sheet-remove',
          domain: 'sheet',
          entityId: 'sheet#3',
          propertyPath: ['sheet'],
        },
        before: rustSheetDiffValue('Archive'),
        after: { kind: 'value', value: null },
        display: { entityLabel: { kind: 'value', value: 'Archive' } },
      }),
      expect.objectContaining({
        structural: {
          kind: 'metadata',
          changeId: 'rust-sheet-shape',
          domain: 'sheet',
          entityId: 'sheet#4',
          propertyPath: ['sheet'],
        },
        before: rustSheetDiffValue('Data', { rowCount: 1000 }),
        after: rustSheetDiffValue('Data', { rowCount: 1200 }),
        display: { entityLabel: { kind: 'value', value: 'Data' } },
      }),
    ]);
  });
}

function rawCellValueChange(input: {
  readonly changeId: string;
  readonly sheetId: string;
  readonly row: number;
  readonly column: number;
  readonly value: unknown;
}) {
  const objectId = cellObjectId(input);
  return {
    changeId: input.changeId,
    kind: 'added',
    domainId: 'cells.values',
    objectId,
    objectKind: 'cell',
    afterRecord: {
      objectId,
      objectKind: 'cell',
      domainId: 'cells.values',
      record: {
        objectId,
        sheetId: input.sheetId,
        row: input.row,
        column: input.column,
        value: {
          valueKind: typeof input.value,
          canonicalValue: input.value,
        },
      },
    },
  };
}

function rawCellFormulaChange(input: {
  readonly changeId: string;
  readonly sheetId: string;
  readonly row: number;
  readonly column: number;
  readonly formula: string;
}) {
  const objectId = `formula:${cellObjectId(input)}`;
  return {
    changeId: input.changeId,
    kind: 'added',
    domainId: 'cells.formulas',
    objectId,
    objectKind: 'cell-formula',
    afterRecord: {
      objectId,
      objectKind: 'cell-formula',
      domainId: 'cells.formulas',
      record: {
        normalizedFormula: input.formula,
        dynamicArray: false,
        volatile: false,
        aggregate: false,
      },
    },
  };
}

function rawCellValueChildChange(input: {
  readonly changeId: string;
  readonly sheetId: string;
  readonly row: number;
  readonly column: number;
  readonly value: unknown;
}) {
  const cellId = cellObjectId(input);
  const objectId = `value:${cellId}`;
  return {
    changeId: input.changeId,
    kind: 'added',
    domainId: 'cells.values',
    objectId,
    objectKind: 'cell-value',
    afterRecord: {
      objectId,
      objectKind: 'cell-value',
      domainId: 'cells.values',
      record: {
        valueKind: typeof input.value,
        canonicalValue: input.value,
      },
    },
  };
}

function rawSheetAggregateChange(sheetId: string) {
  return {
    changeId: `updated:sheet:${sheetId}`,
    kind: 'updated',
    domainId: 'sheets',
    objectId: `sheet:${sheetId}`,
    objectKind: 'sheet',
  };
}

function rawSheetCreateChange(input: {
  readonly changeId: string;
  readonly sheetId: string;
  readonly name: string;
}) {
  const objectId = `sheet:${input.sheetId}`;
  return {
    changeId: input.changeId,
    kind: 'added',
    domainId: 'sheets',
    objectId,
    objectKind: 'sheet',
    afterRecord: rawSheetRecord(objectId, input.sheetId, input.name),
  };
}

function rawSheetRemoveChange(input: {
  readonly changeId: string;
  readonly sheetId: string;
  readonly name: string;
}) {
  const objectId = `sheet:${input.sheetId}`;
  return {
    changeId: input.changeId,
    kind: 'removed',
    domainId: 'sheets',
    objectId,
    objectKind: 'sheet',
    beforeRecord: rawSheetRecord(objectId, input.sheetId, input.name),
  };
}

function rawSheetRenameChange(input: {
  readonly changeId: string;
  readonly sheetId: string;
  readonly beforeName: string;
  readonly afterName: string;
}) {
  const objectId = `sheet:${input.sheetId}`;
  return {
    changeId: input.changeId,
    kind: 'updated',
    domainId: 'sheets',
    objectId,
    objectKind: 'sheet',
    beforeRecord: rawSheetRecord(objectId, input.sheetId, input.beforeName),
    afterRecord: rawSheetRecord(objectId, input.sheetId, input.afterName),
  };
}

function rawSheetShapeChange(input: {
  readonly changeId: string;
  readonly sheetId: string;
  readonly name: string;
  readonly beforeRowCount: number;
  readonly afterRowCount: number;
}) {
  const objectId = `sheet:${input.sheetId}`;
  return {
    changeId: input.changeId,
    kind: 'updated',
    domainId: 'sheets',
    objectId,
    objectKind: 'sheet',
    beforeRecord: rawSheetRecord(objectId, input.sheetId, input.name, {
      rowCount: input.beforeRowCount,
    }),
    afterRecord: rawSheetRecord(objectId, input.sheetId, input.name, {
      rowCount: input.afterRowCount,
    }),
  };
}

function rawSheetRecord(
  objectId: string,
  sheetId: string,
  name: string,
  input: { readonly rowCount?: number; readonly columnCount?: number } = {},
) {
  return {
    objectId,
    objectKind: 'sheet',
    domainId: 'sheets',
    record: {
      sheetId,
      name,
      rowCount: input.rowCount ?? 1000,
      columnCount: input.columnCount ?? 26,
    },
  };
}

function rustSheetDiffValue(
  name: string,
  input: { readonly rowCount?: number; readonly columnCount?: number } = {},
) {
  return {
    kind: 'value',
    value: {
      kind: 'object',
      fields: [
        { key: 'name', value: name },
        { key: 'rowCount', value: input.rowCount ?? 1000 },
        { key: 'columnCount', value: input.columnCount ?? 26 },
      ],
    },
  };
}

function cellObjectId(input: {
  readonly sheetId: string;
  readonly row: number;
  readonly column: number;
}): string {
  return `cell:${input.sheetId}:r${input.row}:c${input.column}`;
}
