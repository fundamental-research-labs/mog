/**
 * Kernel API
 *
 * Public interface for Kernel operations.
 *
 * Three API styles, each with its own stability classification:
 *
 * 1. **Namespace APIs** (Cells, Sheets, Records) — @stability experimental
 *    Low-level, function-oriented. Takes IKernelContext. May change across minor
 *    versions. External SDK consumers should prefer createWorkbook().
 *
 * 2. **Unified API** (createWorkbook) — @stability stable
 *    High-level, OOP-oriented. The recommended entry point for external use.
 *
 * 3. **Document lifecycle** (DocumentFactory) — @stability internal
 *    Monorepo-only. Use createWorkbook() instead.
 *
 * Other exports:
 * - Utils namespace — @stability stable (pure stateless helpers)
 * - getFunctionCatalog / getFunctionInfo — @stability stable
 * - getWorkbookSnapshot — @stability experimental
 * - toCellWriteData / toCellData — @stability internal
 */

// Low-level namespace APIs (@stability experimental)
export * as Cells from './namespaces/cells';
export type { CellWriteData } from './namespaces/cells';
/** @deprecated Use CellWriteData instead. */
export type { KernelCellData } from './namespaces/cells';
export * as Records from './namespaces/records';
export type { FilterExpression, RecordValues, TableRecord } from './namespaces/records';
export * as Sheets from './namespaces/sheets';

// Core types needed by namespace API consumers (@stability stable — pure type exports)
export type { CellRawValue, CellValue, SheetId } from '@mog-sdk/contracts/core';
export type { FormulaA1 } from '@mog-sdk/contracts/cells';
export type { StoreCellData } from '@mog-sdk/contracts/store';
export type { IKernelContext } from '@mog-sdk/contracts/kernel';

// Cell data conversion utilities (@stability internal)
export { toCellWriteData, toKernelCellData, toCellData } from './internal/cell-data-conversion';

// High-level unified API (@stability stable)
export {
  createWorkbook,
  type CreateWorkbookOptions,
  type Workbook,
  type WorkbookConfig,
  type VersionLiveCollaborationState,
  type VersionLiveCollaborationStatus,
  type VersionLiveCollaborationStatusReader,
} from './workbook';
// WorksheetImpl intentionally NOT exported — use createWorkbook() to get Worksheet instances.
// Tests that need the concrete class can import from '@mog-sdk/kernel/api/worksheet' directly.

// Document lifecycle (@stability internal — use createWorkbook() as the primary entry point)
export {
  DocumentFactory,
  type CollaborationPresenceState,
  type CollaborationSidecar,
  type CollaborationSidecarConfig,
  type CollaborationSidecarStatus,
  type DocumentHandle,
  type DocumentHandleInternal,
  type DocumentHandleWorkbookConfig,
} from './document';

// Introspection (getFunctionCatalog/Info: @stability stable, getWorkbookSnapshot: @stability experimental)
export { getFunctionCatalog, getFunctionInfo, getWorkbookSnapshot } from './internal/introspection';

// Utilities (@stability stable — pure stateless helpers, namespaced to avoid polluting top-level)
export * as Utils from './internal/utils';
