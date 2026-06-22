/**
 * Kernel - Pure Data + Events
 *
 * The Kernel is the core of the spreadsheet OS.
 * It handles: Storage + Events. Nothing more.
 *
 * Shell handles UI, parsing, and user interaction.
 * Bridges handle computation (Calculator, Pivot, Schema, etc.)
 *
 * External consumers should import from the root barrel:
 *   import { createWorkbook, DocumentFactory } from '@mog-sdk/kernel';
 *
 * Subpaths:
 *   './security'  — public security types
 *   './storage'   — public storage types
 *
 */

// =============================================================================
// Kernel API — re-export from the canonical API barrel
// =============================================================================

export {
  Utils,
  createWorkbook,
  getFunctionCatalog,
  getFunctionInfo,
  getWorkbookSnapshot,
} from './api';
export { DocumentFactory } from './public-document-factory';
export type {
  CellWriteData,
  KernelCellData,
  FilterExpression,
  RecordValues,
  TableRecord,
  CreateWorkbookOptions,
  Workbook,
  VersionLiveCollaborationState,
  VersionLiveCollaborationStatus,
  VersionLiveCollaborationStatusReader,
  CollaborationPresenceState,
  CollaborationSidecar,
  CollaborationSidecarConfig,
  CollaborationSidecarStatus,
  DocumentHandle,
  DocumentHandleWorkbookConfig,
  CellRawValue,
  CellValue,
  SheetId,
  FormulaA1,
  StoreCellData,
} from './api';

// =============================================================================
// API Utilities — flat re-exports for convenience
// =============================================================================

export {
  address,
  column,
  columnIndex,
  columnName,
  colToLetter,
  offset,
  parse,
  parseAddress,
  parseCellAddress,
  parseCellRange,
  rangeAddress,
  rangeToA1,
  toA1,
} from './api/internal/utils';

// =============================================================================
// Core Service Types
// =============================================================================

export type {
  IUndoService,
  UndoError,
  UndoServiceState,
  UndoStackItem,
  UndoStateChangeEvent,
} from './services/undo';

export type { CallableDisposable } from '@mog-sdk/contracts/core';

export type { IDisposable, Result } from './services/primitives';

// =============================================================================
// Public SDK contracts
// =============================================================================

export type {
  Worksheet,
  WorkbookViewport,
  WorkbookViewportBounds,
  ViewportRegion,
  ViewportReader,
  CellFormat,
  CellData,
  FunctionInfo,
  WorkbookSnapshot,
  WorkbookLinks,
} from '@mog-sdk/contracts/api';

export type {
  WorkbookLinkView,
  WorkbookExternalLinkUsageView,
  WorkbookExternalPackageArtifactView,
  CopyWorkbookLinkSourceResult,
  WorkbookLinkResolver,
  WorkbookLinkResolveRequest,
  WorkbookLinkStatusScope,
} from './services/workbook-links';

export type {
  MogDocument,
  IMogDocumentFactory,
  MogDocumentCreateOptions,
} from '@mog-sdk/contracts/sdk';

export { MogDocumentFactory } from './api/document/mog-document-factory';
export { MogSdkError, toMogSdkError } from './errors/mog-sdk-error';
export { MogSdkEventFacade } from './api/document/mog-sdk-event-facade';
