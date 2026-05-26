export * from './cross-coordination';
export * from './keyboard-scroll-coordination';
export * from './merge-anchor-coordination';
export * from './merged-cell-coordination';
export * from './selection-context-coordination';
export * from './undo-selection-coordination';

// Editing coordination (moved from coordinator/features/editing/)
export {
  checkMixedContent,
  setupCalculatedColumnCoordination,
} from './calculated-column-coordination';
export type {
  CalculatedColumnAutoFillInfo,
  CalculatedColumnCoordinationConfig,
  CalculatedColumnCoordinationResult,
} from './calculated-column-coordination';
export * from './editor-commit-coordination';
export { setupEditorScrollCoordination } from './editor-scroll-coordination';
export type {
  EditorScrollCoordinationConfig,
  EditorScrollCoordinationResult,
} from './editor-scroll-coordination';
export { setupScrollCommitCoordination } from './scroll-commit-coordination';
export type {
  ScrollCommitCoordinationConfig,
  ScrollCommitCoordinationResult,
} from './scroll-commit-coordination';
export { setupFormulaEditAutoScroll } from './formula-edit-auto-scroll';
export type {
  FormulaEditAutoScrollConfig,
  FormulaEditAutoScrollResult,
} from './formula-edit-auto-scroll';
export { setupTableAutoExpansionCoordination } from './table-auto-expansion';
export type {
  CellWriteInfo,
  OnAutoExpansionCallback,
  TableAutoExpansionConfig,
  TableAutoExpansionResult,
} from './table-auto-expansion';

// Clipboard coordination (moved from coordinator/features/clipboard/)
export {
  setupClipboardEditCoordination,
  type ClipboardEditCoordinationConfig,
} from './clipboard-edit-coordination';
export {
  setupClipboardVisualsCoordination,
  type ClipboardActor, // Export from visuals module (canonical export)
  type ClipboardVisualsCoordinationConfig,
} from './clipboard-visuals-coordination';
export {
  setupClipboardPasteIntegration,
  type ClipboardPasteIntegrationConfig,
  type ClipboardState,
  type PasteSize,
  type PendingPasteData,
  type ProtectionCheckResult,
} from './paste-integration';

// Range selection coordination (moved from coordinator/features/range-selection/)
export * from './range-selection-coordination';
