/**
 * GridCoordinator Re-export
 *
 * Re-exports SheetCoordinator as GridCoordinator for the Grid view.
 * This provides a view-specific name while using the same underlying implementation.
 *
 * NOTE: GridCoordinator and SheetCoordinator are the same class.
 * The Shell refactor planned to create a separate GridCoordinator but the
 * implementation was not completed. This re-export maintains API compatibility
 * with the planned architecture.
 *
 * @see apps/spreadsheet/src/coordinator/sheet-coordinator.ts
 */

export { SheetCoordinator as GridCoordinator } from '../../../coordinator';
