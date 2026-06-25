import { expect, it, jest } from '@jest/globals';

import type { VersionSemanticDiffPage } from '@mog-sdk/contracts/api';

import { createVersion, READ_REVISION, ROOT_COMMIT_ID } from './version-diff-selector-test-utils';

export function registerSelectorRedactionCellCoordinateScenarios(): void {
  it('redacts cell coordinates when provider redacts cell values', async () => {
    const hiddenSheet = 'Payroll FY27';
    const hiddenAddress = 'Payroll FY27!B9';
    const hiddenEntity = 'sheet-payroll-secret!B9';
    const diff = jest.fn(async () => ({
      status: 'success',
      items: [
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
            sheetName: { kind: 'value', value: hiddenSheet },
            address: { kind: 'value', value: hiddenAddress },
          },
        },
      ],
      readRevision: READ_REVISION,
      order: 'semantic-change-order',
      diagnostics: [],
    }));
    const version = createVersion(diff);

    const result = await version.diff(ROOT_COMMIT_ID, ROOT_COMMIT_ID);

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
        readRevision: READ_REVISION,
        order: 'semantic-change-order',
      } satisfies VersionSemanticDiffPage,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(hiddenSheet);
    expect(serialized).not.toContain(hiddenAddress);
    expect(serialized).not.toContain(hiddenEntity);
    expect(serialized).not.toContain('payroll-secret-cell');
  });
}
