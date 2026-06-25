import { jest } from '@jest/globals';

import {
  omittedMacroChange,
  redactedEntityLabelDisplay,
  semanticObject,
  tableFilterReviewSafeChanges,
  unsupportedNamedRangeRawFieldChange,
} from './version-diff-provider-fixtures';
import { vc06SemanticChanges } from './version-diff-provider-vc06-fixtures';
import { createCommittedDiffWorkbook, diffCommitted } from './version-diff-provider-test-utils';

describe('WorkbookVersion provider-backed diff review access', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('projects provider-backed VC-06 review access through wb.version.diff', async () => {
    const semanticChanges = vc06SemanticChanges();
    const context = await createCommittedDiffWorkbook({
      commitLabel: 'child',
      changes: semanticChanges,
    });

    const result = await diffCommitted(context);

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
      'cells.values',
      'cells.formulas',
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
    expect(
      result.value.items.find(
        (entry) =>
          entry.structural.kind === 'metadata' &&
          entry.structural.changeId === 'vc06-named-range-definition',
      )?.display,
    ).toEqual(redactedEntityLabelDisplay());
  });

  it('projects table and filter review-safe changes without leaking omitted authored payloads', async () => {
    const reviewChanges = tableFilterReviewSafeChanges();
    const context = await createCommittedDiffWorkbook({
      commitLabel: 'child',
      changes: [...reviewChanges, omittedMacroChange()],
      reviewChanges,
    });

    const result = await diffCommitted(context);

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
    const rawSecret = 'Sheet1!$B$2:$B$20';
    const context = await createCommittedDiffWorkbook({
      commitLabel: 'child',
      changes: [unsupportedNamedRangeRawFieldChange(rawSecret)],
    });

    const result = await diffCommitted(context);

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
});
