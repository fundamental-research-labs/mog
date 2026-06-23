import { jest } from '@jest/globals';

import type {
  VersionMergeChange,
  VersionMergeInput,
  VersionMergeResult,
  VersionSemanticValue,
} from '@mog-sdk/contracts/api';

import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import { WorkbookVersionImpl } from '../version';
import {
  DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND,
  createSemanticMergeCommitCapture,
} from '../version-merge-materializer';
import {
  inspectMaterializableMergeChange,
  isMaterializableMergeDomainReference,
} from '../version-merge-materializer-support';
import {
  freshVersionDomainSupportManifest,
  versionDomainSupportManifestRow,
  versionDomainSupportManifestRuntime,
} from './version-domain-support-test-utils';

const BASE = `commit:sha256:${'1'.repeat(64)}` as VersionMergeInput['base'];
const OURS = `commit:sha256:${'2'.repeat(64)}` as VersionMergeInput['ours'];
const THEIRS = `commit:sha256:${'3'.repeat(64)}` as VersionMergeInput['theirs'];
const TARGET_REF = 'refs/heads/main';
const DOCUMENT_SCOPE: VersionDocumentScope = {
  documentId: 'vc07-apply-merge-materializer-support',
};
const CREATED_AT = '2026-06-21T00:00:00.000Z';
const EXPECTED_TARGET_HEAD = {
  commitId: OURS,
  revision: { kind: 'counter' as const, value: '1' },
};

