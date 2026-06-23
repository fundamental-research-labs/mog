import { expect, it } from '@jest/globals';

import { validSemanticPayload } from './version-diff-projection-fixtures';
import { createVersion, graphWithRootAndChild } from './version-diff-projection-test-utils';

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
