/**
 * Spreadsheet-specific hosting adapters.
 *
 * Contains cell-anchor resolution functions (resolveAnchorAsync, fromPixelsAsync,
 * computeObjectBounds, etc.), hosting-specific managers (OLE), and
 * cell-anchor operations.
 *
 * Content domain managers (chart, equation, diagram) have moved to domain/.
 */

// Cell Anchor Resolution — standalone async functions
export {
  absoluteToAnchorPosition,
  computeObjectBounds,
  fromPixelsAsync,
  normalizePosition,
  resolveAnchorAsync,
  resolveCellAnchorAsync,
  type CellAnchorResolverDeps,
} from './cell-anchor-resolver';

// OLE Object Manager (hosting-specific — "embed an external object")
export {
  asOleObject,
  createOleObject,
  isOleObject,
  type CreateOleObjectParams,
} from './ole-object-manager';

// Selection Bounds
export {
  computeSelectionBounds,
  getSelectionCenter,
  type SelectionBounds,
  type SelectionBoundsDeps,
} from './selection-bounds';

// Group Bounds
export { computeGroupBounds } from './group-bounds';

// Clipboard Anchors
export {
  calculateBatchDuplicateOffset,
  calculateDuplicatePosition,
  type CellDuplicateOffset,
} from './clipboard-anchors';
