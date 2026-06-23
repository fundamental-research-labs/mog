import { expect, it, jest } from '@jest/globals';

import type { VersionSemanticDiffPage } from '@mog-sdk/contracts/api';

import {
  createVersion,
  READ_REVISION,
  ROOT_COMMIT_ID,
} from './version-diff-selector-test-utils';

export function registerSelectorRedactionScenarios(): void {
  it.each([
    [
      'unsupported domain',
      {
        code: 'unsupportedDomain',
        severity: 'error',
        message: 'Unsupported authored domain omitted for principal-secret.',
        details: {
          category: 'unsupported',
          completenessCode: 'unsupportedDomain',
          completenessSeverity: 'error',
          path: 'domains.pivots',
          domain: 'pivots',
          deniedPrincipalId: 'principal-secret',
          omittedDomains: 'macros.vba',
          rawDomainDigest: 'sha256-secret',
        },
      },
      'unsupported',
      'The requested version diff includes unsupported semantic state.',
      ['principal-secret', 'omittedDomains', 'macros.vba', 'rawDomainDigest', 'sha256-secret'],
    ],
    [
      'subset-hidden domain',
      {
        code: 'indexKeyedRowVisibility',
        severity: 'error',
        message: 'Row hidden state exposes secret-row-ids.',
        details: {
          category: 'subset-hidden',
          completenessCode: 'indexKeyedRowVisibility',
          completenessSeverity: 'error',
          path: 'sheets.sheet-1.rows.visibility',
          domain: 'rows',
          hiddenRowIds: 'secret-row-ids',
          redactionBypassKey: 'secret-redaction-key',
        },
      },
      'subset-hidden',
      'The requested version diff includes subset-hidden semantic state.',
      ['secret-row-ids', 'hiddenRowIds', 'secret-redaction-key', 'redactionBypassKey'],
    ],
  ] as const)(
    'redacts provider-only fields from %s completeness diagnostics',
    async (_label, diagnostic, category, safeMessage, forbiddenTerms) => {
      const diff = jest.fn(async () => ({
        status: 'degraded',
        diagnostics: [diagnostic],
      }));
      const version = createVersion(diff);

      const result = await version.diff(ROOT_COMMIT_ID, ROOT_COMMIT_ID);

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          diagnostics: [
            expect.objectContaining({
              code: diagnostic.code,
              message: safeMessage,
              data: expect.objectContaining({
                recoverability: 'unsupported',
                redacted: true,
                payload: expect.objectContaining({
                  operation: 'diff',
                  category: category === 'subset-hidden' ? 'redacted' : category,
                  completenessCode: diagnostic.code,
                  completenessSeverity: diagnostic.severity,
                }),
              }),
            }),
          ],
        },
      });
      expect(diff).toHaveBeenCalledTimes(1);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(diagnostic.message);
      for (const term of forbiddenTerms) {
        expect(serialized).not.toContain(term);
      }
    },
  );

  it('preserves redacted diff entries without exposing hidden domain metadata', async () => {
    const diff = jest.fn(async () => ({
      status: 'success',
      items: [
        {
          structural: { kind: 'redacted', reason: 'redaction-policy' },
          before: { kind: 'redacted', reason: 'historical-acl-unavailable' },
          after: { kind: 'redacted', reason: 'redaction-policy' },
          display: {
            entityLabel: { kind: 'redacted', reason: 'permission-denied' },
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
            structural: { kind: 'redacted', reason: 'redaction-policy' },
            before: { kind: 'redacted', reason: 'historical-acl-unavailable' },
            after: { kind: 'redacted', reason: 'redaction-policy' },
            display: {
              entityLabel: { kind: 'redacted', reason: 'permission-denied' },
            },
          },
        ],
        limit: 50,
        readRevision: READ_REVISION,
        order: 'semantic-change-order',
      } satisfies VersionSemanticDiffPage,
    });
    expect(JSON.stringify(result)).not.toContain('hidden');
    expect(JSON.stringify(result)).not.toContain('domain');
  });

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
