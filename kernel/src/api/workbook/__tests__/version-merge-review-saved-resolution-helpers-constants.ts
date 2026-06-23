export const TARGET_REF = 'refs/heads/main' as const;
export const DRIFTED_TARGET_REF = 'refs/heads/review/drift' as const;
export const UNSAFE_FIELD = 'xl/worksheets/sheet1.xml';
export const UNSAFE_VALUE = 'sk_live_saved_resolution_secret';
export const PAYLOAD_DIGEST_CANARY = {
  algorithm: 'sha256',
  digest: 'b'.repeat(64),
} as const;