describe('WorkbookVersion applyMerge materializer unsupported structural domains', () => {
  it.each([
    {
      label: 'sheet rename',
      change: sheetNameChange(),
      domain: 'sheet',
    },
    {
      label: 'sheet lifecycle',
      change: sheetLifecycleChange(),
      domain: 'sheet',
    },
    {
      label: 'table definition',
      change: tableDefinitionChange(),
      domain: 'tables',
    },
    {
      label: 'filter state',
      change: filterStateChange(),
      domain: 'filters',
    },
    {
      label: 'chart source range',
      change: chartSourceRangeChange(),
      domain: 'charts.source-range',
    },
    {
      label: 'floating object anchor',
      change: floatingObjectAnchorChange(),
      domain: 'floating-objects.anchors',
    },
  ])('blocks a clean merge plan containing $label before any write', async ({ change, domain }) => {
    const result: VersionMergeResult = cleanResult([change]);
    const merge = jest.fn(async () => result);
    const mergeCommit = jest.fn();
    const version = workbookVersionWithVersioning({
      mergeService: { merge },
      writeService: { mergeCommit },
    });

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.applyMerge',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_MERGE_UNSUPPORTED_DOMAIN',
            data: expect.objectContaining({
              operation: 'applyMerge',
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                materializer: 'semantic-cell-merge-commit-materializer.v1',
                structuralKind: 'metadata',
                domain,
                propertyPath: expect.any(String),
                reason: 'unsupportedStructuralDomain',
              }),
            }),
          }),
        ],
      },
    });
    expect(merge).toHaveBeenCalledWith(
      { base: BASE, ours: OURS, theirs: THEIRS },
      {
        mode: 'preview',
      },
    );
    expect(mergeCommit).not.toHaveBeenCalled();
  });

  it('rejects unsupported structural domain no-op changes before any write', async () => {
    const result: VersionMergeResult = cleanResult([sheetNameNoopChange()]);
    const merge = jest.fn(async () => result);
    const mergeCommit = jest.fn();
    const version = workbookVersionWithVersioning({
      mergeService: { merge },
      writeService: { mergeCommit },
    });

    await expect(
      version.applyMerge(
        { base: BASE, ours: OURS, theirs: THEIRS },
        { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.applyMerge',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_MERGE_UNSUPPORTED_DOMAIN',
            data: expect.objectContaining({
              operation: 'applyMerge',
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                materializer: 'semantic-cell-merge-commit-materializer.v1',
                structuralKind: 'metadata',
                domain: 'sheet',
                propertyPath: 'name',
                reason: 'unsupportedStructuralDomain',
                noop: true,
              }),
            }),
          }),
        ],
      },
    });
    expect(mergeCommit).not.toHaveBeenCalled();
  });

  it('returns materializer boundary diagnostics for unsupported no-op changes before hydration', async () => {
    const capture = createSemanticMergeCommitCapture({
      userTimezone: 'UTC',
      now: () => new Date(CREATED_AT),
    });

    const result = await capture({
      provider: { documentScope: DOCUMENT_SCOPE } as any,
      graph: {} as any,
      accessContext: {},
      namespace: namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-materializer-boundary'),
      registry: {} as any,
      currentRef: { name: TARGET_REF } as any,
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      targetRef: TARGET_REF as any,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
      changes: [sheetNameNoopChange()],
      resolutionCount: 0,
    });

    expect(result).toMatchObject({
      status: 'failed',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_MISSING_CHANGE_SET',
          details: expect.objectContaining({
            itemIndex: 0,
            materializer: DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND,
            structuralKind: 'metadata',
            domain: 'sheet',
            propertyPath: 'name',
            reason: 'unsupportedStructuralDomain',
            noop: true,
          }),
        }),
      ],
    });
  });

  it.each([
    {
      label: 'registry sheet row',
      matrixRowId: 'sheets',
      domainId: 'sheets',
      expectedMatrixRowId: 'sheets',
      expectedDomain: 'sheets',
    },
    {
      label: 'unsupported view-state row',
      matrixRowId: 'view-state.selection-scroll',
      domainId: 'view-state',
      expectedMatrixRowId: 'view-state.selection-scroll',
      expectedDomain: 'view-state',
      manifestRow: versionDomainSupportManifestRow('view-state', {
        matrixRowId: 'view-state.selection-scroll',
      }),
    },
  ])(
    'blocks fast-forward apply before preview or ref movement when detector rows expose $label',
    async ({ matrixRowId, domainId, expectedMatrixRowId, expectedDomain, manifestRow }) => {
      const merge = jest.fn();
      const fastForwardMerge = jest.fn();
      const mergeCommit = jest.fn();
      const version = workbookVersionWithVersioning(
        {
          mergeService: { merge },
          writeService: { fastForwardMerge, mergeCommit },
        },
        versionDomainSupportManifestRuntime({
          manifest: {
            domains: [
              ...freshVersionDomainSupportManifest().domains,
              ...(manifestRow ? [manifestRow] : []),
            ],
          },
          options: {
            detectorRows: [
              {
                matrixRowId,
                domainId,
                present: true,
                detectorId: `detector.${domainId}`,
              },
            ],
          },
        }),
      );

      await expect(
        version.applyMerge(
          { base: BASE, ours: OURS, theirs: THEIRS },
          { targetRef: TARGET_REF as any, expectedTargetHead: EXPECTED_TARGET_HEAD },
        ),
      ).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.applyMerge',
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_MERGE_UNSUPPORTED_DOMAIN',
              data: expect.objectContaining({
                operation: 'applyMerge',
                mutationGuarantee: 'no-write-attempted',
                payload: expect.objectContaining({
                  structuralKind: 'metadata',
                  domain: expectedDomain,
                  matrixRowId: expectedMatrixRowId,
                  reason: 'unsupportedDetectedDomain',
                }),
              }),
            }),
          ],
        },
      });
      expect(merge).not.toHaveBeenCalled();
      expect(fastForwardMerge).not.toHaveBeenCalled();
      expect(mergeCommit).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      label: 'row insert',
      change: rowColumnChange('merge-row-insert', 'row', 1, 'insert'),
    },
    {
      label: 'row delete',
      change: rowColumnChange('merge-row-delete', 'row', 3, 'delete'),
    },
    {
      label: 'column insert',
      change: rowColumnChange('merge-column-insert', 'column', 4, 'insert'),
    },
    {
      label: 'column delete',
      change: rowColumnChange('merge-column-delete', 'column', 2, 'delete'),
    },
  ])('accepts first-slice rows-columns $label merge changes', ({ change }) => {
    expect(inspectMaterializableMergeChange(change)).toEqual({ ok: true });
  });

  it('does not treat materializable matrix rows as support for structural domain aliases', () => {
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'cells.values',
        domainId: 'rows-columns',
      }),
    ).toBe(false);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'cells.values',
        domainId: 'sheet',
      }),
    ).toBe(false);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'cells.values',
        domainId: 'row',
      }),
    ).toBe(false);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'cells.formats.direct',
        domainId: 'sheets',
      }),
    ).toBe(false);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'cells.formats.direct',
        domainId: 'cells.formats',
      }),
    ).toBe(true);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'rows-columns',
        domainId: 'rows-columns',
      }),
    ).toBe(true);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'cells.formats.catalogs',
        domainId: 'cells.formats',
      }),
    ).toBe(false);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'pivots',
        domainId: 'pivots',
      }),
    ).toBe(false);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'tables',
        domainId: 'tables',
      }),
    ).toBe(false);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'filters.auto-filter',
        domainId: 'filters',
      }),
    ).toBe(false);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'charts.source-range',
        domainId: 'charts',
      }),
    ).toBe(false);
    expect(
      isMaterializableMergeDomainReference({
        matrixRowId: 'floating-objects.anchors',
        domainId: 'floating-objects',
      }),
    ).toBe(false);
  });
});

function cleanResult(changes: readonly VersionMergeChange[]): VersionMergeResult {
  return {
    status: 'clean',
    base: BASE,
    ours: OURS,
    theirs: THEIRS,
    changes,
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  };
}

