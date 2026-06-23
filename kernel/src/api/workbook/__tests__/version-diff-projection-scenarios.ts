import { expect, it } from '@jest/globals';

import type { WorkbookCommitId } from '../../../document/version-store/object-digest';
import {
  changeIds,
  defaultCellChange,
  entityLabelDisplay,
  semanticObject,
  semanticRecord,
  sheetAddressDisplay,
  validSemanticPayload,
} from './version-diff-projection-fixtures';
import {
  createVersion,
  graphWithMergeTarget,
  graphWithRootAndChild,
  providerWithPermutedSemanticReads,
} from './version-diff-projection-test-utils';

export function registerProjectionSemanticScenarios(): void {
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
}

export function registerProjectionRedactionScenarios(): void {
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
}

export function registerProjectionDiagnosticScenarios(): void {
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
}

export function registerProjectionPaginationScenarios(): void {
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
}
