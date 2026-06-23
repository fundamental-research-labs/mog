import { jest } from '@jest/globals';

import {
  VERSION_DIFF_PUBLIC_CURSOR_PREFIX,
  type VersionAuthor,
} from '@mog-sdk/contracts/versioning';
import type { WorkbookConfig } from '../types';
import type { VersionNormalCommitCapture } from '../../../document/version-store/commit-service';
import type { WorkbookCommitCompletenessDiagnostic } from '../../../document/version-store/commit-store';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createInMemoryVersionStoreProvider,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';
import { withVersionManifest } from './version-domain-support-test-utils';

const createCheckpointManagerMock = jest.fn();
const worksheetImplMock = jest.fn().mockImplementation((sheetId: string) => ({
  _sheetId: sheetId,
  _syncMetadata: jest.fn(),
  dispose: jest.fn(),
}));

jest.unstable_mockModule('../../worksheet/worksheet-impl', () => ({
  WorksheetImpl: worksheetImplMock,
}));

jest.unstable_mockModule('../../../services/checkpoint', () => ({
  createCheckpointManager: createCheckpointManagerMock,
}));

jest.unstable_mockModule('../../namespaces/records', () => ({
  get: jest.fn(),
  query: jest.fn(),
  getFieldValue: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  del: jest.fn(),
}));

jest.unstable_mockModule('../../../bridges/compute/compute-bridge', () => ({
  ComputeBridge: jest.fn(),
  createComputeBridge: jest.fn(),
  createComputeBridgeFromTransport: jest.fn(),
  extractMutationData: jest.fn(),
  identityFormulaToWire: jest.fn(),
  rustSchemaResolveEditor: jest.fn(),
  wireTableToTableConfig: jest.fn(),
  wireToIdentityFormula: jest.fn(),
  __esModule: true,
}));

const { WorkbookImpl } = await import('../workbook-impl');

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
const CREATED_AT = '2026-06-20T00:00:00.000Z';
const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

function createMockEventBus() {
  return {
    on: jest.fn().mockReturnValue(() => undefined),
    onAll: jest.fn().mockReturnValue(() => undefined),
    onMany: jest.fn(),
    emit: jest.fn(),
    emitBatch: jest.fn(),
    clear: jest.fn(),
  };
}

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    computeBridge: {
      getAllSheetIds: jest.fn(async () => []),
      getAllTablesInSheet: jest.fn(async () => []),
      getFiltersInSheet: jest.fn(async () => []),
      namedRangeCount: jest.fn(async () => 0),
      getAllNamedRangesWire: jest.fn(async () => []),
      getHyperlinks: jest.fn(async () => []),
      getRangeSchemasForSheet: jest.fn(async () => []),
    },
    writeGate: {
      assertWritable: jest.fn(),
    },
    services: {
      undo: {},
    },
    floatingObjectManager: {
      dispose: jest.fn(),
    },
    ...overrides,
  } as any;
}

function createWorkbook(overrides?: Partial<WorkbookConfig>) {
  createCheckpointManagerMock.mockReturnValue({
    create: jest.fn(),
    createSync: jest.fn(),
    restore: jest.fn(),
    list: jest.fn().mockReturnValue([]),
    get: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
  });

  const versioning = overrides?.versioning as Record<string, unknown> | undefined;
  return new WorkbookImpl({
    ctx: createMockCtx(),
    eventBus: createMockEventBus(),
    ...overrides,
    ...(versioning ? { versioning: withVersionManifest(versioning) } : {}),
  });
}

