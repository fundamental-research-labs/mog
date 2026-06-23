import type { VersionDiagnostic, VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import { evaluateVersionHistoryRootPolicy } from '../../../document/version-store/version-history-root-policy';
import { projectVersionHistoryDiagnosticsForAccess } from '../version-history-diagnostic-projection';
import { versionFailureFromStoreDiagnostics } from '../version-result';

const FORBIDDEN_DETAIL_TERMS = [
  'hidden',
  'deleted',
  'protected',
  'external',
  'agent',
  'opaque',
  'principal-secret',
  'user-secret',
  'refs/heads',
  'sheet1!a1',
  'salary-secret',
  'raw-value-secret',
  'commit-secret',
  'namespace-secret',
  'client-secret',
  'session-secret',
  'graph-secret',
];

describe('version history diagnostic projection', () => {
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

  it('projects provider stale-head diagnostics without namespace, ref, or client material', () => {
    const result = versionFailureFromStoreDiagnostics('commit', [staleHeadStoreDiagnostic()]);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.commit',
        diagnostics: [
          {
            code: 'VERSION_REF_CONFLICT',
            severity: 'error',
            message:
              'Version history head changed before the operation completed; refresh and retry.',
            owner: 'version-store',
            data: {
              operation: 'commitGraphWrite',
              recoverability: 'retry',
              messageTemplateId: 'version.ref.conflict',
              redacted: true,
              payload: {
                operation: 'commitGraphWrite',
                condition: 'stale-head',
                completenessCondition: 'stale',
                refName: 'redacted',
                head: 'redacted',
                historyHead: 'stale',
              },
              mutationGuarantee: 'ref-not-mutated',
            },
          },
        ],
      },
    });
    expectNoForbiddenDetails(result);
  });

  it('projects provider history-gap diagnostics with only coarse completeness markers', () => {
    const result = versionFailureFromStoreDiagnostics('listCommits', [historyGapStoreDiagnostic()]);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.listCommits',
        diagnostics: [
          {
            code: 'VERSION_MISSING_PARENT',
            severity: 'error',
            message:
              'Version history has a gap; refresh or repair the provider history before retrying.',
            owner: 'version-store',
            data: {
              operation: 'listCommits',
              recoverability: 'repair',
              messageTemplateId: 'version.integrity.missing-parent',
              redacted: true,
              payload: {
                operation: 'listCommits',
                completenessMarker: 'diagnostic-read',
                completenessScope: 'graph-metadata',
                completenessCondition: 'history-gap',
                accessFiltered: true,
                missingCommitRole: 'parent',
                condition: 'history-gap',
                historyCompleteness: 'history-gap',
              },
            },
          },
        ],
      },
    });
    expectNoForbiddenDetails(result);
  });

  it('projects root-policy store diagnostics without root identifiers or raw policy material', () => {
    const decision = evaluateVersionHistoryRootPolicy({
      kind: 'existing-no-history',
      policy: {
        rootCommitId: 'commit-secret-root',
        allowDetachedRoots: false,
        gapPolicy: 'reject',
      },
      operation: 'initializeGraph',
      hasExistingVisibleHistory: true,
      trustedBase: false,
      rootCommitMatchesPolicy: false,
    });
    if (decision.ok) throw new Error('expected root policy block');

    const result = versionFailureFromStoreDiagnostics(
      'getHead',
      decision.diagnostics as readonly VersionStoreDiagnostic[],
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.getHead',
        diagnostics: [
          {
            code: 'VERSION_HISTORY_ROOT_POLICY_BLOCKED',
            severity: 'error',
            message: 'Version history root policy does not match this root transition.',
            owner: 'version-store',
            data: {
              operation: 'initializeGraph',
              recoverability: 'unsupported',
              messageTemplateId: 'version.history-root-policy.blocked',
              redacted: true,
              mutationGuarantee: 'no-write-attempted',
            },
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('commit-secret-root');
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

function sensitiveDomainDiagnosticCases(): readonly (readonly VersionDiagnostic[])[] {
  const cases = [
    sensitiveDiagnostic({
      domain: 'hidden-sheet',
      capability: 'version:read',
      hiddenSheetId: 'hidden-domain-secret',
    }),
    sensitiveDiagnostic({
      domain: 'protected-range',
      deniedCapabilities: ['version:diff'],
      protectedRangeId: 'protected-domain-secret',
    }),
    sensitiveDiagnostic({
      domain: 'deleted-object',
      capability: 'version:commit',
      deletedObjectId: 'deleted-domain-secret',
    }),
    sensitiveDiagnostic({
      domain: 'external-link',
      deniedCapabilities: ['version:remotePromote'],
      externalTargetId: 'external-domain-secret',
    }),
    sensitiveDiagnostic({
      domain: 'agent-proposal',
      capability: 'version:proposal',
      agentRunId: 'agent-domain-secret',
    }),
    sensitiveDiagnostic({
      domain: 'opaque-payload',
      deniedCapabilities: ['version:provenance'],
      opaqueObjectDigest: 'opaque-domain-secret',
    }),
  ] as const;

  return cases.map((diagnostic, index) => [diagnostic, ...cases.slice(0, index)]);
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

function staleHeadStoreDiagnostic(): VersionStoreDiagnostic {
  return {
    issueCode: 'VERSION_REF_CONFLICT',
    severity: 'error',
    recoverability: 'retry',
    messageTemplateId: 'version.ref.conflict',
    safeMessage:
      'Ref refs/heads/secret moved from commit:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa for client-secret-id.',
    payload: {
      operation: 'commitGraphWrite',
      reason: 'staleTargetHead',
      clientId: 'client-secret-id',
      sessionId: 'session-secret-id',
    },
    redacted: true,
    mutationGuarantee: 'ref-not-mutated',
    operation: 'commitGraphWrite',
    namespace: {
      documentId: 'namespace-secret-document',
      workspaceId: 'namespace-secret-workspace',
      graphId: 'graph-secret',
    },
    refName: 'refs/heads/secret',
    commitId: 'commit:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    details: {
      expectedHead:
        'commit:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      actualHead: 'commit:sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      providerRefId: 'ref-secret',
      clientId: 'client-secret-id',
      sessionId: 'session-secret-id',
    },
    sourceDiagnostics: [
      {
        message: 'client-secret-id saw refs/heads/secret',
        details: { clientId: 'client-secret-id', sessionId: 'session-secret-id' },
      },
    ],
  } as unknown as VersionStoreDiagnostic;
}

function historyGapStoreDiagnostic(): VersionStoreDiagnostic {
  return {
    issueCode: 'VERSION_MISSING_PARENT',
    severity: 'error',
    recoverability: 'repair',
    messageTemplateId: 'version.integrity.missing-parent',
    safeMessage:
      'Missing parent commit:sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd in refs/heads/secret for namespace-secret.',
    redacted: true,
    operation: 'listCommits',
    namespace: {
      documentId: 'namespace-secret-document',
      workspaceId: 'namespace-secret-workspace',
      graphId: 'graph-secret',
    },
    refName: 'refs/heads/secret',
    commitId: 'commit:sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    details: {
      completenessMarker: 'diagnostic-read',
      completenessScope: 'graph-metadata',
      completenessCondition: 'history-gap',
      accessFiltered: true,
      missingCommitRole: 'parent',
      childCommitId:
        'commit:sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      clientId: 'client-secret-id',
      sessionId: 'session-secret-id',
      namespaceKey: 'namespace-secret-key',
    },
    sourceDiagnostics: [
      {
        code: 'VERSION_MISSING_PARENT',
        severity: 'corruption',
        message: 'history gap on refs/heads/secret for client-secret-id',
        details: {
          completenessCondition: 'history-gap',
          missingCommitRole: 'parent',
          clientId: 'client-secret-id',
        },
      },
    ],
  } as unknown as VersionStoreDiagnostic;
}

function expectNoForbiddenDetails(value: unknown): void {
  const serialized = JSON.stringify(value).toLowerCase();
  for (const term of FORBIDDEN_DETAIL_TERMS) {
    expect(serialized).not.toContain(term);
  }
}
