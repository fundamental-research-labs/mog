import { expect, it, jest } from '@jest/globals';

import { promotePendingRemoteWorkbookVersion } from '../version/pending/remote';
import { SEGMENT_ID, authorizedCtx, createCtx } from './version-pending-remote-test-utils';

export function registerPendingRemoteGuardScenarios(): void {
  it('returns a redacted failed result when no promotion service is attached', async () => {
    const result = await promotePendingRemoteWorkbookVersion(authorizedCtx({}));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.promotePendingRemote',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PENDING_REMOTE_PROMOTION_SERVICE_UNAVAILABLE',
            data: expect.objectContaining({
              redacted: true,
              payload: expect.objectContaining({ operation: 'promotePendingRemote' }),
            }),
          }),
        ],
      },
    });
  });

  it('rejects invalid service payloads before exposing public results', async () => {
    const promotePendingRemoteSegments = jest.fn(async () => ({
      status: 'failed',
      promotedSegmentIds: [],
      commitIds: [],
      skipped: [
        {
          segmentId: SEGMENT_ID,
          reason: 'not-a-public-reason',
          message: 'Invalid skip reason.',
        },
      ],
      diagnostics: [],
    }));

    const result = await promotePendingRemoteWorkbookVersion(
      authorizedCtx({
        pendingRemotePromotionService: {
          promotePendingRemoteSegments,
        },
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.promotePendingRemote',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_COMMIT_PAYLOAD',
          }),
        ],
      },
    });
    expect(promotePendingRemoteSegments).toHaveBeenCalledTimes(1);
  });

  it('is default-disabled without an explicit remote promotion host grant', async () => {
    const promotePendingRemoteSegments = jest.fn();

    const result = await promotePendingRemoteWorkbookVersion(
      createCtx({
        provenanceTruthService: { vc09ProvenanceTruthComplete: true },
        promotePendingRemoteSegments,
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.promotePendingRemote',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CAPABILITY_DISABLED',
            message:
              'Pending remote promotion requires host policy to explicitly allow version:remotePromote.',
          }),
          expect.objectContaining({
            code: 'VERSION_CAPABILITY_DISABLED',
            message:
              'Pending remote promotion requires host policy to explicitly allow version:provenance.',
          }),
        ],
      },
    });
    expect(promotePendingRemoteSegments).not.toHaveBeenCalled();
  });

  it('requires complete provenance truth before invoking the promotion service', async () => {
    const promotePendingRemoteSegments = jest.fn();

    const result = await promotePendingRemoteWorkbookVersion(
      createCtx(
        { promotePendingRemoteSegments },
        {
          policySnapshot: {
            decisions: [
              { capability: 'version:remotePromote', decision: 'allowed' },
              { capability: 'version:provenance', decision: 'allowed' },
            ],
          },
        },
      ),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PENDING_REMOTE_PROMOTION_PROVENANCE_UNAVAILABLE',
            message: 'Pending remote promotion requires complete VC-09 provenance truth.',
          }),
        ],
      },
    });
    expect(promotePendingRemoteSegments).not.toHaveBeenCalled();
  });
}
