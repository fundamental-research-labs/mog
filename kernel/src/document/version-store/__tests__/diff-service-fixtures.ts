import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  type CommitVersionGraphInput,
  type VersionGraphNamespace,
} from '../graph-store';
import {
  createVersionObjectRecord,
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
import type { RefVersion } from '../ref-store';

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

export type DiffServiceProvider = ReturnType<typeof createInMemoryVersionStoreProvider>;

export async function graphWithRootAndChild(options: { readonly semanticPayload: unknown }) {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
  expectInitializeSuccess(initialized);
  const appended = await appendChild(
    {
      provider,
      namespace: namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'),
      rootCommitId: initialized.rootCommit.id,
      headCommitId: initialized.rootCommit.id,
      headRevision: initialized.initialHead.revision,
    },
    {
      label: 'child',
      semanticPayload: options.semanticPayload,
    },
  );
  return {
    provider,
    namespace: namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'),
    rootCommitId: initialized.rootCommit.id,
    childCommitId: appended.childCommitId,
  };
}

export function providerWithPermutedSemanticReads(
  provider: DiffServiceProvider,
  permutations: readonly (readonly number[])[],
): DiffServiceProvider {
  let readCount = 0;
  return {
    documentScope: provider.documentScope,
    accessContext: provider.accessContext,
    capabilities: provider.capabilities,
    readGraphRegistry: () => provider.readGraphRegistry(),
    initializeGraph: (input) => provider.initializeGraph(input),
    scanDocumentIntegrity: (options) => provider.scanDocumentIntegrity(options),
    close: (reason) => provider.close(reason),
    dispose: (reason) => provider.dispose(reason),
    openGraph: async (namespace, accessContext) => {
      const graph = await provider.openGraph(namespace, accessContext);
      return new Proxy(graph, {
        get(target, property, receiver) {
          if (property === 'getObjectRecord') {
            return async <TPayload>(ref: Parameters<typeof graph.getObjectRecord<TPayload>>[0]) => {
              const record = await graph.getObjectRecord<TPayload>(ref);
              if (record.preimage.objectType !== 'workbook.semanticChangeSet.v1') return record;
              const payload = record.preimage.payload;
              if (!isRecord(payload)) return record;
              const permutation = permutations[readCount++ % permutations.length] ?? [];
              return {
                ...record,
                preimage: {
                  ...record.preimage,
                  payload: {
                    ...payload,
                    ...(Array.isArray(payload.changes)
                      ? { changes: permute(payload.changes, permutation) }
                      : {}),
                    ...(Array.isArray(payload.reviewChanges)
                      ? { reviewChanges: permute(payload.reviewChanges, permutation) }
                      : {}),
                  } as TPayload,
                },
              };
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
}

export async function appendChild(
  graph: {
    readonly provider: DiffServiceProvider;
    readonly namespace: VersionGraphNamespace;
    readonly rootCommitId?: WorkbookCommitId;
    readonly headCommitId?: WorkbookCommitId;
    readonly headRevision?: RefVersion;
  },
  options: {
    readonly label: string;
    readonly semanticPayload: unknown;
  },
): Promise<{ readonly childCommitId: WorkbookCommitId }> {
  const opened = await graph.provider.openGraph(graph.namespace);
  const head = await opened.readHead();
  if (head.status !== 'success') throw new Error('expected graph head before append');

  const committed = await opened.commit(
    await commitInput(
      graph.namespace,
      options.label,
      options.semanticPayload,
      head.head.id,
      head.head.refRevision as RefVersion,
    ),
  );
  if (committed.status !== 'success') {
    throw new Error(`expected commit success: ${committed.diagnostics[0]?.code}`);
  }
  return { childCommitId: committed.commit.id };
}

export function validSemanticPayload(label: string, changes: readonly unknown[]) {
  return {
    schemaVersion: 1,
    label,
    changes,
  };
}

export function vc06SemanticChanges() {
  return [
    semanticRecord({
      changeId: 'vc06-named-range-definition',
      domain: 'named-ranges',
      entityId: 'name:RevenueTotal',
      propertyPath: ['definition'],
      before: null,
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'name', value: 'RevenueTotal' },
      ]),
      display: redactedEntityLabelDisplay(),
    }),
    semanticRecord({
      changeId: 'vc06-table-definition',
      domain: 'tables',
      entityId: 'sheet-1!table:table-sales',
      propertyPath: ['definition'],
      before: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'tableId', value: 'table-sales' },
        { key: 'name', value: 'SalesTable' },
        { key: 'sheetId', value: 'sheet-1' },
      ]),
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'tableId', value: 'table-sales' },
        { key: 'name', value: 'SalesTable' },
        { key: 'sheetId', value: 'sheet-1' },
      ]),
      display: entityLabelDisplay('SalesTable'),
    }),
    semanticRecord({
      changeId: 'vc06-comment-cell',
      domain: 'comments-notes',
      entityId: 'sheet-1!comment:cell-b2',
      propertyPath: ['cell'],
      before: null,
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'cellId', value: 'cell-b2' },
        { key: 'address', value: 'B2' },
      ]),
      display: sheetAddressDisplay('Sheet1', 'B2'),
    }),
    semanticRecord({
      changeId: 'vc06-conditional-format-rule',
      domain: 'conditional-formatting',
      entityId: 'sheet-1!cf:cf-top-10',
      propertyPath: ['rule'],
      before: null,
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'ruleId', value: 'cf-top-10' },
      ]),
      display: entityLabelDisplay('cf-top-10'),
    }),
    semanticRecord({
      changeId: 'vc06-data-validation-range',
      domain: 'data-validation',
      entityId: 'sheet-1!range:dv-status',
      propertyPath: ['range'],
      before: null,
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'rangeKind', value: 'Validation' },
        { key: 'rangeId', value: 'dv-status' },
        { key: 'encoding', value: 'mog-range-meta-json-v1' },
        { key: 'rowCount', value: 19 },
        { key: 'colCount', value: 1 },
        {
          key: 'anchor',
          value: semanticObject([
            { key: 'kind', value: 'Elastic' },
            { key: 'startRow', value: 1 },
            { key: 'endRow', value: 19 },
            { key: 'startCol', value: 4 },
            { key: 'endCol', value: 4 },
          ]),
        },
      ]),
      display: entityLabelDisplay('Validation:dv-status'),
    }),
    semanticRecord({
      changeId: 'vc06-filter-state',
      domain: 'filters',
      entityId: 'sheet-1!filter:auto-filter-1',
      propertyPath: ['state'],
      before: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'filterId', value: 'auto-filter-1' },
        { key: 'hasActiveFilter', value: false },
        { key: 'visibleRowCount', value: 20 },
      ]),
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'filterId', value: 'auto-filter-1' },
        { key: 'filterKind', value: 'autoFilter' },
        { key: 'hasActiveFilter', value: true },
        { key: 'hiddenRowCount', value: 3 },
        { key: 'visibleRowCount', value: 17 },
      ]),
      display: entityLabelDisplay('sheet-1!filter:auto-filter-1'),
    }),
    semanticRecord({
      changeId: 'vc06-sort-order',
      domain: 'sorts',
      entityId: 'sheet-1!A1:D20',
      propertyPath: ['order'],
      before: null,
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'range', value: 'A1:D20' },
        { key: 'rowsMoved', value: 6 },
      ]),
      display: addressDisplay('A1:D20'),
    }),
    semanticRecord({
      changeId: 'vc06-chart-source-range',
      domain: 'charts.source-range',
      entityId: 'sheet-1!chart:chart-sales',
      propertyPath: ['sourceRange'],
      before: semanticObject([
        { key: 'kind', value: 'updated' },
        { key: 'objectId', value: 'chart-sales' },
        { key: 'objectType', value: 'chart' },
        { key: 'dataRange', value: 'Sheet1!$A$1:$C$20' },
        { key: 'categoryRange', value: 'Sheet1!$A$2:$A$20' },
      ]),
      after: semanticObject([
        { key: 'kind', value: 'updated' },
        { key: 'objectId', value: 'chart-sales' },
        { key: 'objectType', value: 'chart' },
        { key: 'dataRange', value: 'Sheet1!$A$1:$D$20' },
        { key: 'categoryRange', value: 'Sheet1!$A$2:$A$20' },
        { key: 'changedFields', value: { kind: 'array', values: ['dataRange'] } },
      ]),
      display: entityLabelDisplay('chart-sales'),
    }),
    semanticRecord({
      changeId: 'vc06-floating-object-anchor',
      domain: 'floating-objects.anchors',
      entityId: 'sheet-1!object:shape-logo',
      propertyPath: ['anchor'],
      before: semanticObject([
        { key: 'kind', value: 'updated' },
        { key: 'objectId', value: 'shape-logo' },
        { key: 'objectType', value: 'shape' },
        {
          key: 'anchor',
          value: semanticObject([
            { key: 'anchorRow', value: 1 },
            { key: 'anchorCol', value: 1 },
            { key: 'anchorMode', value: 'twoCell' },
          ]),
        },
        { key: 'width', value: 120 },
        { key: 'height', value: 80 },
      ]),
      after: semanticObject([
        { key: 'kind', value: 'updated' },
        { key: 'objectId', value: 'shape-logo' },
        { key: 'objectType', value: 'shape' },
        { key: 'changedFields', value: { kind: 'array', values: ['anchor', 'width'] } },
        {
          key: 'anchor',
          value: semanticObject([
            { key: 'anchorRow', value: 2 },
            { key: 'anchorCol', value: 3 },
            { key: 'anchorMode', value: 'twoCell' },
          ]),
        },
        { key: 'width', value: 160 },
        { key: 'height', value: 80 },
      ]),
      display: entityLabelDisplay('shape-logo'),
    }),
  ];
}

