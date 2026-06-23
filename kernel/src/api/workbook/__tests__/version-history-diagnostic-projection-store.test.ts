import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import { evaluateVersionHistoryRootPolicy } from '../../../document/version-store/version-history-root-policy';
import { versionFailureFromStoreDiagnostics } from '../version-result';
import {
  historyGapStoreDiagnostic,
  hostDeniedStoreDiagnostic,
  staleHeadStoreDiagnostic,
} from './version-history-diagnostic-projection-store-fixtures';
import { expectNoForbiddenDetails } from './version-history-diagnostic-projection-test-utils';

describe('version history store diagnostic projection', () => {
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
