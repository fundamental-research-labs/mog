import type { VersionDiagnostic, VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import { projectVersionHistoryDiagnosticsForAccess } from '../version-history-diagnostic-projection';
import { versionFailureFromStoreDiagnostics } from '../version-result';

const FORBIDDEN_DETAIL_TERMS = [
  'hidden',
  'deleted',
  'protected',
  'agent',
  'opaque',
  'principal-secret',
  'user-secret',
  'refs/heads',
  'sheet1!a1',
  'salary-secret',
  'raw-value-secret',
  'commit-secret',
];

describe('version history diagnostic projection', () => {
  it('projects capability denials to public summaries without sensitive diagnostic details', () => {
    const projected = projectVersionHistoryDiagnosticsForAccess(
      [
        sensitiveDiagnostic({
          capability: 'version:read',
          deniedCapabilities: ['version:read', 'version:diff', 'agent:trace', 'protected:range'],
        }),
      ],
      {
        kind: 'capability-denied',
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
          diagnosticCount: 1,
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
        code: 'version_access_denied',
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
          diagnosticCount: 1,
          capability: 'version:reviewRead',
          deniedCapabilities: ['version:reviewRead'],
        },
      },
    ]);
    expectNoForbiddenDetails(projected);
  });

  it('extracts nested public capabilities without leaking raw principal, ref, path, or value payloads', () => {
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
          diagnosticCount: 1,
          capability: 'version:diff',
          deniedCapabilities: [
            'version:read',
            'version:checkout',
            'version:branch',
            'version:diff',
          ],
        },
      },
    ]);
    expectNoForbiddenDetails(projected);
    expect(JSON.stringify(projected)).not.toContain('version:proposal');
    expect(JSON.stringify(projected)).not.toContain('version:mergeApply');
    expect(JSON.stringify(projected)).not.toContain('version:commit');
    expect(JSON.stringify(projected)).not.toContain('version:reviewWrite');
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
          diagnosticCount: 1,
          capability: 'version:read',
          deniedCapabilities: ['version:read'],
        },
      },
    ]);
    expectNoForbiddenDetails(projected);
  });

  it('uses summary projection for host-denied result diagnostics', () => {
    const result = versionFailureFromStoreDiagnostics('getHead', [hostDeniedStoreDiagnostic()]);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'version_capability_unavailable',
        capability: 'version:read',
        dependency: 'hostCapability',
        reason: 'Version history capability is denied for this caller.',
        retryable: false,
        diagnostics: [
          {
            code: 'version_capability_unavailable',
            severity: 'error',
            message: 'Version history capability is denied for this caller.',
            dependency: 'hostCapability',
            data: {
              kind: 'capability-denied',
              diagnosticCount: 1,
              capability: 'version:read',
              deniedCapabilities: ['version:read'],
              retryable: false,
            },
          },
        ],
      },
    });
    expectNoForbiddenDetails(result);
  });
});

function sensitiveDiagnostic(data: NonNullable<VersionDiagnostic['data']>): VersionDiagnostic {
  return {
    code: 'version.surfaceStatus.hostCapabilityDenied',
    severity: 'error',
    message:
      'Raw detail mentions hidden sheets, deleted rows, protected ranges, agent traces, and opaque payloads.',
    dependency: 'hostCapability',
    data: {
      ...data,
      hiddenSheetId: 'sheet-secret',
      deletedRowId: 'row-secret',
      protectedRangeId: 'range-secret',
      agentTraceId: 'run-secret',
      opaqueObjectDigest: 'digest-secret',
    } as VersionDiagnostic['data'],
  };
}

function hostDeniedStoreDiagnostic(): VersionStoreDiagnostic {
  return {
    issueCode: 'VERSION_CAPABILITY_DISABLED',
    severity: 'error',
    recoverability: 'none',
    messageTemplateId: 'version.getHead.capabilityDisabled',
    safeMessage:
      'Host policy denies version:read with hidden, deleted, protected, agent, and opaque raw details.',
    payload: {
      operation: 'getHead',
      capability: 'version:read',
      reason: 'hostCapabilityDenied',
      hiddenSheetId: 'sheet-secret',
      deletedRowId: 'row-secret',
      protectedRangeId: 'range-secret',
      agentTraceId: 'run-secret',
      opaqueObjectDigest: 'digest-secret',
      principalId: 'principal-secret',
      ref: 'refs/heads/secret',
      path: 'Sheet1!A1',
      value: 'salary-secret',
    },
    redacted: true,
  };
}

function expectNoForbiddenDetails(value: unknown): void {
  const serialized = JSON.stringify(value).toLowerCase();
  for (const term of FORBIDDEN_DETAIL_TERMS) {
    expect(serialized).not.toContain(term);
  }
}