export function semanticRecord(input: {
  readonly changeId: string;
  readonly domain: string;
  readonly entityId: string;
  readonly propertyPath: readonly string[];
  readonly before: unknown;
  readonly after: unknown;
  readonly display: unknown;
  readonly pageCursorOrderKey?: unknown;
}) {
  return {
    ...(input.pageCursorOrderKey ? { pageCursorOrderKey: input.pageCursorOrderKey } : {}),
    structural: {
      kind: 'metadata',
      changeId: input.changeId,
      domain: input.domain,
      entityId: input.entityId,
      propertyPath: [...input.propertyPath],
    },
    before: { kind: 'value', value: input.before },
    after: { kind: 'value', value: input.after },
    display: input.display,
  };
}

export function semanticObject(
  fields: readonly { readonly key: string; readonly value: unknown }[],
) {
  return {
    kind: 'object',
    fields: fields.map((field) => ({ key: field.key, value: field.value })),
  };
}

export function entityLabelDisplay(value: string) {
  return {
    entityLabel: { kind: 'value', value },
  };
}

export function redactedEntityLabelDisplay() {
  return {
    entityLabel: { kind: 'redacted', reason: 'redaction-policy' },
  };
}

export function addressDisplay(value: string) {
  return {
    address: { kind: 'value', value },
  };
}

export function sheetAddressDisplay(sheetName: string, address: string) {
  return {
    sheetName: { kind: 'value', value: sheetName },
    address: { kind: 'value', value: address },
  };
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.issueCode}`);
  }
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

async function commitInput(
  namespace: VersionGraphNamespace,
  label: string,
  semanticPayload: unknown,
  expectedHeadCommitId: WorkbookCommitId,
  expectedMainRefVersion: RefVersion,
): Promise<CommitVersionGraphInput> {
  return {
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label,
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(
      namespace,
      'workbook.semanticChangeSet.v1',
      semanticPayload,
    ),
    mutationSegmentRecords: [
      await objectRecord(namespace, 'workbook.mutationSegment.v1', {
        segmentId: `${label}-segment-1`,
      }),
    ],
    author: AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
    expectedHeadCommitId,
    expectedMainRefVersion,
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function permute<T>(values: readonly T[], permutation: readonly number[]): readonly T[] {
  if (permutation.length !== values.length) return values;
  return permutation.map((index) => values[index]).filter((value) => value !== undefined);
}
