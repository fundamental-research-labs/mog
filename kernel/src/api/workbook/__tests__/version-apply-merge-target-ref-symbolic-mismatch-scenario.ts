import type { VersionRefName } from '@mog-sdk/contracts/api';

import { validateApplyMergeTargetRefCasProof } from '../version/apply-merge/target-ref/version-apply-merge-target-ref';
import {
  EXPECTED_TARGET_HEAD,
  TARGET_REF,
  ctxWithReadRef,
  targetRef,
} from './version-apply-merge-target-ref-test-utils';

export function registerTargetRefSymbolicMismatchScenario(): void {
  it('blocks when symbolic HEAD resolves away from the public target ref without leaking private refs', async () => {
    const privateRef = 'refs/heads/review/private-plan' as VersionRefName;
    const result = await validateApplyMergeTargetRefCasProof(
      await ctxWithReadRef(async (name): Promise<unknown> => {
        if (name === TARGET_REF) return targetRef();
        return {
          status: 'success' as const,
          ref: {
            name: 'HEAD' as const,
            target: privateRef,
            revision: { kind: 'counter' as const, value: 'head-1' },
          },
          diagnostics: [],
        };
      }),
      { targetRef: TARGET_REF, expectedTargetHead: EXPECTED_TARGET_HEAD },
    );

    expect(result).toMatchObject({
      ok: false,
      kind: 'blocked',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_REF_CONFLICT',
          payload: expect.objectContaining({
            operation: 'applyMerge',
            reason: 'symbolicTargetMismatch',
            expectedTargetRef: TARGET_REF,
            actualTargetRef: 'redacted',
          }),
        }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain(privateRef);
  });
}
