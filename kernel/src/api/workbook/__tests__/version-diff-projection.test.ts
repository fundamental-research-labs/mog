import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { createWorkbookVersionDiffService } from '../../../document/version-store/diff-service';
import type {
  VersionObjectType,
  WorkbookCommitId,
} from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionStoreProvider,
} from '../../../document/version-store/provider';
import type { RefVersion } from '../../../document/version-store/ref-store';
import { WorkbookVersionImpl } from '../version';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'version-diff-projection',
  principalScope: 'principal-1',
};
const CREATED_AT = '2026-06-20T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

describe('WorkbookVersion public semantic diff projection', () => {
  it('projects multi-sheet edits and sheet rename/add/delete changes', async () => {
    const changes = [
      semanticRecord({
        changeId: 'cell-alpha-a1',
        domain: 'cell',
        entityId: 'sheet-alpha!A1',
        propertyPath: ['value'],
        before: null,
        after: 'North',
        display: sheetAddressDisplay('North', 'A1'),
      }),
      semanticRecord({
        changeId: 'cell-beta-b2',
        domain: 'cell',
        entityId: 'sheet-beta!B2',
        propertyPath: ['value'],
        before: 10,
        after: 20,
        display: sheetAddressDisplay('South', 'B2'),
      }),
      semanticRecord({
        changeId: 'sheet-beta-rename',
        domain: 'sheet',
        entityId: 'sheet-beta',
        propertyPath: ['name'],
        before: 'South',
        after: 'Forecast',
        display: entityLabelDisplay('Forecast'),
      }),
      semanticRecord({
        changeId: 'sheet-beta-tab-color',
        domain: 'sheet',
        entityId: 'sheet-beta',
        propertyPath: ['tabColor'],
        before: null,
        after: '#22c55e',
        display: entityLabelDisplay('Forecast'),
      }),
    ];
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', changes),
    });
    const version = createVersion(provider);

    const result = await version.diff(rootCommitId, childCommitId);

    expect(result).toMatchObject({
      ok: true,
      value: {
        items: changes,
        readRevision: { kind: 'counter', value: '1' },
        order: 'semantic-change-order',
      },
    });
    if (!result.ok) throw new Error(`expected diff success: ${result.error.code}`);
    expect(result.value.items.map((entry) => entry.structural)).toEqual([
      expect.objectContaining({ domain: 'cell', entityId: 'sheet-alpha!A1' }),
      expect.objectContaining({ domain: 'cell', entityId: 'sheet-beta!B2' }),
      expect.objectContaining({ domain: 'sheet', entityId: 'sheet-beta', propertyPath: ['name'] }),
      expect.objectContaining({ domain: 'sheet', entityId: 'sheet-beta', propertyPath: ['tabColor'] }),
    ]);
  });

  it('projects cross-sheet range fields through the review-safe range boundary', async () => {
    const changes = [
      semanticRecord({
        changeId: 'validation-alpha-range',
        domain: 'data-validation',
        entityId: 'sheet-alpha!range:dv-alpha',
        propertyPath: ['range'],
        before: null,
        after: semanticObject([
          { key: 'kind', value: 'Set' },
          { key: 'rangeKind', value: 'Validation' },
          { key: 'rangeId', value: 'dv-alpha' },
          { key: 'encoding', value: 'mog-range-meta-json-v1' },
          { key: 'rowCount', value: 10 },
          { key: 'colCount', value: 2 },
          {
            key: 'anchor',
            value: semanticObject([
              { key: 'kind', value: 'Elastic' },
              { key: 'startRow', value: 1 },
              { key: 'endRow', value: 10 },
              { key: 'startCol', value: 1 },
              { key: 'endCol', value: 2 },
            ]),
          },
        ]),
        display: entityLabelDisplay('Validation:dv-alpha'),
      }),
      semanticRecord({
        changeId: 'chart-cross-sheet-range',
        domain: 'charts.source-range',
        entityId: 'sheet-beta!chart:chart-1',
        propertyPath: ['sourceRange'],
        before: null,
        after: semanticObject([
          { key: 'kind', value: 'updated' },
          { key: 'objectId', value: 'chart-1' },
          { key: 'objectType', value: 'chart' },
          { key: 'dataRange', value: 'Alpha!$A$1:$B$10' },
          { key: 'categoryRange', value: 'Beta!$C$1:$C$10' },
        ]),
        display: entityLabelDisplay('chart-1'),
      }),
    ];
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', changes),
    });
    const version = createVersion(provider);

    const result = await version.diff(rootCommitId, childCommitId);

    if (!result.ok) throw new Error(`expected diff success: ${result.error.code}`);
    expect(result.value.items.map((entry) => entry.structural)).toEqual([
      expect.objectContaining({
        domain: 'data-validation',
        entityId: 'sheet-alpha!range:dv-alpha',
      }),
      expect.objectContaining({
        domain: 'charts.source-range',
        entityId: 'sheet-beta!chart:chart-1',
      }),
    ]);
    expect((result.value.items[1]?.after as any).value.fields).toEqual(
      expect.arrayContaining([
        { key: 'dataRange', value: 'Alpha!$A$1:$B$10' },
        { key: 'categoryRange', value: 'Beta!$C$1:$C$10' },
      ]),
    );
  });

  it('projects redacted provider entries without leaking raw payload fields', async () => {
    const hiddenSheetName = 'Payroll FY27';
    const hiddenAddress = 'Payroll FY27!B9';
    const changes = [
      {
        structural: { kind: 'redacted', reason: 'redaction-policy' },
        before: { kind: 'redacted', reason: 'historical-acl-unavailable' },
        after: { kind: 'redacted', reason: 'permission-denied' },
        display: {
          sheetName: { kind: 'redacted', reason: 'permission-denied' },
          address: { kind: 'redacted', reason: 'permission-denied' },
          entityLabel: { kind: 'redacted', reason: 'redaction-policy' },
        },
        hiddenSheetName,
        hiddenAddress,
        rawBefore: 'salary-secret',
      },
    ];
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', changes),
    });
    const version = createVersion(provider);

    const result = await version.diff(rootCommitId, childCommitId);

    expect(result).toEqual({
      ok: true,
      value: {
        items: [
          {
            structural: { kind: 'redacted', reason: 'redaction-policy' },
            before: { kind: 'redacted', reason: 'historical-acl-unavailable' },
            after: { kind: 'redacted', reason: 'permission-denied' },
            display: {
              sheetName: { kind: 'redacted', reason: 'permission-denied' },
              address: { kind: 'redacted', reason: 'permission-denied' },
              entityLabel: { kind: 'redacted', reason: 'redaction-policy' },
            },
          },
        ],
        limit: 50,
        readRevision: { kind: 'counter', value: '1' },
        order: 'semantic-change-order',
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(hiddenSheetName);
    expect(serialized).not.toContain(hiddenAddress);
    expect(serialized).not.toContain('salary-secret');
  });

  it('redacts cell coordinates from provider-backed redacted cell values', async () => {
    const hiddenSheetName = 'Payroll FY27';
    const hiddenAddress = 'Payroll FY27!B9';
    const hiddenEntity = 'sheet-payroll-secret!B9';
    const changes = [
      {
        structural: {
          kind: 'metadata',
          changeId: 'payroll-secret-cell',
          domain: 'cell',
          entityId: hiddenEntity,
          propertyPath: ['value'],
        },
        before: { kind: 'redacted', reason: 'permission-denied' },
        after: { kind: 'redacted', reason: 'redaction-policy' },
        display: {
          sheetName: { kind: 'value', value: hiddenSheetName },
          address: { kind: 'value', value: hiddenAddress },
        },
      },
    ];
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', changes),
    });
    const version = createVersion(provider);

    const result = await version.diff(rootCommitId, childCommitId);

    expect(result).toEqual({
      ok: true,
      value: {
        items: [
          {
            structural: { kind: 'redacted', reason: 'permission-denied' },
            before: { kind: 'redacted', reason: 'permission-denied' },
            after: { kind: 'redacted', reason: 'redaction-policy' },
            display: {
              sheetName: { kind: 'redacted', reason: 'permission-denied' },
              address: { kind: 'redacted', reason: 'permission-denied' },
            },
          },
        ],
        limit: 50,
        readRevision: { kind: 'counter', value: '1' },
        order: 'semantic-change-order',
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(hiddenSheetName);
    expect(serialized).not.toContain(hiddenAddress);
    expect(serialized).not.toContain(hiddenEntity);
    expect(serialized).not.toContain('payroll-secret-cell');
  });

  it('rejects unsupported row-domain entries without leaking raw row selectors', async () => {
    const hiddenSheet = 'sheet-payroll-secret';
    const hiddenRow = 'secret-row-17';
    const changes = [
      semanticRecord({
        changeId: 'row-hidden-state',
        domain: 'rows',
        entityId: `${hiddenSheet}!row:17`,
        propertyPath: ['hidden'],
        before: null,
        after: semanticObject([
          { key: 'kind', value: 'Set' },
          { key: 'rowId', value: hiddenRow },
          { key: 'hidden', value: true },
        ]),
        display: entityLabelDisplay('Payroll row 17'),
      }),
    ];
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', changes),
    });
    const version = createVersion(provider);

    const result = await version.diff(rootCommitId, childCommitId);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_UNSUPPORTED_SCHEMA',
            message: 'The requested version diff is not materializable by the attached service.',
            data: expect.objectContaining({
              recoverability: 'repair',
              redacted: true,
              payload: expect.objectContaining({
                operation: 'diff',
              }),
            }),
          }),
        ],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(hiddenSheet);
    expect(serialized).not.toContain(hiddenRow);
    expect(serialized).not.toContain('Payroll row 17');
  });

  it('rejects stale direct commit selectors without exposing the stale id', async () => {
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', [defaultCellChange('child')]),
    });
    const version = createVersion(provider);
    const staleBase = `commit:sha256:${'f'.repeat(64)}` as WorkbookCommitId;

    const result = await version.diff(staleBase, childCommitId);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_MISSING_OBJECT',
            data: expect.objectContaining({
              redacted: true,
              payload: expect.objectContaining({
                operation: 'diff',
                selector: 'base',
              }),
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(staleBase);

    await expect(version.diff(rootCommitId, childCommitId)).resolves.toMatchObject({ ok: true });
  });

  it('rejects ambiguous merge target selectors without exposing parent ids', async () => {
    const graph = await graphWithMergeTarget();
    const version = createVersion(graph.provider);

    const result = await version.diff(graph.oursCommitId, graph.mergeCommitId);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_UNMATERIALIZABLE_COMMIT',
            data: expect.objectContaining({
              redacted: true,
              payload: expect.objectContaining({ operation: 'diff' }),
            }),
          }),
        ],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(graph.oursCommitId);
    expect(serialized).not.toContain(graph.theirsCommitId);
    expect(serialized).not.toContain(graph.mergeCommitId);
  });

  it('paginates deterministically with public cursors across shuffled provider reads', async () => {
    const changes = [
      semanticRecord({
        changeId: 'sheet-beta-rename',
        domain: 'sheet',
        entityId: 'sheet-beta',
        propertyPath: ['name'],
        before: 'Beta',
        after: 'Forecast',
        display: entityLabelDisplay('Forecast'),
        pageCursorOrderKey: {
          domainOrder: 10,
          hashPropertyPath: '/sheets/sheet-beta/name',
          hashIdentity: 'sheet-beta',
          valueClass: 'authored',
        },
      }),
      semanticRecord({
        changeId: 'cell-alpha-a1',
        domain: 'cell',
        entityId: 'sheet-alpha!A1',
        propertyPath: ['value'],
        before: null,
        after: 'A',
        display: sheetAddressDisplay('Alpha', 'A1'),
        pageCursorOrderKey: {
          domainOrder: 20,
          hashPropertyPath: '/sheets/sheet-alpha/cells/A1/value',
          hashIdentity: 'sheet-alpha!A1',
          valueClass: 'authored',
        },
      }),
      semanticRecord({
        changeId: 'cell-gamma-c3',
        domain: 'cell',
        entityId: 'sheet-gamma!C3',
        propertyPath: ['value'],
        before: null,
        after: 'C',
        display: sheetAddressDisplay('Gamma', 'C3'),
        pageCursorOrderKey: {
          domainOrder: 30,
          hashPropertyPath: '/sheets/sheet-gamma/cells/C3/value',
          hashIdentity: 'sheet-gamma!C3',
          valueClass: 'authored',
        },
      }),
    ];
    const graph = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', changes),
    });
    const provider = providerWithPermutedSemanticReads(graph.provider, [
      [2, 0, 1],
      [1, 2, 0],
      [0, 1, 2],
      [2, 1, 0],
    ]);
    const version = createVersion(provider);

    const replay = await version.diff(graph.rootCommitId, graph.childCommitId, { pageSize: 10 });
    if (!replay.ok) throw new Error(`expected replay diff success: ${replay.error.code}`);
    const replayIds = changeIds(replay.value.items);
    expect(replayIds).toEqual(['sheet-beta-rename', 'cell-alpha-a1', 'cell-gamma-c3']);

    const firstPage = await version.diff(graph.rootCommitId, graph.childCommitId, { pageSize: 1 });
    if (!firstPage.ok || !firstPage.value.nextCursor) {
      throw new Error('expected first diff page and cursor');
    }
    const secondPage = await version.diff(graph.rootCommitId, graph.childCommitId, {
      pageSize: 1,
      pageToken: firstPage.value.nextCursor,
    });
    if (!secondPage.ok || !secondPage.value.nextCursor) {
      throw new Error('expected second diff page and cursor');
    }
    const thirdPage = await version.diff(graph.rootCommitId, graph.childCommitId, {
      pageSize: 1,
      pageToken: secondPage.value.nextCursor,
    });
    if (!thirdPage.ok) throw new Error(`expected third diff page success: ${thirdPage.error.code}`);

    expect(
      changeIds([...firstPage.value.items, ...secondPage.value.items, ...thirdPage.value.items]),
    ).toEqual(replayIds);
    expect(thirdPage.value).not.toHaveProperty('nextCursor');
  });
});

