import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { createInMemoryWorkbookCommitStore } from '../commit-store';
import { intentIdForMergeResultId } from '../merge-apply-intent-store';
import { mergePreviewArtifactRef } from '../merge-attempt-artifacts';
import { createWorkbookVersionMergeService } from '../merge-service';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { VersionObjectType, WorkbookCommitId } from '../object-digest';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../provider';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

const CREATED_AT = '2026-06-20T00:00:00.000Z';

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

  it('classifies descendant theirs commits as fast-forward previews', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-a1', 'cell', 'sheet-1!A1', ['value'], 1, 2),
      ]),
      theirsSemanticPayload: validSemanticPayload([]),
    });
    const theirsDescendantCommitId = await createDetachedChild(graph, {
      label: 'theirs-descendant',
      parentCommitId: graph.oursCommitId,
      semanticPayload: validSemanticPayload([
        valueChange('theirs-descendant-b1', 'cell', 'sheet-1!B1', ['value'], null, 'ready'),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    await expect(
      service.merge({
        base: graph.rootCommitId,
        ours: graph.oursCommitId,
        theirs: theirsDescendantCommitId,
      }),
    ).resolves.toMatchObject({
      status: 'fastForward',
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: theirsDescendantCommitId,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    });
  });

  it('persists applyable fast-forward preview intents when requested', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-a1', 'cell', 'sheet-1!A1', ['value'], 1, 2),
      ]),
      theirsSemanticPayload: validSemanticPayload([]),
    });
    const theirsDescendantCommitId = await createDetachedChild(graph, {
      label: 'theirs-descendant',
      parentCommitId: graph.oursCommitId,
      semanticPayload: validSemanticPayload([
        valueChange('theirs-descendant-b1', 'cell', 'sheet-1!B1', ['value'], null, 'ready'),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge(
      {
        base: graph.rootCommitId,
        ours: graph.oursCommitId,
        theirs: theirsDescendantCommitId,
      },
      {
        mode: 'preview',
        targetRef: 'refs/heads/main' as any,
        expectedTargetHead: {
          commitId: graph.oursCommitId,
          revision: { kind: 'counter', value: '1' },
        },
        persistReviewRecord: true,
      },
    );

    expect(result).toMatchObject({
      status: 'fastForward',
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: theirsDescendantCommitId,
      attemptPersistence: 'persisted',
      attemptKind: 'applyable',
      targetRef: 'refs/heads/main',
      expectedTargetHead: {
        commitId: graph.oursCommitId,
        revision: { kind: 'counter', value: '1' },
      },
      resultDigest: {
        algorithm: 'sha256',
        digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      previewArtifactDigest: {
        algorithm: 'sha256',
        digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      resultId: expect.stringMatching(/^merge-result:[0-9a-f]{64}$/),
    });
    if (
      result.status !== 'fastForward' ||
      !result.resultId ||
      !result.resultDigest ||
      !result.previewArtifactDigest
    ) {
      throw new Error('expected a persisted fast-forward merge result id and digest');
    }
    const opened = await graph.provider.openGraph(graph.namespace);
    await expect(
      opened.getObjectRecord(mergePreviewArtifactRef(result.previewArtifactDigest)),
    ).resolves.toMatchObject({
      preimage: {
        payload: {
          recordKind: 'mergePreview',
          status: 'fastForward',
          base: graph.rootCommitId,
          ours: graph.oursCommitId,
          theirs: theirsDescendantCommitId,
        },
      },
    });

    const intentId = intentIdForMergeResultId(result.resultId);
    if (!intentId) throw new Error('expected persisted result id to map to an intent id');
    const resolvedAttemptDigest = result.resultId.slice('merge-result:'.length);
    const store = await graph.provider.openMergeApplyIntentStore(graph.namespace);
    const read = await store.readByIntentId(intentId);
    expect(read).toMatchObject({
      status: 'found',
      record: {
        intentId,
        applyKind: 'fastForward',
        base: graph.rootCommitId,
        ours: graph.oursCommitId,
        theirs: theirsDescendantCommitId,
        targetRef: 'refs/heads/main',
        expectedTargetHead: {
          commitId: graph.oursCommitId,
          revision: { kind: 'counter', value: '1' },
        },
        resultDigest: result.resultDigest,
        resolutionSetDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        resolvedAttemptDigest: {
          algorithm: 'sha256',
          digest: resolvedAttemptDigest,
        },
      },
    });

    await expect(
      service.merge(
        {
          base: graph.rootCommitId,
          ours: graph.oursCommitId,
          theirs: theirsDescendantCommitId,
        },
        {
          mode: 'preview',
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead: {
            commitId: graph.oursCommitId,
            revision: { kind: 'counter', value: '1' },
          },
          persistReviewRecord: true,
        },
      ),
    ).resolves.toMatchObject({
      status: 'fastForward',
      resultId: result.resultId,
      resultDigest: result.resultDigest,
      attemptPersistence: 'persisted',
      attemptKind: 'applyable',
    });

    await expect(
      store.completeIntent({
        intentId,
        resolvedAttemptDigest: {
          algorithm: 'sha256',
          digest: resolvedAttemptDigest,
        },
        completedAt: '2026-06-21T00:00:01.000Z',
        terminal: {
          status: 'fastForwarded',
          headBefore: graph.oursCommitId,
          headAfter: theirsDescendantCommitId,
          commitId: theirsDescendantCommitId,
        },
      }),
    ).resolves.toMatchObject({ status: 'completed' });
    await expect(
      service.merge(
        {
          base: graph.rootCommitId,
          ours: graph.oursCommitId,
          theirs: theirsDescendantCommitId,
        },
        {
          mode: 'preview',
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead: {
            commitId: graph.oursCommitId,
            revision: { kind: 'counter', value: '1' },
          },
          persistReviewRecord: true,
        },
      ),
    ).resolves.toMatchObject({
      status: 'fastForward',
      resultId: result.resultId,
      resultDigest: result.resultDigest,
      attemptPersistence: 'persisted',
      attemptKind: 'applyable',
    });
  });

  it('classifies incoming commits already reachable from ours as already merged', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ancestor-a1', 'cell', 'sheet-1!A1', ['value'], 1, 2),
      ]),
      theirsSemanticPayload: validSemanticPayload([]),
    });
    const oursDescendantCommitId = await createDetachedChild(graph, {
      label: 'ours-descendant',
      parentCommitId: graph.oursCommitId,
      semanticPayload: validSemanticPayload([
        valueChange('ours-descendant-b1', 'cell', 'sheet-1!B1', ['value'], null, 'kept'),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    await expect(
      service.merge({
        base: graph.rootCommitId,
        ours: oursDescendantCommitId,
        theirs: graph.oursCommitId,
      }),
    ).resolves.toMatchObject({
      status: 'alreadyMerged',
      base: graph.rootCommitId,
      ours: oursDescendantCommitId,
      theirs: graph.oursCommitId,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    });
  });

  it('blocks commits that are not direct children of the requested base', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-a1', 'cell', 'sheet-1!A1', ['value'], 1, 2),
      ]),
      theirsSemanticPayload: validSemanticPayload([]),
    });
    const grandchildCommitId = await createDetachedChild(graph, {
      label: 'grandchild',
      parentCommitId: graph.oursCommitId,
      semanticPayload: validSemanticPayload([
        valueChange('grandchild-a1', 'cell', 'sheet-1!A1', ['value'], 2, 4),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    await expect(
      service.merge({
        base: graph.rootCommitId,
        ours: grandchildCommitId,
        theirs: graph.theirsCommitId,
      }),
    ).resolves.toMatchObject({
      status: 'blocked',
      changes: [],
      conflicts: [],
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_MERGE_UNSUPPORTED_ANCESTRY' })],
    });
  });
});

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

