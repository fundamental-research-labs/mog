import type { VersionDiagnostic, VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import { projectVersionHistoryDiagnosticsForAccess } from '../version-history-diagnostic-projection';
import { versionFailureFromStoreDiagnostics } from '../version-result';

const FORBIDDEN_DETAIL_TERMS = ['hidden', 'deleted', 'protected', 'agent', 'opaque'];

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
