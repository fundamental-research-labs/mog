import type { VersionCapability } from '@mog-sdk/contracts/api';

export type VersionMergePublicOperation =
  | 'merge'
  | 'applyMerge'
  | 'saveMergeResolutions'
  | 'getMergeConflictDetail'
  | 'putMergeResolutionPayload';
export type VersionMergePublicCapability = Extract<
  VersionCapability,
  'version:mergePreview' | 'version:mergeApply'
>;

export const VERSION_MERGE_OPERATION_CAPABILITIES = {
  merge: 'version:mergePreview',
  applyMerge: 'version:mergeApply',
  saveMergeResolutions: 'version:mergeApply',
  getMergeConflictDetail: 'version:mergePreview',
  putMergeResolutionPayload: 'version:mergeApply',
} as const satisfies Record<VersionMergePublicOperation, VersionMergePublicCapability>;

export const VERSION_MERGE_BROAD_CAPABILITY_ALIASES = new Set([
  'version:merge',
  'versionControl.merge',
  'versionControlMerge',
  'mergeCapability',
]);
export const VERSION_MERGE_NARROW_CAPABILITY_ALIASES: Readonly<
  Record<string, VersionMergePublicCapability>
> = {
  mergePreview: 'version:mergePreview',
  'versionControl.mergePreview': 'version:mergePreview',
  mergeApply: 'version:mergeApply',
  'versionControl.mergeApply': 'version:mergeApply',
};

export const VERSION_CAPABILITY_KEYS = [
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
  'version:revert',
  'version:provenance',
  'version:remotePromote',
] as const satisfies readonly VersionCapability[];
