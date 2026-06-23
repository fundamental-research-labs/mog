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

export function registerLiveCollaborationBlockingAdmissionKnownStateScenarios() {
  it.each([
    ['active', 'version.surfaceStatus.liveCollaborationActive'],
    ['unknown', 'version.surfaceStatus.liveCollaborationUnknown'],
  ] as const)(
    'blocks checkout when live collaboration state is %s',
    async (collaborationState, unsafeReasonCode) => {
      const commitId = `commit:sha256:${'8'.repeat(64)}`;
      const checkout = jest.fn(async () => plannedCheckoutResult(commitId));
      const wb = createWorkbook({
        ctx: createMockCtx({
          versioning: {
            checkoutService: { checkout },
            readLiveCollaborationStatus: () => ({
              state: collaborationState,
              statusRevision: `live:${collaborationState}:${RAW_ROOM_ID}:${RAW_USER_ID}:${RAW_PROVIDER_ID}`,
              roomId: RAW_ROOM_ID,
              userId: RAW_USER_ID,
              providerId: RAW_PROVIDER_ID,
              sidecarStatus: collaborationState === 'active' ? 'online' : 'unknown',
              activeParticipantCount: collaborationState === 'active' ? 2 : 0,
              diagnostics: [
                {
                  code: 'version.surfaceStatus.liveCollaborationUnknown',
                  severity: 'warning',
                  message: `Raw live collaboration ids ${RAW_ROOM_ID} ${RAW_USER_ID} ${RAW_PROVIDER_ID} must not leak.`,
                  dependency: 'VC-09',
                  data: {
                    roomId: RAW_ROOM_ID,
                    userId: RAW_USER_ID,
                    providerId: RAW_PROVIDER_ID,
                    note: `provider ${RAW_PROVIDER_ID}`,
                    safeCount: 1,
                  },
                },
              ],
            }),
          },
        }),
      });

      const surfaceStatus = await wb.version.getSurfaceStatus();
      expect(surfaceStatus).toMatchObject({
        dirty: {
          checkoutSafe: false,
          liveCollaboration: {
            state: collaborationState,
            roomId: 'redacted',
          },
          unsafeReasons: [
            expect.objectContaining({
              code: unsafeReasonCode,
              data: expect.objectContaining({
                collaborationState,
                roomId: 'redacted',
                redacted: true,
              }),
            }),
          ],
        },
      });
      expect(surfaceStatus.dirty.liveCollaboration?.statusRevision).toContain('room:redacted');
      expect(surfaceStatus.dirty.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Raw live collaboration ids redacted redacted redacted must not leak.',
            data: expect.objectContaining({
              roomId: 'redacted',
              userId: 'redacted',
              providerId: 'redacted',
              note: 'provider redacted',
              safeCount: 1,
              redacted: true,
            }),
          }),
        ]),
      );
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
                  collaborationState,
                  roomId: 'redacted',
                }),
              }),
            }),
          ],
        },
      });
      expectNoRawCollaborationIdentifiers(checkoutResult);
      expect(checkout).not.toHaveBeenCalled();
    },
  );
}
