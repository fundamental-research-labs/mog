import {
  VersionPublicApiValueError,
  VersionResultError,
  branchName,
  branchRef,
  expectedHeadFromRef,
  formatVersionDiagnostics,
  isVersionBlocked,
  isVersionBranchName,
  isVersionObjectDigest,
  isVersionRefName,
  isVersionStaleTarget,
  isWorkbookCommitId,
  parseVersionBranchName,
  parseVersionObjectDigest,
  parseVersionRefName,
  parseWorkbookCommitId,
  unwrapVersionResult,
} from '../index';
import {
  branchRef as apiBranchRef,
  parseWorkbookCommitId as apiParseWorkbookCommitId,
} from '../../api';
import {
  branchName as workbookBranchName,
  parseVersionRefName as workbookParseVersionRefName,
} from '../../api/workbook';
import type {
  ObjectDigest,
  VersionRef,
  VersionResult,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '../../api';

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const COMMIT_A = `commit:sha256:${HEX_A}` as const;
const COMMIT_B = `commit:sha256:${HEX_B}` as const;

const revision = Object.freeze({
  kind: 'counter',
  value: '12',
} as const);

const ref = Object.freeze({
  name: 'refs/heads/analysis' as const,
  commitId: COMMIT_A,
  revision,
  updatedAt: '2026-06-27T00:00:00.000Z',
} satisfies VersionRef);

const staleDiagnostic = Object.freeze({
  issueCode: 'VERSION_REF_CONFLICT',
  severity: 'error',
  recoverability: 'retry',
  messageTemplateId: 'version.test.refConflict',
  safeMessage: 'Branch moved before apply.',
  payload: { targetRef: 'refs/heads/main' },
  redacted: false,
  mutationGuarantee: 'ref-not-mutated',
} satisfies VersionStoreDiagnostic);

const blockedDiagnostic = Object.freeze({
  issueCode: 'VERSION_MISSING_DEPENDENCY',
  severity: 'fatal',
  recoverability: 'repair',
  messageTemplateId: 'version.test.blocked',
  safeMessage: 'Version graph is unavailable.',
  redacted: false,
  mutationGuarantee: 'no-write-attempted',
} satisfies VersionStoreDiagnostic);

describe('public version API helpers', () => {
  it('parses and guards workbook commit ids', () => {
    expect(parseWorkbookCommitId(COMMIT_A)).toBe(COMMIT_A);
    expect(isWorkbookCommitId(COMMIT_A)).toBe(true);
    expect(isWorkbookCommitId(`commit:sha256:${'A'.repeat(64)}`)).toBe(false);
    expect(isWorkbookCommitId('commit:sha256:not-hex')).toBe(false);
    expect(() => parseWorkbookCommitId(COMMIT_A.slice(0, -1))).toThrow(
      VersionPublicApiValueError,
    );
  });

  it('parses and guards sha256 object digests', () => {
    const digest = parseVersionObjectDigest({
      algorithm: 'sha256',
      digest: HEX_A,
      byteLength: 32,
    });

    expect(digest).toEqual({
      algorithm: 'sha256',
      digest: HEX_A,
      byteLength: 32,
    } satisfies ObjectDigest);
    expect(Object.isFrozen(digest)).toBe(true);
    expect(isVersionObjectDigest(digest)).toBe(true);
    expect(isVersionObjectDigest({ algorithm: 'blake3', digest: HEX_A })).toBe(false);
    expect(isVersionObjectDigest({ algorithm: 'sha256', value: HEX_A })).toBe(false);
    expect(() =>
      parseVersionObjectDigest({ algorithm: 'sha256', digest: HEX_A, extra: true }),
    ).toThrow(VersionPublicApiValueError);
  });

  it('parses public branch names and canonical refs separately', () => {
    expect(parseVersionBranchName('main')).toBe('main');
    expect(parseVersionBranchName('team/q2-forecast')).toBe('team/q2-forecast');
    expect(isVersionBranchName('refs/heads/main')).toBe(false);
    expect(isVersionBranchName('Team/Q2')).toBe(false);
    expect(isVersionBranchName('main/feature')).toBe(false);
    expect(isVersionBranchName('HEAD')).toBe(false);

    expect(parseVersionRefName('refs/heads/main')).toBe('refs/heads/main');
    expect(parseVersionRefName('refs/heads/team/q2-forecast')).toBe(
      'refs/heads/team/q2-forecast',
    );
    expect(isVersionRefName('main')).toBe(false);
    expect(isVersionRefName('refs/tags/v1')).toBe(false);
  });

  it('converts between branch names, canonical refs, and expected heads', () => {
    expect(branchRef('main')).toBe('refs/heads/main');
    expect(branchRef('analysis')).toBe('refs/heads/analysis');
    expect(branchRef('refs/heads/analysis')).toBe('refs/heads/analysis');
    expect(branchName('refs/heads/main')).toBe('main');
    expect(branchName('refs/heads/analysis')).toBe('analysis');
    expect(expectedHeadFromRef(ref)).toEqual({
      commitId: COMMIT_A,
      revision,
    });
  });

  it('unwraps successful results and throws a typed error for failures', () => {
    const ok = Object.freeze({
      ok: true,
      value: COMMIT_B as WorkbookCommitId,
    } satisfies VersionResult<WorkbookCommitId>);
    const failed = Object.freeze({
      ok: false,
      error: {
        code: 'stale_head',
        expectedHeadId: COMMIT_A,
        actualHeadId: COMMIT_B,
      },
    } satisfies VersionResult<WorkbookCommitId>);

    expect(unwrapVersionResult(ok)).toBe(COMMIT_B);
    expect(() => unwrapVersionResult(failed)).toThrow(VersionResultError);
    expect(() => unwrapVersionResult(failed)).toThrow('Stale head');
  });

  it('formats diagnostics and detects blocked or stale public results', () => {
    expect(formatVersionDiagnostics([staleDiagnostic, blockedDiagnostic])).toBe(
      [
        'ERROR VERSION_REF_CONFLICT: Branch moved before apply.',
        'FATAL VERSION_MISSING_DEPENDENCY: Version graph is unavailable.',
      ].join('\n'),
    );

    expect(isVersionBlocked({ status: 'blocked', diagnostics: [blockedDiagnostic] })).toBe(true);
    expect(isVersionBlocked({ ok: true, value: { status: 'conflicted' } })).toBe(true);
    expect(
      isVersionBlocked({
        ok: false,
        error: {
          code: 'version_capability_unavailable',
          capability: 'version:mergePreview',
          reason: 'merge preview disabled',
          retryable: false,
        },
      }),
    ).toBe(true);
    expect(isVersionBlocked({ status: 'clean' })).toBe(false);

    expect(isVersionStaleTarget({ status: 'staleTargetHead' })).toBe(true);
    expect(isVersionStaleTarget({ status: 'blocked', diagnostics: [staleDiagnostic] })).toBe(true);
    expect(
      isVersionStaleTarget({
        ok: false,
        error: {
          code: 'stale_head',
          expectedHeadId: COMMIT_A,
          actualHeadId: COMMIT_B,
        },
      }),
    ).toBe(true);
    expect(isVersionStaleTarget({ status: 'blocked', diagnostics: [blockedDiagnostic] })).toBe(
      false,
    );
  });

  it('re-exports helper values from API barrels', () => {
    expect(apiParseWorkbookCommitId).toBe(parseWorkbookCommitId);
    expect(apiBranchRef).toBe(branchRef);
    expect(workbookParseVersionRefName).toBe(parseVersionRefName);
    expect(workbookBranchName).toBe(branchName);
  });
});
