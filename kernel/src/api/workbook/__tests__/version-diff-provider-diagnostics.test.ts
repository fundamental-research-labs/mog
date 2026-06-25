import { jest } from '@jest/globals';

import type { WorkbookCommitCompletenessDiagnostic } from '../../../document/version-store/commit-store';
import { defaultSemanticChanges } from './version-diff-provider-fixtures';
import { createCommittedDiffWorkbook, diffCommitted } from './version-diff-provider-test-utils';

describe('WorkbookVersion provider-backed diff completeness diagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      const expectedCategory = category === 'omitted-unsupported-domain' ? 'unsupported' : category;
      const expectedRedactedCategory = category === 'subset-hidden' ? 'redacted' : expectedCategory;
      const context = await createCommittedDiffWorkbook({
        commitLabel: 'child',
        changes: defaultSemanticChanges('child'),
        completenessDiagnostics: [completenessDiagnostic],
      });

      const result = await diffCommitted(context);

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
                redacted: true,
                payload: expect.objectContaining({
                  operation: 'diff',
                  selector: 'target',
                  category: expectedRedactedCategory,
                  completenessCode: completenessDiagnostic.code,
                  completenessSeverity: completenessDiagnostic.severity,
                  path: 'redacted',
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
      expect(JSON.stringify(result)).not.toContain(completenessDiagnostic.path);
      expect(result).not.toHaveProperty('value');
    },
  );
});