async function graphWithRootAndDetachedChildren(options: {
  readonly oursSemanticPayload: unknown;
  readonly theirsSemanticPayload: unknown;
}) {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
  const rootCommitId = initialized.rootCommit.id;
  const graph = { provider, namespace, rootCommitId };

  const oursCommitId = await createDetachedChild(graph, {
    label: 'ours',
    parentCommitId: rootCommitId,
    semanticPayload: options.oursSemanticPayload,
  });
  const theirsCommitId = await createDetachedChild(graph, {
    label: 'theirs',
    parentCommitId: rootCommitId,
    semanticPayload: options.theirsSemanticPayload,
  });

  return {
    provider,
    namespace,
    rootCommitId,
    oursCommitId,
    theirsCommitId,
  };
}

async function createDetachedChild(
  graph: {
    readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
    readonly namespace: VersionGraphNamespace;
  },
  options: {
    readonly label: string;
    readonly parentCommitId: WorkbookCommitId;
    readonly semanticPayload: unknown;
  },
): Promise<WorkbookCommitId> {
  const opened = await graph.provider.openGraph(graph.namespace);
  const commitStore = createInMemoryWorkbookCommitStore(opened.objectStore);
  const created = await commitStore.createWorkbookCommit({
    documentId: graph.namespace.documentId,
    parentCommitIds: [options.parentCommitId],
    snapshotRootRecord: await objectRecord(graph.namespace, 'workbook.snapshotRoot.v1', {
      label: options.label,
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(
      graph.namespace,
      'workbook.semanticChangeSet.v1',
      options.semanticPayload,
    ),
    mutationSegmentRecords: [
      await objectRecord(graph.namespace, 'workbook.mutationSegment.v1', {
        segmentId: `${options.label}-segment-1`,
      }),
    ],
    author: AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
  });
  if (created.status !== 'success') {
    throw new Error(`expected detached child commit success: ${created.diagnostics[0]?.code}`);
  }
  return created.commit.id;
}

async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        schemaVersion: 1,
        changes: [],
      }),
      author: AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

function validSemanticPayload(changes: readonly unknown[]) {
  return {
    schemaVersion: 1,
    changes,
  };
}

function valueChange(
  changeId: string,
  domain: string,
  entityId: string,
  propertyPath: readonly string[],
  before: unknown,
  after: unknown,
) {
  return {
    changeId,
    domain,
    entityId,
    propertyPath,
    before: { kind: 'value', value: before },
    after: { kind: 'value', value: after },
    display: {
      address: { kind: 'value', value: entityId.split('!')[1] ?? entityId },
    },
  };
}
