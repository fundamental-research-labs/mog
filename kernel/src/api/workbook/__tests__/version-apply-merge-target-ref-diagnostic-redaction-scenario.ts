import { validateApplyMergeTargetRefCasProof } from '../version/apply-merge/target-ref/version-apply-merge-target-ref';
import {
  EXPECTED_TARGET_HEAD,
  TARGET_REF,
  ctxWithReadRef,
} from './version-apply-merge-target-ref-test-utils';

export function registerTargetRefDiagnosticRedactionScenario(): void {
  it('redacts unsafe provider ref names from mapped diagnostics', async () => {
    const secretRef = 'refs/heads/review/secret-draft';
    const result = await validateApplyMergeTargetRefCasProof(
      await ctxWithReadRef(
        async (): Promise<unknown> => ({
          status: 'degraded' as const,
          ref: null,
          diagnostics: [
            {
              code: 'VERSION_DANGLING_REF',
              message: `could not read ${secretRef}`,
              safeMessage: `could not read ${secretRef}`,
              recoverability: 'repair',
              refName: secretRef,
            },
          ],
        }),
      ),
      { targetRef: TARGET_REF, expectedTargetHead: EXPECTED_TARGET_HEAD },
    );

    expect(result).toMatchObject({
      ok: false,
      kind: 'blocked',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_DANGLING_REF',
          safeMessage: 'Version applyMerge target-ref CAS validation failed.',
          recoverability: 'repair',
        }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain(secretRef);
  });
}
