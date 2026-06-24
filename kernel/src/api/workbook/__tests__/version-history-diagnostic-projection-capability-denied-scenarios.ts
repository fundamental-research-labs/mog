import { projectVersionHistoryDiagnosticsForAccess } from '../version/history-diagnostics/version-history-diagnostic-projection';
import { sensitiveDiagnostic } from './version-history-diagnostic-projection-access-fixtures';
import { expectNoForbiddenDetails } from './version-history-diagnostic-projection-test-utils';

export function registerVersionHistoryCapabilityDeniedProjectionScenarios(): void {
  it('projects capability denials to public summaries without sensitive diagnostic details', () => {
    const projected = projectVersionHistoryDiagnosticsForAccess(
      [
        sensitiveDiagnostic({
          capability: 'version:commit',
          deniedCapabilities: ['version:commit', 'agent:trace', 'protected:range'],
        }),
      ],
      {
        kind: 'capability-denied',
        capability: 'version:read',
        deniedCapabilities: ['version:read', 'version:diff', 'agent:trace', 'protected:range'],
        dependency: 'hostCapability',
        retryable: false,
      },
    );

    expect(projected).toEqual([
      {
        code: 'version_capability_unavailable',
        severity: 'error',
        message: 'Version history capability is denied for this caller.',
        dependency: 'hostCapability',
        data: {
          kind: 'capability-denied',
          capability: 'version:read',
          deniedCapabilities: ['version:read', 'version:diff'],
          retryable: false,
        },
      },
    ]);
    expectNoForbiddenDetails(projected);
  });
}
