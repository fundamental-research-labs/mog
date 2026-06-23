import { createWorkbookVersionMergeService } from '../merge-service';
import {
  graphWithRootAndDetachedChildren,
  validSemanticPayload,
  valueChange,
} from './merge-service-fixtures';

describe('WorkbookVersionMergeService', () => {
  it('previews clean disjoint cells.values changes without mutating workbook state', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-a1', 'cell', 'sheet-1!A1', ['value'], 1, 2),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        valueChange('theirs-b1', 'cells.values', 'sheet-1!B1', [], null, 'ready'),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    await expect(
      service.merge(
        {
          base: graph.rootCommitId,
          ours: graph.oursCommitId,
          theirs: graph.theirsCommitId,
        },
        { mode: 'preview' },
      ),
    ).resolves.toMatchObject({
      status: 'clean',
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: graph.theirsCommitId,
      changes: [
        expect.objectContaining({
          structural: expect.objectContaining({ entityId: 'sheet-1!A1' }),
          base: { kind: 'value', value: 1 },
          ours: { kind: 'value', value: 2 },
          merged: { kind: 'value', value: 2 },
        }),
        expect.objectContaining({
          structural: expect.objectContaining({ entityId: 'sheet-1!B1' }),
          base: { kind: 'value', value: null },
          theirs: { kind: 'value', value: 'ready' },
          merged: { kind: 'value', value: 'ready' },
        }),
      ],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    });
  });

  it('classifies same-property cells.values edits as conflicts', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-a1', 'cell', 'sheet-1!A1', ['value'], 1, 2),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        valueChange('theirs-a1', 'cell', 'sheet-1!A1', ['value'], 1, 3),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    await expect(
      service.merge({
        base: graph.rootCommitId,
        ours: graph.oursCommitId,
        theirs: graph.theirsCommitId,
      }),
    ).resolves.toMatchObject({
      status: 'conflicted',
      changes: [],
      conflicts: [
        {
          conflictKind: 'same-property',
          structural: expect.objectContaining({ entityId: 'sheet-1!A1' }),
          base: { kind: 'value', value: 1 },
          ours: { kind: 'value', value: 2 },
          theirs: { kind: 'value', value: 3 },
          resolutionOptions: [
            expect.objectContaining({
              kind: 'acceptOurs',
              value: { kind: 'value', value: 2 },
              recalcRequired: true,
            }),
            expect.objectContaining({
              kind: 'acceptTheirs',
              value: { kind: 'value', value: 3 },
              recalcRequired: true,
            }),
            expect.objectContaining({
              kind: 'acceptBase',
              value: { kind: 'value', value: 1 },
              recalcRequired: true,
            }),
          ],
        },
      ],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    });
  });

  it('derives role-invariant conflict structural ids for same-property cells.values edits', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-a1-random-source-id', 'cell', 'sheet-1!A1', ['value'], 1, 2),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        valueChange('theirs-a1-different-source-id', 'cells.values', 'sheet-1!A1', [], 1, 3),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const forward = await service.merge({
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: graph.theirsCommitId,
    });
    const reversed = await service.merge({
      base: graph.rootCommitId,
      ours: graph.theirsCommitId,
      theirs: graph.oursCommitId,
    });

    expect(forward).toMatchObject({
      status: 'conflicted',
      conflicts: [
        {
          structural: {
            kind: 'metadata',
            domain: 'cells.values',
            entityId: 'sheet-1!A1',
            propertyPath: ['value'],
          },
        },
      ],
    });
    expect(reversed).toMatchObject({
      status: 'conflicted',
      conflicts: [
        {
          structural: {
            kind: 'metadata',
            domain: 'cells.values',
            entityId: 'sheet-1!A1',
            propertyPath: ['value'],
          },
        },
      ],
    });
    if (forward.status !== 'conflicted' || reversed.status !== 'conflicted') {
      throw new Error('expected both merge previews to conflict');
    }

    expect(forward.conflicts[0].structural).toEqual(reversed.conflicts[0].structural);
    expect(forward.conflicts[0].structural.changeId).toMatch(
      /^merge-conflict:sha256:[0-9a-f]{64}$/,
    );
    expect(forward.conflicts[0].conflictId).toMatch(/^conflict:sha256:[0-9a-f]{64}$/);
    expect(forward.conflicts[0].conflictDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(forward.conflicts[0].conflictId).toBe(reversed.conflicts[0].conflictId);
    expect(forward.conflicts[0].conflictDigest).toBe(reversed.conflicts[0].conflictDigest);
    expect(forward.conflicts[0].resolutionOptions.map((option) => option.kind)).toEqual([
      'acceptOurs',
      'acceptTheirs',
      'acceptBase',
    ]);
    expect(forward.conflicts[0].resolutionOptions.map((option) => option.optionId)).toEqual(
      reversed.conflicts[0].resolutionOptions.map((option) => option.optionId),
    );
    expect(forward.conflicts[0].resolutionOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'acceptOurs',
          conflictId: forward.conflicts[0].conflictId,
          value: { kind: 'value', value: 2 },
        }),
        expect.objectContaining({
          kind: 'acceptTheirs',
          conflictId: forward.conflicts[0].conflictId,
          value: { kind: 'value', value: 3 },
        }),
        expect.objectContaining({
          kind: 'acceptBase',
          conflictId: forward.conflicts[0].conflictId,
          value: { kind: 'value', value: 1 },
        }),
      ]),
    );
    expect(JSON.stringify(forward)).not.toContain('ours-a1-random-source-id');
    expect(JSON.stringify(forward)).not.toContain('theirs-a1-different-source-id');
  });

  it('classifies value-vs-formula same-cell edits as stable conflicts', async () => {
    const formulaValue = { kind: 'formula', formula: '=1+1', result: 2 };
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-a1-value', 'cell', 'sheet-1!A1', ['value'], null, 'ours'),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        valueChange(
          'theirs-a1-formula',
          'cells.formulas',
          'sheet-1!A1',
          ['formula'],
          null,
          formulaValue,
        ),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const forward = await service.merge({
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: graph.theirsCommitId,
    });
    const reversed = await service.merge({
      base: graph.rootCommitId,
      ours: graph.theirsCommitId,
      theirs: graph.oursCommitId,
    });

    expect(forward).toMatchObject({
      status: 'conflicted',
      changes: [],
      conflicts: [
        {
          conflictKind: 'same-property',
          structural: {
            kind: 'metadata',
            domain: 'cells.values',
            entityId: 'sheet-1!A1',
            propertyPath: ['value'],
          },
          base: { kind: 'value', value: null },
          ours: { kind: 'value', value: 'ours' },
          theirs: { kind: 'value', value: formulaValue },
          resolutionOptions: [
            expect.objectContaining({
              kind: 'acceptOurs',
              value: { kind: 'value', value: 'ours' },
            }),
            expect.objectContaining({
              kind: 'acceptTheirs',
              value: { kind: 'value', value: formulaValue },
            }),
            expect.objectContaining({
              kind: 'acceptBase',
              value: { kind: 'value', value: null },
            }),
          ],
        },
      ],
    });
    expect(reversed).toMatchObject({
      status: 'conflicted',
      conflicts: [
        {
          ours: { kind: 'value', value: formulaValue },
          theirs: { kind: 'value', value: 'ours' },
        },
      ],
    });
    if (forward.status !== 'conflicted' || reversed.status !== 'conflicted') {
      throw new Error('expected both value-vs-formula previews to conflict');
    }
    expect(forward.conflicts[0].conflictId).toBe(reversed.conflicts[0].conflictId);
    expect(forward.conflicts[0].conflictDigest).toBe(reversed.conflicts[0].conflictDigest);
    expect(forward.conflicts[0].structural).toEqual(reversed.conflicts[0].structural);
    expect(forward.conflicts[0].resolutionOptions.map((option) => option.optionId)).toEqual(
      reversed.conflicts[0].resolutionOptions.map((option) => option.optionId),
    );
  });

  it('orders clean disjoint changes by merge policy rather than branch role', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-b1', 'cells.values', 'sheet-1!B1', [], null, 'ready'),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        valueChange('theirs-a1', 'cell', 'sheet-1!A1', ['value'], 1, 2),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge({
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: graph.theirsCommitId,
    });

    expect(result).toMatchObject({
      status: 'clean',
      changes: [
        expect.objectContaining({
          structural: expect.objectContaining({ entityId: 'sheet-1!A1' }),
        }),
        expect.objectContaining({
          structural: expect.objectContaining({ entityId: 'sheet-1!B1' }),
        }),
      ],
    });
  });

  it('blocks disjoint metadata-domain changes the materializer cannot apply', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-sheet-name', 'sheet', 'sheet-1', ['name'], 'Sheet1', 'Forecast'),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        valueChange(
          'theirs-filter-state',
          'filters',
          'sheet-1:auto-filter',
          ['state'],
          'none',
          'active',
        ),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge({
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: graph.theirsCommitId,
    });

    expect(result).toMatchObject({
      status: 'blocked',
      changes: [],
      conflicts: [],
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_MERGE_UNSUPPORTED_DOMAIN',
          payload: expect.objectContaining({
            domain: 'sheet',
            propertyPath: 'name',
          }),
        }),
      ],
      mutationGuarantee: 'preview-only',
    });
    expect(JSON.stringify(result)).not.toContain('Forecast');
    expect(JSON.stringify(result)).not.toContain('active');
  });

  it('blocks same-property metadata-domain changes before conflict classification', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-sheet-name', 'sheet', 'sheet-1', ['name'], 'Sheet1', 'Forecast'),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        valueChange('theirs-sheet-name', 'sheet', 'sheet-1', ['name'], 'Sheet1', 'Budget'),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge({
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: graph.theirsCommitId,
    });

    expect(result).toMatchObject({
      status: 'blocked',
      changes: [],
      conflicts: [],
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_MERGE_UNSUPPORTED_DOMAIN',
          payload: expect.objectContaining({
            domain: 'sheet',
            propertyPath: 'name',
          }),
        }),
      ],
      mutationGuarantee: 'preview-only',
    });
    expect(JSON.stringify(result)).not.toContain('Forecast');
    expect(JSON.stringify(result)).not.toContain('Budget');
  });

  it('blocks unsupported semantic domains without fabricating merge output', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-pivot-source', 'pivot-tables', 'pivot-1', ['source'], 'A1:B10', 'C1:D10'),
      ]),
      theirsSemanticPayload: validSemanticPayload([]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge({
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: graph.theirsCommitId,
    });

    expect(result).toMatchObject({
      status: 'blocked',
      changes: [],
      conflicts: [],
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_MERGE_UNSUPPORTED_DOMAIN' })],
      mutationGuarantee: 'preview-only',
    });
    expect(JSON.stringify(result)).not.toContain('C1:D10');
  });

  it.each([
    [
      'empty domain',
      valueChange('ours-empty-domain', '', 'sheet-1', ['name'], 'Sheet1', 'Forecast'),
    ],
    ['empty entity', valueChange('ours-empty-entity', 'sheet', '', ['name'], 'Sheet1', 'Forecast')],
    [
      'empty property path',
      valueChange('ours-empty-property', 'sheet', 'sheet-1', [], 'Sheet1', 'Forecast'),
    ],
  ])('blocks malformed semantic records with %s', async (_label, change) => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([change]),
      theirsSemanticPayload: validSemanticPayload([]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge({
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: graph.theirsCommitId,
    });

    expect(result).toMatchObject({
      status: 'blocked',
      changes: [],
      conflicts: [],
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_UNSUPPORTED_SCHEMA' })],
      mutationGuarantee: 'preview-only',
    });
    expect(JSON.stringify(result)).not.toContain('Forecast');
  });

  it('blocks redacted semantic records before classification', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        {
          ...valueChange('ours-a1', 'cell', 'sheet-1!A1', ['value'], 1, 2),
          after: { kind: 'redacted', reason: 'redaction-policy' },
        },
      ]),
      theirsSemanticPayload: validSemanticPayload([]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    await expect(
      service.merge({
        base: graph.rootCommitId,
        ours: graph.oursCommitId,
        theirs: graph.theirsCommitId,
      }),
    ).resolves.toMatchObject({
      status: 'blocked',
      changes: [],
      conflicts: [],
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_REDACTION_VIOLATION' })],
    });
  });

  it('blocks unsupported semantic change-set schemas', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: { schemaVersion: 2, changes: [] },
      theirsSemanticPayload: validSemanticPayload([]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    await expect(
      service.merge({
        base: graph.rootCommitId,
        ours: graph.oursCommitId,
        theirs: graph.theirsCommitId,
      }),
    ).resolves.toMatchObject({
      status: 'blocked',
      changes: [],
      conflicts: [],
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_UNSUPPORTED_SCHEMA' })],
    });
  });
});
