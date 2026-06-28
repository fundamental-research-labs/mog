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

function cellObjectId(input: {
  readonly sheetId: string;
  readonly row: number;
  readonly column: number;
}): string {
  return `cell:${input.sheetId}:r${input.row}:c${input.column}`;
}
