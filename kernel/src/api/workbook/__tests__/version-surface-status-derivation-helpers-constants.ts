export const REDACTED_BATCH_STATUS_ID = `sync-batch-status:sha256:${'9'.repeat(64)}`;
export const REDACTED_CURSOR = 'mog-pending-remote-v1.pending.cursor-secret';

export const READ_ONLY_PROVIDER_BACKED_CAPABILITIES = [
  'version:read',
  'version:diff',
  'version:checkout',
  'version:mergePreview',
] as const;

export const PROVIDER_WRITE_CAPABILITIES = [
  'version:commit',
  'version:branch',
  'version:mergeApply',
  'version:revert',
] as const;

export const FEATURE_GATE_SIBLING_CAPABILITIES = [
  'version:read',
  'version:commit',
  'version:mergePreview',
  'version:mergeApply',
] as const;

export const MANIFEST_OPERATION_CAPABILITIES = [
  'version:commit',
  'version:checkout',
  'version:mergePreview',
  'version:mergeApply',
  'version:revert',
] as const;

export const PROMOTED_SURFACE_CAPABILITIES = [
  'version:commit',
  'version:branch',
  'version:checkout',
  'version:mergePreview',
  'version:mergeApply',
  'version:refAdmin',
  'version:revert',
  'version:provenance',
  'version:remotePromote',
] as const;

export const READ_ONLY_PROVIDER_DIAGNOSTIC_CODES = [
  'version.surfaceStatus.commitUnavailable',
  'version.surfaceStatus.branchUnavailable',
  'version.surfaceStatus.mergeApplyUnavailable',
  'version.surfaceStatus.refAdminUnavailable',
  'version.surfaceStatus.revertUnavailable',
] as const;

export const FEATURE_GATE_DIAGNOSTIC_CODES = [
  'version.surfaceStatus.checkoutCapabilityDisabled',
  'version.surfaceStatus.revertCapabilityDisabled',
] as const;
