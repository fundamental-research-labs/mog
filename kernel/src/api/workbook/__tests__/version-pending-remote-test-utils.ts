export const COMMIT_ID = `commit:sha256:${'a'.repeat(64)}`;
export const SEGMENT_ID = `pending-remote-segment:sha256:${'b'.repeat(64)}`;
export const PROMOTED_SEGMENT_ID = `pending-remote-segment:sha256:${'c'.repeat(64)}`;
export const DROPPED_SEGMENT_ID = `pending-remote-segment:sha256:${'d'.repeat(64)}`;
export const BATCH_STATUS_ID = `sync-batch-status:sha256:${'e'.repeat(64)}`;
export const RAW_BATCH_ID = 'provider-batch-secret-42';
export const RAW_CURSOR = 'mog-pending-remote-v1.pending.cursor-handle';
export const RAW_PROVIDER_ID = 'provider-secret-42';
export const RAW_AUTHORITY_REF = 'authority-secret-42';
export const RAW_ROOM_ID = 'room-secret-42';
export const RAW_REMOTE_SESSION_ID = 'remote-session-secret-42';
export const RAW_UPDATE_ID = 'remote-update-secret-42';
export const RAW_PAYLOAD_HASH = 'payload-hash-secret-42';

export function createCtx(
  versioning: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return { versioning, ...overrides } as any;
}

export function authorizedCtx(versioning: Record<string, unknown>) {
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
