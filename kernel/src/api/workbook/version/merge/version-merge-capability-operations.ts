import {
  VERSION_MERGE_OPERATION_CAPABILITIES,
  type VersionMergePublicCapability,
  type VersionMergePublicOperation,
} from './version-merge-capability-constants';

export function versionMergeCapabilityForOperation(
  operation: VersionMergePublicOperation,
): VersionMergePublicCapability {
  return VERSION_MERGE_OPERATION_CAPABILITIES[operation];
}

export function operationAliasCapability(value: string): VersionMergePublicCapability | null {
  return isVersionMergePublicOperation(value) ? VERSION_MERGE_OPERATION_CAPABILITIES[value] : null;
}

function isVersionMergePublicOperation(value: string): value is VersionMergePublicOperation {
  return Object.prototype.hasOwnProperty.call(VERSION_MERGE_OPERATION_CAPABILITIES, value);
}
