import { projectVersionHistoryDiagnosticsForAccess } from '../version/history-diagnostics/version-history-diagnostic-projection';
import { sensitiveDiagnostic } from './version-history-diagnostic-projection-access-fixtures';
import { expectNoForbiddenDetails } from './version-history-diagnostic-projection-test-utils';

export function registerVersionHistoryNonPublicAccessMetadataScenarios(): void {
  it('does not reflect custom access codes or non-public access metadata', () => {
    const nonPublicAccess = {
      kind: 'capability-denied',
      code: 'hidden_external_agent_opaque_access_code',
      capability: 'agent:trace',
      deniedCapabilities: ['external:link', 'version:diff', 'opaque:payload'],
      dependency: 'deleted-domain-store',
      retryable: true,
    } as const;

    const projected = projectVersionHistoryDiagnosticsForAccess(
      [sensitiveDiagnostic({ capability: 'version:commit' })],
      nonPublicAccess,
    );

    expect(projected).toEqual([
      {
        code: 'version_capability_unavailable',
        severity: 'error',
        message: 'Version history capability is denied for this caller.',
        data: {
          kind: 'capability-denied',
          deniedCapabilities: ['version:diff'],
          retryable: true,
        },
      },
    ]);
    expectNoForbiddenDetails(projected);
  });
}
