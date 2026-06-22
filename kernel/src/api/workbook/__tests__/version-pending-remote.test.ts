import { jest } from '@jest/globals';

import {
  hasAttachedPendingRemotePromotionService,
  promotePendingRemoteWorkbookVersion,
} from '../version-pending-remote';

const COMMIT_ID = `commit:sha256:${'a'.repeat(64)}`;
const SEGMENT_ID = `pending-remote-segment:sha256:${'b'.repeat(64)}`;

function createCtx(versioning: Record<string, unknown>) {
  return { versioning } as any;
}

describe('version pending remote promotion runtime helper', () => {
  it('discovers the top-level promotion alias and maps the public result shape', async () => {
    const promotePendingRemoteSegments = jest.fn(async () => ({
      status: 'partial',
      promotedSegmentIds: [SEGMENT_ID],
      commitIds: [COMMIT_ID],
      skipped: [
        {
          segmentId: SEGMENT_ID,
          reason: 'batch-status-terminal',
          message: 'A sync batch reached a terminal failed state.',
          commitId: COMMIT_ID,
        },
      ],
      diagnostics: [
        {
          code: 'VERSION_PENDING_REMOTE_PROMOTION_BATCH_BLOCKED',
          severity: 'warning',
          message: 'Pending remote promotion skipped a blocked sync batch.',
          reason: 'batch-status-terminal',
          segmentId: SEGMENT_ID,
          commitId: COMMIT_ID,
          details: {
            safeString: 'kept',
            safeNumber: 2,
            safeBoolean: true,
            safeNull: null,
            nested: { redacted: true },
          },
        },
      ],
    }));
    const ctx = createCtx({ promotePendingRemoteSegments });

    expect(hasAttachedPendingRemotePromotionService(ctx)).toBe(true);
    await expect(promotePendingRemoteWorkbookVersion(ctx)).resolves.toEqual({
      ok: true,
      value: {
        status: 'partial',
        promotedSegmentIds: [SEGMENT_ID],
        commitIds: [COMMIT_ID],
        skipped: [
          {
            segmentId: SEGMENT_ID,
            reason: 'batch-status-terminal',
            message: 'A sync batch reached a terminal failed state.',
            commitId: COMMIT_ID,
          },
        ],
        diagnostics: [
          {
            code: 'VERSION_PENDING_REMOTE_PROMOTION_BATCH_BLOCKED',
            severity: 'warning',
            message: 'Pending remote promotion skipped a blocked sync batch.',
            reason: 'batch-status-terminal',
            segmentId: SEGMENT_ID,
            commitId: COMMIT_ID,
            data: {
              safeString: 'kept',
              safeNumber: 2,
              safeBoolean: true,
              safeNull: null,
            },
          },
        ],
      },
    });
    expect(promotePendingRemoteSegments).toHaveBeenCalledTimes(1);
  });

  it('returns a redacted failed result when no promotion service is attached', async () => {
    const result = await promotePendingRemoteWorkbookVersion(createCtx({}));

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
      createCtx({
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
});
