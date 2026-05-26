/**
 * Transaction and batch mutation contracts.
 *
 * The current SDK provides non-atomic batches (undo grouping + event/persistence
 * metadata grouping). True rollback/isolation transactions are reserved
 * for a future contract.
 *
 * Design decisions:
 * - Non-atomic batches do NOT coalesce recalculation.
 *   Each mutation triggers its own recalc.
 * - Non-atomic batches group undo labels and persistence metadata.
 * - Partial writes within a batch remain committed.
 * - True transaction() with rollback is NOT exposed as stable until
 *   rollback behavior is implemented and conformance-tested.
 */

import type { Workbook } from '../api';

// ---------------------------------------------------------------------------
// Batch (non-atomic undo group)
// ---------------------------------------------------------------------------

export interface MogBatchOptions {
  readonly label?: string;
}

/**
 * The batch contract on Workbook:
 *
 *   await workbook.batch('Import data', async (wb) => {
 *     await wb.activeSheet.setCell('A1', 42);
 *     await wb.activeSheet.setCell('A2', 43);
 *   });
 *
 * Behavior:
 * - Groups undo: the above produces one undo entry with label 'Import data'.
 * - Each mutation triggers its own recalc (no coalescing).
 * - Partial writes are committed — if setCell('A2') fails, A1 is still written.
 * - Events are emitted per-mutation (not deferred to batch end).
 * - Persistence boundaries may batch flush metadata.
 */
export interface IMogBatchable {
  batch<T = void>(label: string, fn: (wb: Workbook) => Promise<T>): Promise<T>;
  undoGroup<T = void>(fn: (wb: Workbook) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// Transaction (reserved for true rollback/isolation — NOT stable)
// ---------------------------------------------------------------------------

export interface MogTransactionOptions {
  readonly label?: string;
  readonly isolation?: 'snapshot';
}

/**
 * Reserved for future use. NOT exposed as stable.
 *
 * When implemented:
 * - Mutations within a transaction are atomically committed or rolled back.
 * - On rollback, no mutations are persisted and no events are emitted.
 * - Nested transactions are not supported initially.
 * - Remote/collaboration mutations do not interleave with transaction scope.
 */
export interface IMogTransactable {
  transaction<T = void>(
    label: string,
    fn: (wb: Workbook) => Promise<T>,
    options?: MogTransactionOptions,
  ): Promise<T>;
}

// ---------------------------------------------------------------------------
// Mutation receipt
// ---------------------------------------------------------------------------

export interface MogMutationReceipt {
  readonly operationId: string;
  readonly batchId?: string;
  readonly affectedSheetIds: readonly string[];
  readonly timestamp: number;
}
