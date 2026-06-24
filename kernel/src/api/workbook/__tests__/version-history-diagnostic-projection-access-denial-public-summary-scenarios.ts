import { projectVersionHistoryDiagnosticsForAccess } from '../version/history-diagnostics/version-history-diagnostic-projection';
import { sensitiveDiagnostic } from './version-history-diagnostic-projection-access-fixtures';
import { expectNoForbiddenDetails } from './version-history-diagnostic-projection-test-utils';

export function registerVersionHistoryAccessDenialPublicSummaryScenarios(): void {
  it('projects access denials without reflecting arbitrary capabilities or dependency strings', () => {
    const projected = projectVersionHistoryDiagnosticsForAccess(
      [
        sensitiveDiagnostic({
          capability: 'version:reviewRead',
          deniedCapabilities: ['version:reviewRead', 'hidden:sheet', 'opaque:object'],
        }),
      ],
      {
        kind: 'access-denied',
        dependency: 'protected-workbook',
        deniedCapabilities: ['version:reviewRead', 'deleted:commit'],
      },
    );

    expect(projected).toEqual([
      {
        code: 'version_access_denied',
        severity: 'error',
        message: 'Version history access is denied for this caller.',
        data: {
          kind: 'access-denied',
          deniedCapabilities: ['version:reviewRead'],
        },
      },
    ]);
    expectNoForbiddenDetails(projected);
  });
}
