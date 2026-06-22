import type { MutationResult, SyncApplyMutationMetadataWire } from './compute-types.gen';

export interface SyncApplyWithMetadataResult {
  readonly mutationResult: MutationResult;
  readonly metadata: SyncApplyMutationMetadataWire;
}

export function syncApplyWithMetadataResult(
  metadata: SyncApplyMutationMetadataWire,
): SyncApplyWithMetadataResult {
  return {
    mutationResult: metadata.mutationResult,
    metadata,
  };
}
