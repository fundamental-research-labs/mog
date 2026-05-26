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

/** Source of a mutation: user action or remote collaboration. */
export type MutationSource = 'user' | 'remote';
