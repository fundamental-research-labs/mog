import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

export function hostDeniedStoreDiagnostic(): VersionStoreDiagnostic {
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

export function staleHeadStoreDiagnostic(): VersionStoreDiagnostic {
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

export function historyGapStoreDiagnostic(): VersionStoreDiagnostic {
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