function rowColumnChange(
  changeId: string,
  axis: 'row' | 'column',
  index: number,
  action: 'insert' | 'delete',
): VersionMergeChange {
  const displayRef = axis === 'row' ? `${index + 1}:${index + 1}` : 'C:C';
  const value = semanticObject([
    { key: 'axis', value: axis },
    { key: 'sheetId', value: 'sheet-1' },
    { key: 'index', value: index },
    { key: 'displayRef', value: displayRef },
  ]);
  const present = { kind: 'value' as const, value };
  const absent = { kind: 'value' as const, value: null };
  return {
    structural: metadata(changeId, `sheet-1!${axis}:${index}`, 'rows-columns', ['order']),
    base: action === 'insert' ? absent : present,
    theirs: action === 'insert' ? present : absent,
    merged: action === 'insert' ? present : absent,
  };
}

function sheetNameChange(): VersionMergeChange {
  return {
    structural: metadata('merge-sheet-name', 'sheet-1', 'sheet', ['name']),
    base: { kind: 'value', value: 'Sheet1' },
    theirs: { kind: 'value', value: 'Forecast' },
    merged: { kind: 'value', value: 'Forecast' },
  };
}

function sheetNameNoopChange(): VersionMergeChange {
  const value = { kind: 'value' as const, value: 'Sheet1' };
  return {
    ...sheetNameChange(),
    theirs: value,
    merged: value,
  };
}

function sheetLifecycleChange(): VersionMergeChange {
  const value = semanticObject([
    { key: 'name', value: 'Inserted' },
    { key: 'index', value: 1 },
  ]);
  return {
    structural: metadata('merge-sheet-create', 'sheet-2', 'sheet', ['sheet']),
    base: { kind: 'value', value: null },
    theirs: { kind: 'value', value },
    merged: { kind: 'value', value },
  };
}

function tableDefinitionChange(): VersionMergeChange {
  const value = semanticObject([
    { key: 'kind', value: 'Added' },
    { key: 'tableId', value: 'table-1' },
    { key: 'name', value: 'SalesTable' },
    { key: 'sheetId', value: 'sheet-1' },
  ]);
  return {
    structural: metadata('merge-table-definition', 'sheet-1!table:table-1', 'tables', [
      'definition',
    ]),
    base: { kind: 'value', value: null },
    theirs: { kind: 'value', value },
    merged: { kind: 'value', value },
  };
}

function filterStateChange(): VersionMergeChange {
  const value = semanticObject([
    { key: 'kind', value: 'Added' },
    { key: 'sheetId', value: 'sheet-1' },
    { key: 'range', value: 'A1:D20' },
  ]);
  return {
    structural: metadata('merge-filter-state', 'sheet-1!auto-filter', 'filters', ['state']),
    base: { kind: 'value', value: null },
    theirs: { kind: 'value', value },
    merged: { kind: 'value', value },
  };
}

function chartSourceRangeChange(): VersionMergeChange {
  const value = semanticObject([
    { key: 'objectType', value: 'chart' },
    { key: 'sourceRange', value: 'A1:B12' },
    { key: 'sheetId', value: 'sheet-1' },
  ]);
  return {
    structural: metadata(
      'merge-chart-source-range',
      'sheet-1!chart:chart-1',
      'charts.source-range',
      ['sourceRange'],
    ),
    base: { kind: 'value', value: null },
    theirs: { kind: 'value', value },
    merged: { kind: 'value', value },
  };
}

function floatingObjectAnchorChange(): VersionMergeChange {
  const value = semanticObject([
    { key: 'objectType', value: 'picture' },
    { key: 'from', value: 'C3' },
    { key: 'to', value: 'F12' },
  ]);
  return {
    structural: metadata(
      'merge-floating-object-anchor',
      'sheet-1!object:picture-1',
      'floating-objects.anchors',
      ['anchor'],
    ),
    base: { kind: 'value', value: null },
    theirs: { kind: 'value', value },
    merged: { kind: 'value', value },
  };
}

function metadata(
  changeId: string,
  entityId: string,
  domain: string,
  propertyPath: readonly string[],
) {
  return {
    kind: 'metadata' as const,
    changeId,
    domain,
    entityId,
    propertyPath,
  };
}

function semanticObject(
  fields: readonly { readonly key: string; readonly value: VersionSemanticValue }[],
): VersionSemanticValue {
  return {
    kind: 'object',
    fields,
  };
}

function workbookVersionWithVersioning(
  versioning: Record<string, unknown>,
  manifestRuntime = versionDomainSupportManifestRuntime(),
) {
  return new WorkbookVersionImpl({
    versioning: {
      ...versioning,
      ...manifestRuntime,
    },
  } as any);
}