describe('WorkbookVersion provider-backed diff facade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('executes semantic diff through wb.version.diff when provider-backed versioning is configured', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);

    const captureNormalCommit = jest.fn(createSemanticDiffCommitCapture('child'));
    const wb = createWorkbook({
      versioning: {
        provider,
        captureNormalCommit,
      },
    });

    const commitResult = await wb.version.commit({
      expectedHead: {
        commitId: initialized.rootCommit.id,
        revision: initialized.initialHead.revision,
        symbolicHeadRevision: initialized.symbolicHead.revision,
      },
    });
    if (!commitResult.ok) throw new Error(`expected commit success: ${commitResult.error.code}`);
    const committed = commitResult.value;

    await expect(wb.version.diff(initialized.rootCommit.id, committed.id)).resolves.toEqual({
      ok: true,
      value: {
        items: [
          {
            structural: {
              kind: 'metadata',
              changeId: 'child-change-1',
              domain: 'cell',
              entityId: 'sheet-1!A1',
              propertyPath: ['value'],
            },
            before: { kind: 'value', value: 1 },
            after: { kind: 'value', value: 2 },
            display: {
              sheetName: { kind: 'value', value: 'Sheet1' },
              address: { kind: 'value', value: 'A1' },
            },
          },
        ],
        limit: 50,
        readRevision: { kind: 'counter', value: '1' },
        order: 'semantic-change-order',
      },
    });
  });

  it('projects provider-backed VC-06 review access through wb.version.diff', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);

    const semanticChanges = vc06SemanticChanges();
    const wb = createWorkbook({
      versioning: {
        provider,
        captureNormalCommit: jest.fn(createSemanticDiffCommitCapture('child', semanticChanges)),
      },
    });

    const commitResult = await wb.version.commit({
      expectedHead: {
        commitId: initialized.rootCommit.id,
        revision: initialized.initialHead.revision,
        symbolicHeadRevision: initialized.symbolicHead.revision,
      },
    });
    if (!commitResult.ok) throw new Error(`expected commit success: ${commitResult.error.code}`);
    const committed = commitResult.value;

    const result = await wb.version.diff(initialized.rootCommit.id, committed.id);

    expect(result).toMatchObject({
      ok: true,
      value: {
        items: semanticChanges,
        readRevision: { kind: 'counter', value: '1' },
        order: 'semantic-change-order',
      },
    });
    if (!result.ok) throw new Error(`expected diff success: ${result.error.code}`);
    expect(
      result.value.items.map((entry) =>
        entry.structural.kind === 'metadata' ? entry.structural.domain : entry.structural.kind,
      ),
    ).toEqual([
      'named-ranges',
      'tables',
      'comments-notes',
      'conditional-formatting',
      'data-validation',
      'filters',
      'sorts',
      'charts.source-range',
      'floating-objects.anchors',
    ]);
    expect(result.value.items[0]?.display).toEqual(redactedEntityLabelDisplay());
  });

  it('projects table and filter review-safe changes without leaking omitted authored payloads', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);

    const reviewChanges = tableFilterReviewSafeChanges();
    const wb = createWorkbook({
      versioning: {
        provider,
        captureNormalCommit: jest.fn(
          createSemanticDiffCommitCapture('child', [...reviewChanges, omittedMacroChange()], [], {
            reviewChanges,
          }),
        ),
      },
    });

    const commitResult = await wb.version.commit({
      expectedHead: {
        commitId: initialized.rootCommit.id,
        revision: initialized.initialHead.revision,
        symbolicHeadRevision: initialized.symbolicHead.revision,
      },
    });
    if (!commitResult.ok) throw new Error(`expected commit success: ${commitResult.error.code}`);
    const committed = commitResult.value;

    const result = await wb.version.diff(initialized.rootCommit.id, committed.id);

    expect(result).toMatchObject({
      ok: true,
      value: {
        items: [
          {
            structural: expect.objectContaining({
              domain: 'tables',
              propertyPath: ['definition'],
            }),
            after: {
              kind: 'value',
              value: semanticObject([
                { key: 'kind', value: 'Set' },
                { key: 'tableId', value: 'table-review-safe-sales' },
                { key: 'sheetId', value: 'sheet-1' },
              ]),
            },
            display: redactedEntityLabelDisplay(),
          },
          {
            structural: expect.objectContaining({
              domain: 'filters',
              propertyPath: ['state'],
            }),
            after: {
              kind: 'value',
              value: semanticObject([
                { key: 'kind', value: 'Set' },
                { key: 'filterId', value: 'filter-review-safe-sales' },
                { key: 'filterKind', value: 'autoFilter' },
                { key: 'hasActiveFilter', value: true },
                { key: 'hiddenRowCount', value: 7 },
                { key: 'visibleRowCount', value: 13 },
                {
                  key: 'unsupportedReasons',
                  value: { kind: 'array', values: ['criteria-values-redacted'] },
                },
              ]),
            },
            display: redactedEntityLabelDisplay(),
          },
        ],
        readRevision: { kind: 'counter', value: '1' },
        order: 'semantic-change-order',
      },
    });
    if (!result.ok) throw new Error(`expected diff success: ${result.error.code}`);
    expect(result.value.items).toHaveLength(2);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('principal-secret');
    expect(serialized).not.toContain('macros.vba');
    expect(serialized).not.toContain('macro-source-secret');
  });

  it('fails closed through wb.version.diff for unsupported VC-06 raw payload fields', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);

    const rawSecret = 'Sheet1!$B$2:$B$20';
    const wb = createWorkbook({
      versioning: {
        provider,
        captureNormalCommit: jest.fn(
          createSemanticDiffCommitCapture('child', [
            semanticRecord({
              changeId: 'vc06-unsupported-named-range-raw-field',
              domain: 'named-ranges',
              entityId: 'name:RevenueTotal',
              propertyPath: ['definition'],
              before: null,
              after: semanticObject([
                { key: 'kind', value: 'Set' },
                { key: 'name', value: 'RevenueTotal' },
                { key: 'secretFormula', value: rawSecret },
              ]),
              display: entityLabelDisplay('RevenueTotal'),
            }),
          ]),
        ),
      },
    });

    const commitResult = await wb.version.commit({
      expectedHead: {
        commitId: initialized.rootCommit.id,
        revision: initialized.initialHead.revision,
        symbolicHeadRevision: initialized.symbolicHead.revision,
      },
    });
    if (!commitResult.ok) throw new Error(`expected commit success: ${commitResult.error.code}`);
    const committed = commitResult.value;

    const result = await wb.version.diff(initialized.rootCommit.id, committed.id);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [expect.objectContaining({ code: 'VERSION_UNSUPPORTED_SCHEMA' })],
      },
    });
    expect(JSON.stringify(result)).not.toContain(rawSecret);
    expect(JSON.stringify(result)).not.toContain('secretFormula');
  });

  it('returns opaque public cursors and rejects stale public cursor handles through wb.version.diff', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);

    const changes = [
      ...defaultSemanticChanges('child'),
      {
        changeId: 'child-change-2',
        domain: 'cell',
        entityId: 'sheet-1!A2',
        propertyPath: ['value'],
        before: { kind: 'value', value: 3 },
        after: { kind: 'value', value: 4 },
        display: {
          sheetName: { kind: 'value', value: 'Sheet1' },
          address: { kind: 'value', value: 'A2' },
        },
      },
    ];
    const wb = createWorkbook({
      versioning: {
        provider,
        captureNormalCommit: jest.fn(createSemanticDiffCommitCapture('child', changes)),
      },
    });

    const commitResult = await wb.version.commit({
      expectedHead: {
        commitId: initialized.rootCommit.id,
        revision: initialized.initialHead.revision,
        symbolicHeadRevision: initialized.symbolicHead.revision,
      },
    });
    if (!commitResult.ok) throw new Error(`expected commit success: ${commitResult.error.code}`);
    const committed = commitResult.value;

    const firstPage = await wb.version.diff(initialized.rootCommit.id, committed.id, {
      pageSize: 1,
    });
    if (!firstPage.ok) throw new Error(`expected diff success: ${firstPage.error.code}`);
    const cursor = firstPage.value.nextCursor;
    expect(cursor).toEqual(
      expect.stringMatching(new RegExp(`^${escapeRegExp(VERSION_DIFF_PUBLIC_CURSOR_PREFIX)}`)),
    );
    expect(cursor).not.toContain('vc04diff');
    expect(cursor).not.toContain(initialized.rootCommit.id);
    expect(cursor).not.toContain(committed.id);

    await expect(
      wb.version.diff(initialized.rootCommit.id, committed.id, { pageSize: 1, pageToken: cursor }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        items: [expect.objectContaining({ after: { kind: 'value', value: 4 } })],
      },
    });

    const stale = await wb.version.diff(initialized.rootCommit.id, committed.id, {
      pageSize: 1,
      pageToken: `${VERSION_DIFF_PUBLIC_CURSOR_PREFIX}stale-handle`,
    });
    expect(stale).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_STALE_PAGE_CURSOR',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                operation: 'diff',
                category: 'staleCursor',
              }),
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(stale)).not.toContain('stale-handle');
  });

  it.each([
    [
      'omitted-unsupported-domain',
      {
        code: 'VERSION_UNSUPPORTED_AUTHORED_DOMAIN',
        severity: 'error',
        message: 'Unsupported authored domain omitted for principal-secret.',
        path: 'reviewChanges.omitted[0]',
        details: {
          omittedChangeCount: 1,
          omittedDomains: 'macros.vba',
          deniedPrincipalId: 'principal-secret',
        },
      },
    ],
    [
      'unsupported',
      {
        code: 'unsupportedDomain',
        severity: 'error',
        message: 'Pivot cache state is not supported by this semantic diff slice.',
        path: 'domains.pivots',
        details: { domain: 'pivots' },
      },
    ],
    [
      'opaque',
      {
        code: 'opaqueDomain',
        severity: 'warning',
        message: 'Embedded package state is opaque to this semantic diff slice.',
        path: 'domains.embeddedPackages',
        details: { domain: 'embeddedPackages' },
      },
    ],
    [
      'stale',
      {
        code: 'derivedImpactStale',
        severity: 'warning',
        message: 'Derived impact evidence is stale for this semantic diff slice.',
        path: 'derivedImpact.recalc',
        details: { domain: 'derivedImpact' },
      },
    ],
    [
      'subset-hidden',
      {
        code: 'indexKeyedRowVisibility',
        severity: 'error',
        message: 'Row hidden state is index-keyed outside the supported semantic subset.',
        path: 'sheets.sheet-1.rows.hidden',
        details: { domain: 'rows' },
      },
    ],
  ] satisfies readonly (readonly [string, WorkbookCommitCompletenessDiagnostic])[])(
    'reports %s completeness diagnostics through wb.version.diff without claiming a clean diff',
    async (category, completenessDiagnostic) => {
      const expectedCategory =
        category === 'omitted-unsupported-domain' ? 'unsupported' : category;
      const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
      const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
      expectInitializeSuccess(initialized);

      const wb = createWorkbook({
        versioning: {
          provider,
          captureNormalCommit: jest.fn(
            createSemanticDiffCommitCapture('child', defaultSemanticChanges('child'), [
              completenessDiagnostic,
            ]),
          ),
        },
      });

      const commitResult = await wb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!commitResult.ok) throw new Error(`expected commit success: ${commitResult.error.code}`);
      const committed = commitResult.value;

      const result = await wb.version.diff(initialized.rootCommit.id, committed.id);

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          diagnostics: [
            expect.objectContaining({
              code: completenessDiagnostic.code,
              data: expect.objectContaining({
                operation: 'diff',
                recoverability: expectedCategory === 'stale' ? 'retry' : 'unsupported',
                payload: expect.objectContaining({
                  operation: 'diff',
                  selector: 'target',
                  category: expectedCategory,
                  completenessCode: completenessDiagnostic.code,
                  completenessSeverity: completenessDiagnostic.severity,
                  path: completenessDiagnostic.path,
                }),
              }),
            }),
          ],
        },
      });
      if (result.ok) throw new Error('expected diff completeness diagnostics');
      expect(result.error.diagnostics).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain('principal-secret');
      expect(JSON.stringify(result)).not.toContain('deniedPrincipal');
      expect(JSON.stringify(result)).not.toContain('omittedDomains');
      expect(result).not.toHaveProperty('value');
    },
  );

  it('continues to degrade cleanly when a provider registry is unavailable', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const wb = createWorkbook({
      versioning: {
        provider,
        captureNormalCommit: jest.fn(createSemanticDiffCommitCapture('unused')),
      },
    });

    await expect(
      wb.version.diff(`commit:sha256:${'1'.repeat(64)}`, `commit:sha256:${'2'.repeat(64)}`),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_GRAPH_UNINITIALIZED',
            data: expect.objectContaining({ redacted: true }),
          }),
        ],
      },
    });
  });
});

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
  const namespace = {
    workspaceId: DOCUMENT_SCOPE.workspaceId,
    documentId: DOCUMENT_SCOPE.documentId,
    graphId,
    principalScope: DOCUMENT_SCOPE.principalScope,
  };
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
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

