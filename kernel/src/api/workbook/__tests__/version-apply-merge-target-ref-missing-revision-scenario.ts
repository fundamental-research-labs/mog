import { validateApplyMergeTargetRefCasProof } from '../version/apply-merge/target-ref/version-apply-merge-target-ref';
import {
  EXPECTED_TARGET_HEAD,
  TARGET_REF,
  ctxWithReadRef,
  symbolicHead,
  targetRef,
} from './version-apply-merge-target-ref-test-utils';

export function registerTargetRefMissingRevisionScenario(): void {
  it('blocks target refs that do not expose a ref revision proof', async () => {
    const result = await validateApplyMergeTargetRefCasProof(
      await ctxWithReadRef(async (name): Promise<unknown> => {
        if (name === TARGET_REF) {
          return targetRef({ revision: undefined });
        }
        return symbolicHead();
      }),
      { targetRef: TARGET_REF, expectedTargetHead: EXPECTED_TARGET_HEAD },
    );

    expect(result).toMatchObject({
      ok: false,
      kind: 'blocked',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_PROVIDER_FAILED',
          safeMessage: 'The target ref revision is unavailable for applyMerge CAS validation.',
          payload: expect.objectContaining({
            operation: 'applyMerge',
            reason: 'missingTargetRefRevision',
            targetRef: TARGET_REF,
          }),
        }),
      ],
    });
  });
}
