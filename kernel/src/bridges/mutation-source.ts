/**
 * Source of a mutation — shared between the mutation-result handler and
 * downstream change accumulators.
 *
 * Lives in its own leaf module so that `api/worksheet/change-accumulator.ts`
 * can depend on it without pulling in `mutation-result-handler.ts` (which
 * itself depends on `change-accumulator.ts`). Previously the enum was
 * declared inside `mutation-result-handler.ts`, creating a cross-package
 * cycle through the `api/worksheet` layer.
 */

/**
 * Source of a mutation.
 *
 * `system` is for lifecycle/runtime infrastructure writes that must flow
 * through the normal mirror/event pipeline without being treated as authored
 * workbook edits.
 */
export type MutationSource = 'user' | 'remote' | 'system';

export function mutationSourceForSystemOperation(operation: string): MutationSource {
  return operation === 'compute_apply_sync_update' ? 'remote' : 'system';
}

export function mutationSourceToStructureEventSource(
  source: MutationSource,
): 'user' | 'remote' | 'system' {
  if (source === 'system') return 'system';
  return source === 'remote' ? 'remote' : 'user';
}
