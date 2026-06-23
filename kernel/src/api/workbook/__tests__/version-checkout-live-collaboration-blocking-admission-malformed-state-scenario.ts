import { expect, it, jest } from '@jest/globals';

import {
  createMockCtx,
  createWorkbook,
  expectNoRawCollaborationIdentifiers,
  plannedCheckoutResult,
  RAW_PROVIDER_ID,
  RAW_ROOM_ID,
  RAW_USER_ID,
} from './version-checkout-live-collaboration-test-utils';

export function registerLiveCollaborationBlockingAdmissionMalformedStateScenario() {
  it('fails closed and redacts identifiers when live collaboration state is malformed', async () => {
    const commitId = `commit:sha256:${'7'.repeat(64)}`;
    const checkout = jest.fn(async () => plannedCheckoutResult(commitId));
    const wb = createWorkbook({
      ctx: createMockCtx({
        versioning: {
          checkoutService: { checkout },
          readLiveCollaborationStatus: () => ({
            state: 'joining',
            statusRevision: `live:joining:${RAW_ROOM_ID}:${RAW_USER_ID}:${RAW_PROVIDER_ID}`,
            roomId: RAW_ROOM_ID,
            userId: RAW_USER_ID,
            providerId: RAW_PROVIDER_ID,
          }),
        },
      }),
    });

    const surfaceStatus = await wb.version.getSurfaceStatus();
    expect(surfaceStatus).toMatchObject({
      dirty: {
        checkoutSafe: false,
        liveCollaboration: {
          state: 'unknown',
        },
        unsafeReasons: [
          expect.objectContaining({
            code: 'version.surfaceStatus.liveCollaborationUnknown',
            data: expect.objectContaining({
              collaborationState: 'unknown',
            }),
          }),
        ],
      },
    });
    expectNoRawCollaborationIdentifiers(surfaceStatus);

    const checkoutResult = await wb.version.checkout({ kind: 'commit', id: commitId });
    expect(checkoutResult).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CHECKOUT_LIVE_COLLABORATION_ACTIVE',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                reason: 'liveCollaborationActive',
                collaborationState: 'unknown',
              }),
            }),
          }),
        ],
      },
    });
    expectNoRawCollaborationIdentifiers(checkoutResult);
    expect(checkout).not.toHaveBeenCalled();
  });
}
