export const CHILD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}`;
export const MOVED_COMMIT_ID = `commit:sha256:${'3'.repeat(64)}`;
export const REF_REVISION = { kind: 'counter', value: '2' } as const;

export const SURFACE_CAPABILITY_KEYS = [
  'version:read',
  'version:diff',
  'version:commit',
  'version:branch',
  'version:checkout',
  'version:reviewRead',
  'version:reviewWrite',
  'version:proposal',
  'version:mergePreview',
  'version:mergeApply',
  'version:refAdmin',
  'version:revert',
  'version:provenance',
  'version:remotePromote',
] as const;

export const HOST_DENIAL_SPLIT_CAPABILITIES = [
  'version:reviewRead',
  'version:reviewWrite',
  'version:proposal',
  'version:revert',
  'version:provenance',
  'version:mergeApply',
] as const;
