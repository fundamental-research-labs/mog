import { expect, it, jest } from '@jest/globals';

import {
  hasAttachedPendingRemotePromotionService,
  promotePendingRemoteWorkbookVersion,
} from '../version-pending-remote';
import {
  COMMIT_ID,
  DROPPED_SEGMENT_ID,
  PROMOTED_SEGMENT_ID,
  SEGMENT_ID,
  authorizedCtx,
} from './version-pending-remote-test-utils';

export function registerPendingRemoteResultShapeScenarios(): void {
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

  it('maps pending, promoted, and dropped filter outcomes through the public result', async () => {
    const promotePendingRemoteSegments = jest.fn(async () => ({
      status: 'partial',
      promotedSegmentIds: [PROMOTED_SEGMENT_ID],
      commitIds: [COMMIT_ID],
      skipped: [
        {
          segmentId: SEGMENT_ID,
          reason: 'provider-authority-stale',
          message: 'The pending filter read observed stale provider authority.',
        },
        {
          segmentId: DROPPED_SEGMENT_ID,
          reason: 'ineligible-state',
          message: 'The dropped filter returned a non-promotable pending remote segment.',
        },
      ],
      diagnostics: [
        {
          code: 'VERSION_PENDING_REMOTE_PROMOTION_AUTHORITY_BLOCKED',
          severity: 'warning',
          message: 'Pending filter read observed stale provider authority.',
          reason: 'provider-authority-stale',
          segmentId: SEGMENT_ID,
          details: {
            requestedStateFilter: 'pending',
            cursorRevisionMismatch: true,
            expectedRevision: 41,
            actualRevision: 42,
          },
        },
        {
          code: 'VERSION_PENDING_REMOTE_PROMOTION_RECOVERED',
          severity: 'info',
          message: 'Promoted filter recovered an already-visible segment.',
          segmentId: PROMOTED_SEGMENT_ID,
          commitId: COMMIT_ID,
          details: {
            requestedStateFilter: 'promoted',
            recoveredFromPromotedFilter: true,
          },
        },
        {
          code: 'VERSION_PENDING_REMOTE_PROMOTION_INELIGIBLE',
          severity: 'warning',
          message: 'Dropped filter segment was intentionally skipped.',
          reason: 'ineligible-state',
          segmentId: DROPPED_SEGMENT_ID,
          details: {
            requestedStateFilter: 'dropped',
            returnedState: 'dropped',
          },
        },
      ],
    }));

    await expect(
      promotePendingRemoteWorkbookVersion(authorizedCtx({ promotePendingRemoteSegments })),
    ).resolves.toEqual({
      ok: true,
      value: {
        status: 'partial',
        promotedSegmentIds: [PROMOTED_SEGMENT_ID],
        commitIds: [COMMIT_ID],
        skipped: [
          {
            segmentId: SEGMENT_ID,
            reason: 'provider-authority-stale',
            message: 'The pending filter read observed stale provider authority.',
          },
          {
            segmentId: DROPPED_SEGMENT_ID,
            reason: 'ineligible-state',
            message: 'The dropped filter returned a non-promotable pending remote segment.',
          },
        ],
        diagnostics: [
          {
            code: 'VERSION_PENDING_REMOTE_PROMOTION_AUTHORITY_BLOCKED',
            severity: 'warning',
            message: 'Pending filter read observed stale provider authority.',
            reason: 'provider-authority-stale',
            segmentId: SEGMENT_ID,
            data: {
              requestedStateFilter: 'pending',
              cursorRevisionMismatch: true,
              expectedRevision: 41,
              actualRevision: 42,
            },
          },
          {
            code: 'VERSION_PENDING_REMOTE_PROMOTION_RECOVERED',
            severity: 'info',
            message: 'Promoted filter recovered an already-visible segment.',
            segmentId: PROMOTED_SEGMENT_ID,
            commitId: COMMIT_ID,
            data: {
              requestedStateFilter: 'promoted',
              recoveredFromPromotedFilter: true,
            },
          },
          {
            code: 'VERSION_PENDING_REMOTE_PROMOTION_INELIGIBLE',
            severity: 'warning',
            message: 'Dropped filter segment was intentionally skipped.',
            reason: 'ineligible-state',
            segmentId: DROPPED_SEGMENT_ID,
            data: {
              requestedStateFilter: 'dropped',
              returnedState: 'dropped',
            },
          },
        ],
      },
    });
    expect(promotePendingRemoteSegments).toHaveBeenCalledTimes(1);
  });
}
