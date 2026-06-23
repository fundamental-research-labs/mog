import { expect, it, jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import {
  expectFailureDiagnosticsRedactedNoWrite,
  singleCommitInput,
  versionWithMutationGuards,
} from './version-revert-test-utils';

export function registerRevertAdmissionCapabilityScenarios(): void {
  it.each([
    {
      label: 'versionControl feature gate',
      ctx: { featureGates: { capabilities: { versionControl: false } } },
      message: 'The versionControl feature gate is disabled for this workbook.',
      reason: 'versionControlDisabled',
    },
    {
      label: 'editing feature gate',
      ctx: { featureGates: { editing: false } },
      message: 'Workbook editing is disabled by host feature gates.',
      reason: 'editingDisabled',
    },
  ])(
    'blocks revert before provider access when disabled by $label',
    async ({ ctx, message, reason }) => {
      const revert = jest.fn();
      const version = new WorkbookVersionImpl({
        ...ctx,
        versioning: { revertService: { revert } },
      } as any);

      await expect(version.revert(singleCommitInput())).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.revert',
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CAPABILITY_DISABLED',
              message,
              data: expect.objectContaining({
                mutationGuarantee: 'no-write-attempted',
                payload: expect.objectContaining({
                  operation: 'revert',
                  capability: 'version:revert',
                  reason,
                }),
              }),
            }),
          ],
        },
      });
      expect(revert).not.toHaveBeenCalled();
    },
  );

  it('rejects host-disabled revert capability before provider access or ref mutation', async () => {
    const { version, mutationGuards } = versionWithMutationGuards({
      hostPolicy: {
        decisions: [{ capability: 'version:revert', decision: 'denied' }],
      },
    });

    const result = await version.revert(singleCommitInput(), { includeDiagnostics: true });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.revert',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CAPABILITY_DISABLED',
            message: 'Host policy denies version:revert.',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'revert',
                capability: 'version:revert',
                reason: 'hostCapabilityDenied',
              }),
            }),
          }),
        ],
      },
    });
    expectFailureDiagnosticsRedactedNoWrite(result, mutationGuards);
  });
}
