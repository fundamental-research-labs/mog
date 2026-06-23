import { projectVersionHistoryDiagnosticsForAccess } from '../version-history-diagnostic-projection';
import {
  sensitiveDiagnostic,
  sensitiveDomainDiagnosticCases,
} from './version-history-diagnostic-projection-access-fixtures';
import { expectNoForbiddenDetails } from './version-history-diagnostic-projection-test-utils';

describe('version history access diagnostic projection', () => {
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

  it('does not derive public capabilities from denied diagnostic payloads', () => {
    const projected = projectVersionHistoryDiagnosticsForAccess(
      [
        sensitiveDiagnostic({
          payload: {
            events: [
              {
                principalId: 'principal-secret',
                ref: { capability: 'version:proposal' },
                path: { deniedCapabilities: ['version:mergeApply'] },
                value: {
                  capability: 'version:commit',
                  deniedCapabilities: ['version:branch'],
                },
                valueDigest: {
                  capability: 'version:proposal',
                  deniedCapabilities: ['version:mergeApply'],
                },
                mergeResultId: {
                  deniedCapabilities: ['version:remotePromote'],
                },
              },
              {
                capability: 'version:diff',
                deniedCapabilities: ['version:read', 'principal:secret', 'refs/heads/secret'],
              },
              {
                nested: [
                  {
                    deniedCapabilities: [
                      'version:checkout',
                      {
                        capability: 'version:branch',
                        value: 'raw-value-secret',
                      },
                    ],
                  },
                ],
              },
            ],
            rawValue: 'version:reviewWrite',
          },
        }),
      ],
      {
        kind: 'access-denied',
      },
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
    expectNoForbiddenDetails(projected);
    expect(JSON.stringify(projected)).not.toContain('version:read');
    expect(JSON.stringify(projected)).not.toContain('version:checkout');
    expect(JSON.stringify(projected)).not.toContain('version:branch');
    expect(JSON.stringify(projected)).not.toContain('version:diff');
    expect(JSON.stringify(projected)).not.toContain('version:proposal');
    expect(JSON.stringify(projected)).not.toContain('version:mergeApply');
    expect(JSON.stringify(projected)).not.toContain('version:commit');
    expect(JSON.stringify(projected)).not.toContain('version:reviewWrite');
    expect(JSON.stringify(projected)).not.toContain('version:remotePromote');
  });

  it('replaces source access-denied messages with a fixed public message', () => {
    const projected = projectVersionHistoryDiagnosticsForAccess(
      [
        {
          code: 'VERSION_PERMISSION_DENIED',
          severity: 'error',
          message: 'Denied principal-secret on refs/heads/secret at Sheet1!A1 with salary-secret.',
          data: {
            capability: 'version:read',
            principalId: 'principal-secret',
            ref: 'refs/heads/secret',
            path: 'Sheet1!A1',
            value: 'salary-secret',
          },
        },
      ],
      {
        kind: 'access-denied',
      },
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
    expectNoForbiddenDetails(projected);
  });

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
});
