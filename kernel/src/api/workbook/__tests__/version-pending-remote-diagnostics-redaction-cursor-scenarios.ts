import { expect, it, jest } from '@jest/globals';

import { promotePendingRemoteWorkbookVersion } from '../version/pending/remote';
import {
  BATCH_STATUS_ID,
  RAW_BATCH_ID,
  RAW_CURSOR,
  SEGMENT_ID,
  authorizedCtx,
} from './version-pending-remote-test-utils';

export function registerPendingRemoteDiagnosticsRedactionCursorScenarios(): void {
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
}
