import { jest } from '@jest/globals';

import {
  hasAttachedPendingRemotePromotionService,
  promotePendingRemoteWorkbookVersion,
} from '../version-pending-remote';

const COMMIT_ID = `commit:sha256:${'a'.repeat(64)}`;
const SEGMENT_ID = `pending-remote-segment:sha256:${'b'.repeat(64)}`;

function createCtx(versioning: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return { versioning, ...overrides } as any;
}

function authorizedCtx(versioning: Record<string, unknown>) {
  return createCtx(
    {
      provenanceTruthService: { vc09ProvenanceTruthComplete: true },
      ...versioning,
    },
    {
      policySnapshot: {
        decisions: [
          { capability: 'version:remotePromote', decision: 'allowed' },
          { capability: 'version:provenance', decision: 'allowed' },
        ],
      },
    },
  );
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
});
