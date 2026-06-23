import {
  createMergeServiceConflictGraph,
  validSemanticPayload,
  valueChange,
} from './merge-service-conflicts-helpers';

export function registerMergeServiceConflictCellValueScenarios() {
  it('classifies same-property cells.values edits as conflicts', async () => {
    const { graph, service } = await createMergeServiceConflictGraph({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-a1', 'cell', 'sheet-1!A1', ['value'], 1, 2),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        valueChange('theirs-a1', 'cell', 'sheet-1!A1', ['value'], 1, 3),
      ]),
    });

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
    const { graph, service } = await createMergeServiceConflictGraph({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-a1-random-source-id', 'cell', 'sheet-1!A1', ['value'], 1, 2),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        valueChange('theirs-a1-different-source-id', 'cells.values', 'sheet-1!A1', [], 1, 3),
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
}
