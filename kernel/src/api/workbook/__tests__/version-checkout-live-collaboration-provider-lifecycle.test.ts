import { jest } from '@jest/globals';

import {
  createMockCtx,
  createWorkbook,
  expectNoRawCollaborationIdentifiers,
  plannedCheckoutResult,
  RAW_PROVIDER_ID,
  RAW_ROOM_ID,
} from './version-checkout-live-collaboration-test-utils';

describe('WorkbookVersion checkout live collaboration provider lifecycle admission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['provider-disconnected', false, 'disconnected'],
    ['provider-quarantine', true, 'quarantined'],
    ['provider-authority-stale', true, 'stale'],
    ['provider-active', true, 'active'],
    ['provider-status-unknown', true, 'unknown'],
  ] as const)(
    'blocks checkout when idle live collaboration reports %s lifecycle',
    async (sidecarStatus, remoteProviderAttached, providerLifecycleState) => {
      const commitId = `commit:sha256:${'6'.repeat(64)}`;
      const checkout = jest.fn(async () => plannedCheckoutResult(commitId));
      const wb = createWorkbook({
        ctx: createMockCtx({
          versioning: {
            checkoutService: { checkout },
            readLiveCollaborationStatus: () => ({
              state: 'idle',
              statusRevision: `live:idle:${sidecarStatus}:${RAW_PROVIDER_ID}`,
              roomId: RAW_ROOM_ID,
              providerId: RAW_PROVIDER_ID,
              sidecarStatus,
              activeParticipantCount: 0,
              remoteProviderAttached,
            }),
          },
        }),
      });

      const surfaceStatus = await wb.version.getSurfaceStatus();
      expect(surfaceStatus).toMatchObject({
        dirty: {
          checkoutSafe: false,
          liveCollaboration: { state: 'idle', roomId: 'redacted', sidecarStatus },
          unsafeReasons: [
            expect.objectContaining({
              code: 'version.surfaceStatus.liveCollaborationUnknown',
              data: expect.objectContaining({
                collaborationState: 'idle',
                providerLifecycleState,
                sidecarStatus,
                remoteProviderAttached,
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
                  collaborationState: 'idle',
                  sidecarStatus,
                  remoteProviderAttached,
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
});