function createSemanticDiffCommitCapture(
  label: string,
  changes: readonly unknown[] = defaultSemanticChanges(label),
  completenessDiagnostics: readonly WorkbookCommitCompletenessDiagnostic[] = [],
  options: {
    readonly reviewChanges?: readonly unknown[];
  } = {},
): VersionNormalCommitCapture {
  return async ({ namespace, currentMain }) => ({
    status: 'success',
    input: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        parent: currentMain.commitId,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        schemaVersion: 1,
        label,
        changes,
        ...(options.reviewChanges === undefined ? {} : { reviewChanges: options.reviewChanges }),
      }),
      mutationSegmentRecords: [
        await objectRecord(namespace, 'workbook.mutationSegment.v1', {
          segmentId: `${label}-segment-1`,
          baseCommitId: currentMain.commitId,
        }),
      ],
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics,
    },
  });
}

function defaultSemanticChanges(label: string) {
  return [
    {
      changeId: `${label}-change-1`,
      domain: 'cell',
      entityId: 'sheet-1!A1',
      propertyPath: ['value'],
      before: { kind: 'value', value: 1 },
      after: { kind: 'value', value: 2 },
      display: {
        sheetName: { kind: 'value', value: 'Sheet1' },
        address: { kind: 'value', value: 'A1' },
      },
    },
  ];
}

