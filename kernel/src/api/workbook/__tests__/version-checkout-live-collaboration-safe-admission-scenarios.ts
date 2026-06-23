import { expect, it, jest } from '@jest/globals';

import {
  createMockCtx,
  createWorkbook,
  plannedCheckoutResult,
} from './version-checkout-live-collaboration-test-utils';

export function registerLiveCollaborationSafeAdmissionScenarios() {
  it.each(['absent', 'disabled', 'idle'] as const)(
    'allows checkout when live collaboration state is %s',
    async (collaborationState) => {
      const commitId = `commit:sha256:${'9'.repeat(64)}`;
      const checkout = jest.fn(async () => plannedCheckoutResult(commitId));
      const wb = createWorkbook({
        ctx: createMockCtx({
          versioning: {
            checkoutService: { checkout },
            readLiveCollaborationStatus: () => ({
              state: collaborationState,
              statusRevision: `live:${collaborationState}`,
            }),
          },
        }),
      });

      await expect(wb.version.getSurfaceStatus()).resolves.toMatchObject({
        dirty: {
          checkoutSafe: true,
          liveCollaboration: {
            state: collaborationState,
          },
          unsafeReasons: [],
        },
      });

      await expect(wb.version.checkout({ kind: 'commit', id: commitId })).resolves.toMatchObject({
        ok: true,
        value: {
          materialization: 'planned',
          mutationGuarantee: 'no-workbook-mutation',
        },
      });
      expect(checkout).toHaveBeenCalledTimes(1);
    },
  );
}
