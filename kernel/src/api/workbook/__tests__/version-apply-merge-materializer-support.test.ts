import { jest } from '@jest/globals';

import {
  BASE,
  EXPECTED_TARGET_HEAD,
  OURS,
  TARGET_REF,
  THEIRS,
  chartSourceRangeChange,
  cleanResult,
  filterStateChange,
  floatingObjectAnchorChange,
  sheetLifecycleChange,
  sheetLifecycleNoopChange,
  tableDefinitionChange,
  workbookVersionWithVersioning,
} from './version-apply-merge-materializer-support-test-utils';

describe('WorkbookVersion applyMerge materializer unsupported structural domains', () => {
  it.each([
    {
      label: 'sheet lifecycle',
      change: sheetLifecycleChange(),
      domain: 'sheet',
      reason: 'unsupportedStructuralMetadata',
    },
    {
      label: 'table definition',
      change: tableDefinitionChange(),
      domain: 'tables',
      reason: 'unsupportedStructuralDomain',
    },
    {
      label: 'filter state',
      change: filterStateChange(),
      domain: 'filters',
      reason: 'unsupportedStructuralDomain',
    },
    {
      label: 'chart source range',
      change: chartSourceRangeChange(),
      domain: 'charts.source-range',
      reason: 'unsupportedStructuralDomain',
    },
    {
      label: 'floating object anchor',
      change: floatingObjectAnchorChange(),
      domain: 'floating-objects.anchors',
      reason: 'unsupportedStructuralDomain',
    },
  ])(
    'blocks a clean merge plan containing $label before any write',
    async ({ change, domain, reason }) => {
      const result = cleanResult([change]);
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
                  reason,
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
    },
  );

  it('rejects unsupported structural domain no-op changes before any write', async () => {
    const result = cleanResult([sheetLifecycleNoopChange()]);
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
                propertyPath: 'redacted',
                reason: 'unsupportedStructuralMetadata',
                noop: true,
              }),
            }),
          }),
        ],
      },
    });
    expect(mergeCommit).not.toHaveBeenCalled();
  });
});
