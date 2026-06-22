import type { MutationResult, SyncApplyMutationMetadataWire } from './compute-types.gen';

export interface SyncApplyWithMetadataResult {
  readonly mutationResult: MutationResult;
  readonly metadata: SyncApplyMutationMetadataWire;
}