function createVersion(provider: VersionStoreProvider): WorkbookVersionImpl {
  return new WorkbookVersionImpl({
    versioning: {
      diffService: createWorkbookVersionDiffService({ provider }),
    },
  } as any);
}

async function graphWithRootAndChild(options: { readonly semanticPayload: unknown }) {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
  const appended = await appendChild(
    {
      provider,
      namespace,
    },
    {
      label: 'child',
      semanticPayload: options.semanticPayload,
    },
  );
  return {
    provider,
    rootCommitId: initialized.rootCommit.id,
    childCommitId: appended.childCommitId,
  };
}

async function graphWithMergeTarget() {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-merge', 'root'));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-merge');
  const graph = await provider.openGraph(namespace);
  const branch = await graph.createBranch({
    name: 'scenario/merge-parent',
    targetCommitId: initialized.rootCommit.id,
    expectedAbsent: true,
    createdBy: AUTHOR,
  });
  if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

  const ours = await graph.commit(
    await commitInput(
      namespace,
      'ours',
      validSemanticPayload('ours', [defaultCellChange('ours')]),
      initialized.rootCommit.id,
      initialized.initialHead.revision,
    ),
  );
  if (ours.status !== 'success')
    throw new Error(`expected ours commit: ${ours.diagnostics[0]?.code}`);

  const theirs = await graph.commit(
    await commitInput(
      namespace,
      'theirs',
      validSemanticPayload('theirs', [defaultCellChange('theirs')]),
      initialized.rootCommit.id,
      branch.branch.ref.refVersion,
      {
        targetRef: 'refs/heads/scenario/merge-parent',
        parentCommitIds: [initialized.rootCommit.id],
      },
    ),
  );
  if (theirs.status !== 'success') {
    throw new Error(`expected theirs commit: ${theirs.diagnostics[0]?.code}`);
  }

  const merge = await graph.mergeCommit({
    ...(await graphContentInput(
      namespace,
      'merge',
      validSemanticPayload('merge', [defaultCellChange('merge')]),
    )),
    expectedHeadCommitId: ours.commit.id,
    expectedMainRefVersion: ours.main.revision,
    mergeParentCommitId: theirs.commit.id,
  });
  if (merge.status !== 'success') {
    throw new Error(`expected merge commit: ${merge.diagnostics[0]?.code}`);
  }

  return {
    provider,
    oursCommitId: ours.commit.id,
    theirsCommitId: theirs.commit.id,
    mergeCommitId: merge.commit.id,
  };
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.issueCode}`);
  }
}

async function appendChild(
  graph: {
    readonly provider: VersionStoreProvider;
    readonly namespace: VersionGraphNamespace;
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

async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      ...(await graphContentInput(namespace, label, validSemanticPayload(label, []))),
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
  expectedRefVersion: RefVersion,
  options: {
    readonly targetRef?: string;
    readonly parentCommitIds?: readonly WorkbookCommitId[];
  } = {},
) {
  return {
    ...(await graphContentInput(namespace, label, semanticPayload)),
    ...(options.targetRef
      ? { targetRef: options.targetRef, expectedTargetRefVersion: expectedRefVersion }
      : { expectedMainRefVersion: expectedRefVersion }),
    ...(options.parentCommitIds ? { parentCommitIds: options.parentCommitIds } : {}),
    expectedHeadCommitId,
  };
}

async function graphContentInput(
  namespace: VersionGraphNamespace,
  label: string,
  semanticPayload: unknown,
) {
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

function validSemanticPayload(label: string, changes: readonly unknown[]) {
  return {
    schemaVersion: 1,
    label,
    changes,
  };
}

function defaultCellChange(label: string) {
  return semanticRecord({
    changeId: `${label}-cell-a1`,
    domain: 'cell',
    entityId: 'sheet-1!A1',
    propertyPath: ['value'],
    before: null,
    after: label,
    display: sheetAddressDisplay('Sheet1', 'A1'),
  });
}

function semanticRecord(input: {
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

function providerWithPermutedSemanticReads(
  provider: VersionStoreProvider,
  permutations: readonly (readonly number[])[],
): VersionStoreProvider {
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

function permute<T>(values: readonly T[], permutation: readonly number[]): readonly T[] {
  if (permutation.length !== values.length) return values;
  return permutation.map((index) => values[index]).filter((value) => value !== undefined);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function changeIds(
  items: readonly {
    readonly structural: { readonly kind: string; readonly changeId?: string };
  }[],
): readonly string[] {
  return items.map((item) => item.structural.changeId ?? item.structural.kind);
}

function semanticObject(fields: readonly { readonly key: string; readonly value: unknown }[]) {
  return {
    kind: 'object',
    fields: fields.map((field) => ({ key: field.key, value: field.value })),
  };
}

function entityLabelDisplay(value: string) {
  return {
    entityLabel: { kind: 'value', value },
  };
}

function sheetAddressDisplay(sheetName: string, address: string) {
  return {
    sheetName: { kind: 'value', value: sheetName },
    address: { kind: 'value', value: address },
  };
}
