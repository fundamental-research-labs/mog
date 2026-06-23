import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { createInMemoryWorkbookCommitStore } from '../commit-store';
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
  documentId: 'document-merge-semantic',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

const CREATED_AT = '2026-06-22T00:00:00.000Z';

describe('WorkbookVersionMergeService first-slice semantic records', () => {
  it('previews disjoint cells.formulas and rows-columns records as clean changes', async () => {
    const formulaValue = { kind: 'formula', formula: '=SUM(A1:A2)', result: 3 };
    const rowInsert = rowColumnOrderChange('theirs-row-insert', 'sheet-1', 'row', 1, false, true);
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange(
          'ours-c1-formula',
          'cells.formulas',
          'sheet-1!C1',
          ['formula'],
          null,
          formulaValue,
        ),
      ]),
      theirsSemanticPayload: validSemanticPayload([rowInsert]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge({
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: graph.theirsCommitId,
    });

    expect(result).toMatchObject({
      status: 'clean',
      changes: expect.arrayContaining([
        expect.objectContaining({
          structural: expect.objectContaining({
            domain: 'cells.formulas',
            entityId: 'sheet-1!C1',
            propertyPath: ['formula'],
          }),
          merged: { kind: 'value', value: formulaValue },
        }),
        expect.objectContaining({
          structural: expect.objectContaining({
            domain: 'rows-columns',
            entityId: 'sheet-1!row:1',
            propertyPath: ['order'],
          }),
          merged: rowInsert.after,
        }),
      ]),
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    });
  });

  it('classifies cells.formulas same-property records as stable conflicts', async () => {
    const oursFormula = { kind: 'formula', formula: '=A1+1', result: 2 };
    const theirsFormula = { kind: 'formula', formula: '=A1+2', result: 3 };
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange(
          'ours-c1-formula',
          'cells.formulas',
          'sheet-1!C1',
          ['formula'],
          null,
          oursFormula,
        ),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        valueChange('theirs-c1-formula', 'cells.formulas', 'sheet-1!C1', [], null, theirsFormula),
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
            domain: 'cells.formulas',
            entityId: 'sheet-1!C1',
            propertyPath: ['formula'],
          },
          base: { kind: 'value', value: null },
          ours: { kind: 'value', value: oursFormula },
          theirs: { kind: 'value', value: theirsFormula },
        },
      ],
    });
    if (forward.status !== 'conflicted' || reversed.status !== 'conflicted') {
      throw new Error('expected both formula previews to conflict');
    }
    expect(forward.conflicts[0].conflictId).toBe(reversed.conflicts[0].conflictId);
    expect(forward.conflicts[0].conflictDigest).toBe(reversed.conflicts[0].conflictDigest);
    expect(forward.conflicts[0].structural).toEqual(reversed.conflicts[0].structural);
  });

  it('classifies rows-columns same-order records as stable conflicts', async () => {
    const rowValue = rowColumnValue('sheet-1', 'row', 1);
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        rowColumnOrderChange('ours-row-delete', 'sheet-1', 'row', 1, true, false),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        rowColumnOrderChange('theirs-row-keep', 'sheet-1', 'row', 1, true, true),
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
            domain: 'rows-columns',
            entityId: 'sheet-1!row:1',
            propertyPath: ['order'],
          },
          base: { kind: 'value', value: rowValue },
          ours: { kind: 'value', value: null },
          theirs: { kind: 'value', value: rowValue },
        },
      ],
    });
    if (forward.status !== 'conflicted' || reversed.status !== 'conflicted') {
      throw new Error('expected both rows-columns previews to conflict');
    }
    expect(forward.conflicts[0].conflictId).toBe(reversed.conflicts[0].conflictId);
    expect(forward.conflicts[0].conflictDigest).toBe(reversed.conflicts[0].conflictDigest);
    expect(forward.conflicts[0].structural).toEqual(reversed.conflicts[0].structural);
  });

  it('blocks opaque semantic diff records without leaking object identity', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        {
          changeId: 'opaque-formula-change',
          kind: 'updated',
          domainId: 'cells.formulas',
          objectId: 'formula:cell:secret-a1',
          objectKind: 'cell-formula',
          beforeDigest: { algorithm: 'opaque', value: 'opaque-before-secret' },
          afterDigest: { algorithm: 'opaque', value: 'opaque-after-secret' },
        },
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
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_MERGE_UNSUPPORTED_DOMAIN',
          payload: expect.objectContaining({
            domain: 'cells.formulas',
            objectKind: 'cell-formula',
            reason: 'opaqueSemanticDiffRecord',
          }),
        }),
      ],
      mutationGuarantee: 'preview-only',
    });
    expect(JSON.stringify(result)).not.toContain('formula:cell:secret-a1');
    expect(JSON.stringify(result)).not.toContain('opaque-before-secret');
    expect(JSON.stringify(result)).not.toContain('opaque-after-secret');
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

function rowColumnOrderChange(
  changeId: string,
  sheetId: string,
  axis: 'row' | 'column',
  index: number,
  beforePresent: boolean,
  afterPresent: boolean,
) {
  const value = rowColumnValue(sheetId, axis, index);
  return {
    changeId,
    domain: 'rows-columns',
    entityId: `${sheetId}!${axis}:${index}`,
    propertyPath: ['order'],
    before: { kind: 'value', value: beforePresent ? value : null },
    after: { kind: 'value', value: afterPresent ? value : null },
    display: { address: { kind: 'value', value: displayRef(axis, index) } },
  };
}

function rowColumnValue(sheetId: string, axis: 'row' | 'column', index: number) {
  return {
    kind: 'object',
    fields: [
      { key: 'axis', value: axis },
      { key: 'sheetId', value: sheetId },
      { key: 'index', value: index },
      { key: 'displayRef', value: displayRef(axis, index) },
    ],
  };
}

function displayRef(axis: 'row' | 'column', index: number): string {
  if (axis === 'row') return `${index + 1}:${index + 1}`;
  const label = columnLabel(index);
  return `${label}:${label}`;
}

function columnLabel(index: number): string {
  let current = index + 1;
  let label = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = `${String.fromCharCode(65 + remainder)}${label}`;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}
