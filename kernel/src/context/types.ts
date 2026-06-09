/**
 * DocumentContext Types - Pure Type Definitions
 *
 * The factory function (createDocumentContext) is in kernel-context.ts.
 *
 * @see kernel-context.ts - Factory function
 * @see contracts/src/kernel/kernel-context.ts - Base interfaces (IDomainContext, IKernelContext, ISpreadsheetKernelContext)
 */

import type { ISpreadsheetKernelContext } from '@mog-sdk/contracts/kernel';
import type { SelectionCheckpoint } from '@mog-sdk/contracts/selection';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { MaterializationState } from '@mog-sdk/contracts/api';
import type { ComputeBridge } from '../bridges/compute/compute-bridge';
import type { WriteGate } from '../document/write-gate';
import type { MaybeHostOperationGate } from '../document/host-operation-gate';
import type { WorkbookLinkService, WorkbookLinkStatusScope } from '../services/workbook-links';

// =============================================================================
// DocumentContext Interface (engine-internal, scoped to one open document)
// =============================================================================

export interface KernelClock {
  now(): number;
  dateNow(): number;
  performanceNow?(): number;
}

/**
 * DocumentContext is the engine-internal context scoped to one open document.
 *
 * This extends IKernelContext with engine-specific functionality:
 * - ComputeBridge: Rust compute core connection (primary data access path)
 * - Selection checkpointing for undo/redo
 *
 * Domain modules should use IDomainContext (narrow).
 * Shell code should use IKernelContext (full API).
 * Engine internals use DocumentContext (full + compute bridge + viewport).
 */
export interface DocumentContext extends ISpreadsheetKernelContext {
  // ===========================================================================
  // Clock: document-scoped time authority
  // ===========================================================================

  readonly clock: KernelClock;

  // ===========================================================================
  // WriteGate: Storage/policy mutation guard (the write gate)
  // ===========================================================================

  readonly writeGate: WriteGate;

  // ===========================================================================
  // OperationGate: Host-backed document operation authorization (host operation authorization)
  // ===========================================================================

  readonly operationGate: MaybeHostOperationGate;

  // ===========================================================================
  // Workbook links: persisted link records + actor/principal-scoped runtime state
  // ===========================================================================

  readonly workbookLinks: WorkbookLinkService;
  workbookLinkScope(): WorkbookLinkStatusScope;

  // ===========================================================================
  // ComputeBridge: Rust compute core connection
  // ===========================================================================

  readonly computeBridge: ComputeBridge;

  /**
   * Await XLSX import materialization for APIs whose production read/write
   * path can touch deferred workbook state. Sheet-scoped callers may pass a
   * sheet id; writes and full-workbook dependencies pass "allSheets".
   */
  awaitMaterialized(scope?: SheetId | 'allSheets'): Promise<void>;

  /** Return the current XLSX materialization state without forcing hydration. */
  getMaterializationState(): MaterializationState;

  // ===========================================================================
  // Selection Undo/Redo Checkpointing
  // ===========================================================================

  /**
   * Set pending selection checkpoint for the next undo stack item.
   * Call this BEFORE performing an operation to associate selection with undo.
   */
  setPendingSelectionCheckpoint(checkpoint: SelectionCheckpoint): void;

  /**
   * Get the pending selection checkpoint (consumed by UndoManager listener).
   * @internal
   */
  getPendingSelectionCheckpoint(): SelectionCheckpoint | null;

  /**
   * Clear the pending selection checkpoint after it's been consumed.
   * @internal
   */
  clearPendingSelectionCheckpoint(): void;
}
