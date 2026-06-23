import {
  evaluateVersionHistoryRootPolicy,
  type VersionHistoryRootKind,
} from '../version-history-root-policy';

const PUBLIC_DEFAULT_POLICY = Object.freeze({
  allowDetachedRoots: false,
  gapPolicy: 'reject',
});

const GAP_RECORDING_POLICY = Object.freeze({
  allowDetachedRoots: true,
  gapPolicy: 'record-gap',
});

const SECRET_ROOT_COMMIT = `commit:sha256:${'a'.repeat(64)}`;
const SECRET_ROOT_KIND = 'secret-root-kind';

describe('VersionHistoryRootPolicy diagnostics', () => {
  it.each([
    ['new', false, true, undefined],
    ['import', false, true, undefined],
    ['existing-no-history', true, false, 'history-gap-rejected'],
    ['external-change', true, true, undefined],
    ['reconcile', true, false, 'history-gap-rejected'],
    ['recovery', true, false, 'history-gap-rejected'],
  ] satisfies readonly [VersionHistoryRootKind, boolean, boolean, string | undefined][])(
    'evaluates public default policy for %s roots',
    (kind, hasExistingVisibleHistory, expectedOk, reason) => {
      const result = evaluateVersionHistoryRootPolicy({
        kind,
        policy: PUBLIC_DEFAULT_POLICY,
        operation: kind === 'external-change' ? 'commitGraphWrite' : 'initializeGraph',
        hasExistingVisibleHistory,
        trustedBase: kind === 'external-change',
      });

      expect(result.ok).toBe(expectedOk);
      if (expectedOk) {
        expect(result.diagnostics).toEqual([]);
        return;
      }
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'VERSION_HISTORY_ROOT_POLICY_BLOCKED',
          safeMessage: expect.any(String),
          redacted: true,
          mutationGuarantee: 'no-write-attempted',
          details: expect.objectContaining({
            rootPolicy: 'default-history-root-policy',
            rootKind: kind,
            reason,
            gapPolicy: 'reject',
            redacted: true,
          }),
        }),
      ]);
    },
  );

  it('blocks detached primary roots when existing history is present', () => {
    const result = evaluateVersionHistoryRootPolicy({
      kind: 'import',
      policy: PUBLIC_DEFAULT_POLICY,
      operation: 'initializeGraph',
      hasExistingVisibleHistory: true,
    });

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: 'VERSION_HISTORY_ROOT_POLICY_BLOCKED',
          safeMessage: 'Version history root policy does not allow detached roots.',
          details: {
            rootKind: 'import',
            reason: 'detached-root-disallowed',
            allowDetachedRoots: false,
            gapPolicy: 'reject',
            redacted: true,
          },
        },
      ],
    });
  });

  it('allows gap roots only when the policy explicitly records gaps or opaque roots', () => {
    for (const kind of ['existing-no-history', 'reconcile', 'recovery'] as const) {
      expect(
        evaluateVersionHistoryRootPolicy({
          kind,
          policy: GAP_RECORDING_POLICY,
          operation: 'initializeGraph',
          hasExistingVisibleHistory: true,
        }),
      ).toEqual({ ok: true, diagnostics: [] });
    }
  });

  it('requires verified history and a trusted base for external-change roots', () => {
    const noHistory = evaluateVersionHistoryRootPolicy({
      kind: 'external-change',
      policy: PUBLIC_DEFAULT_POLICY,
      operation: 'commitGraphWrite',
      hasExistingVisibleHistory: false,
      trustedBase: true,
    });
    const untrustedBase = evaluateVersionHistoryRootPolicy({
      kind: 'external-change',
      policy: PUBLIC_DEFAULT_POLICY,
      operation: 'commitGraphWrite',
      hasExistingVisibleHistory: true,
      trustedBase: false,
    });

    expect(noHistory.diagnostics[0]).toMatchObject({
      code: 'VERSION_HISTORY_ROOT_POLICY_BLOCKED',
      details: { rootKind: 'external-change', reason: 'external-change-history-unverified' },
    });
    expect(untrustedBase.diagnostics[0]).toMatchObject({
      code: 'VERSION_HISTORY_ROOT_POLICY_BLOCKED',
      details: { rootKind: 'external-change', reason: 'external-change-base-untrusted' },
    });
  });

  it('fails closed without leaking malformed policy or unknown root details', () => {
    const result = evaluateVersionHistoryRootPolicy({
      kind: SECRET_ROOT_KIND,
      policy: {
        rootCommitId: SECRET_ROOT_COMMIT,
        allowDetachedRoots: 'yes',
        gapPolicy: 'secret-gap-policy',
      } as never,
      operation: 'initializeGraph',
      hasExistingVisibleHistory: 'unknown',
      trustedBase: 'unknown',
    });

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_HISTORY_ROOT_POLICY_BLOCKED',
          safeMessage: 'Version history root policy could not validate this root transition.',
          details: expect.objectContaining({
            rootKind: 'unknown',
            reason: 'unknown-root-kind',
            rootCommitPolicy: 'configured',
            allowDetachedRoots: false,
            gapPolicy: 'reject',
            redacted: true,
          }),
        }),
      ],
    });
    expect(JSON.stringify(result.diagnostics)).not.toContain(SECRET_ROOT_COMMIT);
    expect(JSON.stringify(result.diagnostics)).not.toContain(SECRET_ROOT_KIND);
    expect(JSON.stringify(result.diagnostics)).not.toContain('secret-gap-policy');
  });
});
