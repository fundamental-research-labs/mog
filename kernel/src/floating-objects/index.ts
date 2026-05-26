/**
 * Floating Objects Module — Hosting Infrastructure
 *
 * Manages how objects live on a canvas: positioning, z-order, grouping,
 * selection, CRUD, cell-anchor resolution. This is the shared infrastructure
 * that makes something "float."
 *
 * Content domain logic (what objects ARE) lives in domain/:
 * - domain/charts/     — chart data resolution, marks compilation
 * - domain/drawing/    — ink strokes, spatial indexing, drawing operations
 * - domain/equations/  — OMML/LaTeX parsing, typesetting
 * - domain/diagram/   — diagram node layout
 * - domain/text-effects/    — text warp, glyph measurement
 * - domain/shapes/     — preset geometry, adjustments
 *
 * @see ./spreadsheet-object-manager.ts - Spreadsheet object manager
 * @see ./object-store.ts - IObjectStore<FloatingObject> implementation
 * @see ./object-events.ts - Universal event emission layer
 * @see ./core/ - Universal hosting operations
 * @see ./spreadsheet/ - Spreadsheet-specific hosting adapters
 * @see ./managers/ - Trivial type managers (picture, textbox)
 * @see ./types.ts - Shared types
 */

// =============================================================================
// SPREADSHEET OBJECT MANAGER
// =============================================================================

export {
  SpreadsheetObjectManager,
  createSpreadsheetObjectManager,
  type SpreadsheetObjectManagerDeps,
} from './spreadsheet-object-manager';

// =============================================================================
// SPREADSHEET OBJECT MUTATOR
// =============================================================================

export { SpreadsheetObjectMutator } from './spreadsheet-object-mutator';

// =============================================================================
// OBJECT STORE (class-based IObjectStore)
// =============================================================================

export {
  ComputeBridgeGroupStore,
  ComputeBridgeObjectStore,
  createGroupStore,
  createObjectStore,
} from './object-store';

// =============================================================================
// OBJECT EVENTS (universal event emission layer)
// =============================================================================

export {
  // Canvas object events (non-lifecycle: move/resize/rotate/reorder)
  emitBatchCanvasObjectsCreated,
  emitBatchCanvasObjectsDeleted,
  emitBatchCanvasObjectsUpdated,
  emitCanvasObjectMoved,
  emitCanvasObjectResized,
  emitCanvasObjectRotated,
  emitCanvasObjectsReordered,
  // Group events (still emitted here — no MutationResult equivalent yet)
  emitGroupCreated,
  emitGroupDeleted,
  type CanvasEventDeps,
  type EventEmissionDeps,
  type GroupCreatedParams,
  type GroupDeletedParams,
} from './object-events';

// =============================================================================
// TYPES
// =============================================================================

export {
  // Constants
  DEFAULT_DUPLICATE_OFFSET,
  HANDLE_SIZE,
  ROTATION_HANDLE_OFFSET,
  // Types
  type CanvasObjectContext,
  type CreateDocumentObjectResult,
  type DocumentObjectMaps,
  type ObjectBounds,
} from './types';

// =============================================================================
// MANAGERS — trivial types that have no independent domain
// =============================================================================

// TextBox manager
export {
  DEFAULT_TEXTBOX_HEIGHT,
  DEFAULT_TEXTBOX_WIDTH,
  asTextBoxWithTextEffect,
  createTextBox,
  duplicateTextBox,
  getDefaultTextBoxOptions,
  isTextBox,
  type CreateTextBoxParams,
  type DuplicateTextBoxParams,
  type TextBoxDependencies,
} from './managers/textbox-manager';

// Picture manager
export {
  asPictureObject,
  createPicture,
  exportPictureAsFile,
  isPictureObject,
  preparePictureDuplication,
  type CreatePictureParams,
  type DuplicatePictureParams,
  type DuplicatePictureResult,
  type ExportPictureParams,
  type PictureContext,
} from './managers/picture-manager';

// =============================================================================
// SPREADSHEET HOSTING ADAPTERS
// =============================================================================

// OLE object manager (hosting-specific — "embed an external object")
export {
  asOleObject,
  createOleObject,
  isOleObject,
  type CreateOleObjectParams,
} from './spreadsheet/ole-object-manager';
