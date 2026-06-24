import { projectVersionHistoryDiagnosticsForAccess } from '../version/history-diagnostics/version-history-diagnostic-projection';
import {
  sensitiveDiagnostic,
  sensitiveDomainDiagnosticCases,
} from './version-history-diagnostic-projection-access-fixtures';
import { expectNoForbiddenDetails } from './version-history-diagnostic-projection-test-utils';

export function registerVersionHistoryAccessDenialDomainRedactionScenarios(): void {
  it('projects sensitive domain diagnostics identically regardless of hidden domain presence', () => {
    const baseline = projectVersionHistoryDiagnosticsForAccess([], { kind: 'access-denied' });

    for (const diagnostics of sensitiveDomainDiagnosticCases()) {
      const projected = projectVersionHistoryDiagnosticsForAccess(diagnostics, {
        kind: 'access-denied',
      });

      expect(projected).toEqual(baseline);
      expectNoForbiddenDetails(projected);
    }
  });

  it('omits denied diagnostic cardinality from access-projected summaries', () => {
    const projected = projectVersionHistoryDiagnosticsForAccess(
      [
        sensitiveDiagnostic({ domain: 'hidden-sheet', capability: 'version:read' }),
        sensitiveDiagnostic({ domain: 'external-link', capability: 'version:remotePromote' }),
      ],
      { kind: 'access-denied' },
    );

    expect(projected).toEqual([
      {
        code: 'version_access_denied',
        severity: 'error',
        message: 'Version history access is denied for this caller.',
        data: {
          kind: 'access-denied',
        },
      },
    ]);
    expect(JSON.stringify(projected)).not.toContain('diagnosticCount');
    expectNoForbiddenDetails(projected);
  });
}
