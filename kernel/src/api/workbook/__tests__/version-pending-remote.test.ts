import { jest } from '@jest/globals';

import {
  hasAttachedPendingRemotePromotionService,
  promotePendingRemoteWorkbookVersion,
} from '../version-pending-remote';

const COMMIT_ID = `commit:sha256:${'a'.repeat(64)}`;
const SEGMENT_ID = `pending-remote-segment:sha256:${'b'.repeat(64)}`;
const PROMOTED_SEGMENT_ID = `pending-remote-segment:sha256:${'c'.repeat(64)}`;
const DROPPED_SEGMENT_ID = `pending-remote-segment:sha256:${'d'.repeat(64)}`;
const BATCH_STATUS_ID = `sync-batch-status:sha256:${'e'.repeat(64)}`;
const RAW_BATCH_ID = 'provider-batch-secret-42';
const RAW_CURSOR = 'mog-pending-remote-v1.pending.cursor-handle';
const RAW_PROVIDER_ID = 'provider-secret-42';
const RAW_AUTHORITY_REF = 'authority-secret-42';
const RAW_ROOM_ID = 'room-secret-42';
const RAW_REMOTE_SESSION_ID = 'remote-session-secret-42';
const RAW_UPDATE_ID = 'remote-update-secret-42';
const RAW_PAYLOAD_HASH = 'payload-hash-secret-42';

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

  it('preserves stale cursor and revision diagnostics while redacting cursor and batch ids', async () => {
    const promotePendingRemoteSegments = jest.fn(async () => ({
      status: 'failed',
      promotedSegmentIds: [],
      commitIds: [],
      skipped: [
        {
          segmentId: SEGMENT_ID,
          reason: 'provider-read-failed',
          message: 'The pending remote read cursor is stale.',
        },
      ],
      diagnostics: [
        {
          code: 'VERSION_STALE_PAGE_CURSOR',
          severity: 'warning',
          message: 'The pending remote read cursor is stale.',
          reason: 'provider-read-failed',
          segmentId: SEGMENT_ID,
          details: {
            stateFilter: 'pending',
            cursorRevisionMismatch: true,
            cursorRootMismatch: false,
            expectedRevision: 7,
            actualRevision: 8,
            cursor: RAW_CURSOR,
            pageToken: RAW_CURSOR,
            batchId: RAW_BATCH_ID,
            batchStatusId: BATCH_STATUS_ID,
            syncBatchStatusFirstBatchStatusId: BATCH_STATUS_ID,
          },
        },
      ],
    }));

    const result = await promotePendingRemoteWorkbookVersion(
      authorizedCtx({ promotePendingRemoteSegments }),
      { includeDiagnostics: true },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        status: 'failed',
        promotedSegmentIds: [],
        commitIds: [],
        skipped: [
          {
            segmentId: SEGMENT_ID,
            reason: 'provider-read-failed',
            message: 'The pending remote read cursor is stale.',
          },
        ],
        diagnostics: [
          {
            code: 'VERSION_STALE_PAGE_CURSOR',
            severity: 'warning',
            message: 'The pending remote read cursor is stale.',
            reason: 'provider-read-failed',
            segmentId: SEGMENT_ID,
            data: {
              stateFilter: 'pending',
              cursorRevisionMismatch: true,
              cursorRootMismatch: false,
              expectedRevision: 7,
              actualRevision: 8,
              cursor: 'redacted',
              pageToken: 'redacted',
              batchId: 'redacted',
              batchStatusId: 'redacted',
              syncBatchStatusFirstBatchStatusId: 'redacted',
            },
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(RAW_CURSOR);
    expect(JSON.stringify(result)).not.toContain(RAW_BATCH_ID);
    expect(JSON.stringify(result)).not.toContain(BATCH_STATUS_ID);
    expect(promotePendingRemoteSegments).toHaveBeenCalledTimes(1);
  });

  it('redacts raw provider authority metadata from promotion diagnostics', async () => {
    const promotePendingRemoteSegments = jest.fn(async () => ({
      status: 'failed',
      promotedSegmentIds: [],
      commitIds: [],
      skipped: [
        {
          segmentId: SEGMENT_ID,
          reason: 'provider-authority-stale',
          message: 'The pending remote provider metadata is stale.',
        },
      ],
      diagnostics: [
        {
          code: 'VERSION_PENDING_REMOTE_PROMOTION_AUTHORITY_BLOCKED',
          severity: 'warning',
          message: 'The pending remote provider metadata is stale.',
          reason: 'provider-authority-stale',
          segmentId: SEGMENT_ID,
          details: {
            gate: 'provider-identity',
            field: 'providerId',
            providerId: RAW_PROVIDER_ID,
            authorityRef: RAW_AUTHORITY_REF,
            roomId: RAW_ROOM_ID,
            remoteSessionId: RAW_REMOTE_SESSION_ID,
            updateId: RAW_UPDATE_ID,
            payloadHash: RAW_PAYLOAD_HASH,
            stableOriginId: 'stable-origin-secret-42',
          },
        },
      ],
    }));

    const result = await promotePendingRemoteWorkbookVersion(
      authorizedCtx({ promotePendingRemoteSegments }),
      { includeDiagnostics: true },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        status: 'failed',
        promotedSegmentIds: [],
        commitIds: [],
        skipped: [
          {
            segmentId: SEGMENT_ID,
            reason: 'provider-authority-stale',
            message: 'The pending remote provider metadata is stale.',
          },
        ],
        diagnostics: [
          {
            code: 'VERSION_PENDING_REMOTE_PROMOTION_AUTHORITY_BLOCKED',
            severity: 'warning',
            message: 'The pending remote provider metadata is stale.',
            reason: 'provider-authority-stale',
            segmentId: SEGMENT_ID,
            data: {
              gate: 'provider-identity',
              field: 'providerId',
              providerId: 'redacted',
              authorityRef: 'redacted',
              roomId: 'redacted',
              remoteSessionId: 'redacted',
              updateId: 'redacted',
              payloadHash: 'redacted',
              stableOriginId: 'redacted',
            },
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(RAW_PROVIDER_ID);
    expect(JSON.stringify(result)).not.toContain(RAW_AUTHORITY_REF);
    expect(JSON.stringify(result)).not.toContain(RAW_ROOM_ID);
    expect(JSON.stringify(result)).not.toContain(RAW_REMOTE_SESSION_ID);
    expect(JSON.stringify(result)).not.toContain(RAW_UPDATE_ID);
    expect(JSON.stringify(result)).not.toContain(RAW_PAYLOAD_HASH);
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
