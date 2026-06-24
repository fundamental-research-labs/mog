import { expect, it, jest } from '@jest/globals';

import { promotePendingRemoteWorkbookVersion } from '../version/pending/remote';
import {
  RAW_AUTHORITY_REF,
  RAW_PAYLOAD_HASH,
  RAW_PROVIDER_ID,
  RAW_REMOTE_SESSION_ID,
  RAW_ROOM_ID,
  RAW_UPDATE_ID,
  SEGMENT_ID,
  authorizedCtx,
} from './version-pending-remote-test-utils';

export function registerPendingRemoteDiagnosticsRedactionAuthorityScenarios(): void {
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
}
