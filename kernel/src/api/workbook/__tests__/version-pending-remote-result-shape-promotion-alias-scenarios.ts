import { expect, it, jest } from '@jest/globals';

import {
  hasAttachedPendingRemotePromotionService,
  promotePendingRemoteWorkbookVersion,
} from '../version/pending/remote';
import { COMMIT_ID, SEGMENT_ID, authorizedCtx } from './version-pending-remote-test-utils';

export function registerPendingRemoteResultShapePromotionAliasScenarios(): void {
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
    const ctx = authorizedCtx({ promotePendingRemoteSegments });

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
}
