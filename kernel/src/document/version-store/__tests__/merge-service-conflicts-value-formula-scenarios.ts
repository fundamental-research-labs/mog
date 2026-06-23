import {
  createMergeServiceConflictGraph,
  validSemanticPayload,
  valueChange,
} from './merge-service-conflicts-helpers';

export function registerMergeServiceConflictValueFormulaScenarios() {
  it('classifies value-vs-formula same-cell edits as stable conflicts', async () => {
    const formulaValue = { kind: 'formula', formula: '=1+1', result: 2 };
    const { graph, service } = await createMergeServiceConflictGraph({
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
}