function vc06SemanticChanges() {
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

function tableFilterReviewSafeChanges() {
  return [
    semanticRecord({
      changeId: 'review-safe-table-definition',
      domain: 'tables',
      entityId: 'sheet-1!table:table-review-safe-sales',
      propertyPath: ['definition'],
      before: null,
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'tableId', value: 'table-review-safe-sales' },
        { key: 'sheetId', value: 'sheet-1' },
      ]),
      display: redactedEntityLabelDisplay(),
    }),
    semanticRecord({
      changeId: 'review-safe-filter-state',
      domain: 'filters',
      entityId: 'sheet-1!filter:filter-review-safe-sales',
      propertyPath: ['state'],
      before: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'filterId', value: 'filter-review-safe-sales' },
        { key: 'hasActiveFilter', value: false },
        { key: 'visibleRowCount', value: 20 },
      ]),
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'filterId', value: 'filter-review-safe-sales' },
        { key: 'filterKind', value: 'autoFilter' },
        { key: 'hasActiveFilter', value: true },
        { key: 'hiddenRowCount', value: 7 },
        { key: 'visibleRowCount', value: 13 },
        {
          key: 'unsupportedReasons',
          value: { kind: 'array', values: ['criteria-values-redacted'] },
        },
      ]),
      display: redactedEntityLabelDisplay(),
    }),
  ];
}

function omittedMacroChange() {
  return semanticRecord({
    changeId: 'omitted-unsupported-macro',
    domain: 'macros.vba',
    entityId: 'module:principal-secret',
    propertyPath: ['source'],
    before: null,
    after: 'macro-source-secret',
    display: entityLabelDisplay('principal-secret Macro'),
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
}) {
  return {
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

function redactedEntityLabelDisplay() {
  return {
    entityLabel: { kind: 'redacted', reason: 'redaction-policy' },
  };
}

function addressDisplay(value: string) {
  return {
    address: { kind: 'value', value },
  };
}

function sheetAddressDisplay(sheetName: string, address: string) {
  return {
    sheetName: { kind: 'value', value: sheetName },
    address: { kind: 'value', value: address },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
