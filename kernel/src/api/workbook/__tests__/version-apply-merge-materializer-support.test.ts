import { jest } from '@jest/globals';

import type {
  VersionMergeChange,
  VersionMergeInput,
  VersionMergeResult,
  VersionSemanticValue,
} from '@mog-sdk/contracts/api';

import { WorkbookVersionImpl } from '../version';
import { isMaterializableMergeDomainReference } from '../version-merge-materializer-support';
import {
  freshVersionDomainSupportManifest,
  versionDomainSupportManifestRow,
  versionDomainSupportManifestRuntime,
} from './version-domain-support-test-utils';

const BASE = `commit:sha256:${'1'.repeat(64)}` as VersionMergeInput['base'];
const OURS = `commit:sha256:${'2'.repeat(64)}` as VersionMergeInput['ours'];
const THEIRS = `commit:sha256:${'3'.repeat(64)}` as VersionMergeInput['theirs'];
const TARGET_REF = 'refs/heads/main';
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
                structuralKind: 'metadata',
                domain,
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
    },
  ])(
    'blocks fast-forward apply before preview or ref movement when detector rows expose $label',
    async ({ matrixRowId, domainId, expectedMatrixRowId, expectedDomain }) => {
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
              versionDomainSupportManifestRow('view-state', {
                matrixRowId: 'view-state.selection-scroll',
              }),
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
  removed: boolean,
): VersionMergeChange {
  const displayRef = axis === 'row' ? `${index + 1}:${index + 1}` : 'C:C';
  const value = semanticObject([
    { key: 'axis', value: axis },
    { key: 'sheetId', value: 'sheet-1' },
    { key: 'index', value: index },
    { key: 'displayRef', value: displayRef },
  ]);
  return {
    structural: metadata(changeId, `sheet-1!${axis}:${index}`, 'rows-columns', ['order']),
    base: { kind: 'value', value: removed ? value : null },
    theirs: { kind: 'value', value: removed ? null : value },
    merged: { kind: 'value', value: removed ? null : value },
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
