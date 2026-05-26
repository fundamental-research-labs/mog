/**
 * @fileoverview XLSX types, progress tracking, and worker orchestration.
 *
 * XLSX parsing and writing is handled entirely in Rust (compute-core).
 * This package provides TypeScript types for OOXML structures,
 * progress/cancellation utilities, and worker message types.
 *
 * @module @mog/xlsx-parser
 */

// =============================================================================
// Type Exports
// =============================================================================

// Result types
export type { CellRawValue } from './types';

// Generated types (from Rust via bridge-ts — single source of truth for Rust output shapes)
export type {
  AlignmentOutput,
  CellProtectionOutput,
  CellXfOutput,
  FontOutput,
  FormControlOutput,
  HeaderFooterOutput,
  MarginsOutput,
  PageBreakOutput,
  PageBreaksOutput,
  ParsedSlicerAnchor,
  ParsedSlicerCacheDef,
  ParsedSlicerCellAnchor,
  ParsedSlicerDef,
  ParsedSlicerPivotTableRef,
  ParsedSlicerTabularData,
  ParsedSlicerTabularItem,
  ParsedTableSlicerCache,
  PrintSettingsOutput,
  SheetViewOutput,
  StylesOutput,
  WasmFullParseResult,
  WasmFullParsedSheet,
} from './types';

// Full parse result types (for parse_xlsx_full)
export type {
  AutoFilter,
  BorderSide,
  BorderStyle,
  CalcChainEntry,
  CellAlignment,
  // Cell and structure types
  CellData,
  CellProtection,
  CellRange,
  CellType,
  CellXf,
  CfIcon,
  CfOperator,
  CfRule,
  CfRuleType,
  CfTimePeriod,
  Cfvo,
  CfvoType,
  ColWidth,
  ColorScale,
  // Comments and hyperlinks
  Comment,
  // Conditional formatting
  ConditionalFormat,
  CustomProperty,
  DataBar,
  // Data validation
  DataValidation,
  DataValidationErrorStyle,
  DataValidationImeMode,
  DataValidationOperator,
  DataValidationType,
  // Workbook-level types
  DefinedName,
  DifferentialFormat,
  ErrorLocation,
  ExternalDefinedName,
  ExternalLink,
  FilterColumn,
  FontUnderline,
  FrozenPane,
  FullParseOptions,
  // Main result type
  FullParseResult,
  FullParseStats,
  FullParsedSheet,
  GradientFill,
  GradientStop,
  HeaderFooter,
  Hyperlink,
  IconSet,
  IconSetType,
  MergeRange,
  NamedCellStyle,
  NumberFormat,
  OutlineGroup,
  PageBreak,
  PageBreaks,
  PageMargins,
  // Error types
  ParseErrorDetail,
  ParseErrorDetailCode,
  ParseErrorSeverity,
  ParsedBorder,
  ParsedColor,
  ParsedFill,
  ParsedFont,
  ParsedLineStyle,
  // Styles
  ParsedStyles,
  ParsedTableStyle,
  // Theme
  ParsedTheme,
  PatternType,
  // Print settings
  PrintSettings,
  RichTextEntry,
  RichTextRun,
  RowHeight,
  // Rich text
  SharedStringEntry,
  // Protection
  SheetProtection,
  SheetState,
  SheetViewOptions,
  // Slicers
  SlicerAnchor,
  SlicerCacheDef,
  SlicerCellAnchor,
  SlicerCrossFilter,
  SlicerDef,
  SlicerPivotTableRef,
  SlicerSortOrder,
  SlicerTabularData,
  SlicerTabularItem,
  // SmartArt
  SmartArtPartsOutput,
  SortCondition,
  SortState,
  Sparkline,
  // Sparklines
  SparklineGroup,
  // Tables
  Table,
  TableColumn,
  TableSlicerCache,
  TableStyleElement,
  TableStyleElementType,
  TableStyleInfo,
  TableType,
  ThemeColors,
  ThemeEffect,
  ThemeFonts,
  ThemeFormatScheme,
  TotalsRowFunction,
  VbaProjectInfo,
  WorkbookMetadata,
  WorkbookProtection,
} from './types';

// =============================================================================
// Progress and Cancellation
// =============================================================================

// Progress tracking utilities
export {
  PHASE_WEIGHTS,
  ProgressTracker,
  checkAborted,
  createCancellationChecker,
  createPostMessageProgress,
  createProgressReporter,
  estimateCellCount,
  estimateZipEntries,
  throttleProgress,
  withAbortSignal,
} from './progress';

export type { ParsePhase, ParseProgress, ProgressCallback } from './progress';

// Worker module exports (re-exported from worker/index.ts)
export {
  createErrorMessage,
  createWorkerParser,
  generateMessageId,
  isCancelled,
  isParseError,
  isParseSuccess,
  isProgress,
  isReady,
} from './worker';

export type {
  CancelRequestMessage,
  ParseCancelledMessage,
  ParseErrorMessage,
  ParseHandle,
  ParseRequestMessage,
  ParseSuccessMessage,
  ProgressMessage,
  ReadyMessage,
  TerminateRequestMessage,
  WorkerCapabilities,
  WorkerInboundMessage,
  WorkerMessageBase,
  WorkerOutboundMessage,
  WorkerParseOptions,
  WorkerParserOptions,
  WorkerResponseBase,
} from './worker';
