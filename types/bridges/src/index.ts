/**
 * Bridge Interfaces
 *
 * This module defines the contract interfaces for bridges that connect
 * the spreadsheet engine to external computation engines.
 *
 * Bridge interfaces enable:
 * - Clean boundaries between engine and external packages
 * - Dependency injection for testing
 * - Independent package extraction
 *
 */

// =============================================================================
// Pivot Bridge
// =============================================================================

export type {
  // Interface
  IPivotBridge,
  // Types
  ImportedPivotAssociationStatus,
  ImportedPivotCapabilities,
  ImportedPivotRenderedRange,
  ImportedPivotSourceKind,
  ImportedPivotViewRecord,
  PivotCacheStats,
  PivotResultCallback,
} from './pivot-bridge';

// Re-export IPivotEngine from pivot.ts (the core computation interface)
export type { IPivotEngine } from '@mog/types-data/data/pivot';

// =============================================================================
// Schema Bridge
// =============================================================================

export type {
  // Types
  CellWithErrors,
  // Interface
  ISchemaBridge,
  SchemaValidationOptions,
  ValidationErrorSummary,
  ValidationRecalcAnnotation,
} from './schema-bridge';

// Re-export ISchemaValidator and ISchemaRegistry from schema.ts
export type { ISchemaRegistry, ISchemaValidator } from '@mog/types-commands/schema';

// =============================================================================
// Locale Bridge
// =============================================================================

export type {
  // Interface
  ILocaleBridge,
  // Types
  LocaleNormalizationResult,
  PartialCellFormat,
} from './locale-bridge';

// =============================================================================
// Chart Bridge
// =============================================================================

export type {
  // Types
  AxisLayout,
  ChartBounds,
  ChartDataResult,
  ChartDataRow,
  ChartError,
  ChartErrorCode,
  ChartLayout,
  ChartLayoutRect,
  ChartLayoutSnapshot,
  ChartMark,
  ChartRenderFrame,
  ChartRenderSnapshot,
  DataLabelLayout,
  ElementBounds,
  LegendEntryLayout,
  LegendLayout,
  PlotAreaLayout,
  TitleLayout,
  // Interface
  IChartBridge,
} from './chart-bridge';

// =============================================================================
// Ink Recognition Bridge
// =============================================================================

export type {
  // Interface
  IInkRecognitionBridge,
  // Types
  RecognitionThresholds,
  ShapeRecognitionResult,
  TextRecognitionResult,
} from './ink-recognition-bridge';

export { DEFAULT_RECOGNITION_THRESHOLDS } from './ink-recognition-bridge';

// =============================================================================
// Diagram Bridge
// =============================================================================

export type {
  // Types
  ComputedLayoutCache,
  // Interface
  IDiagramBridge,
  NodeMoveDirection,
  NodePosition,
} from './diagram-bridge';

// =============================================================================
// Equation Bridge
// =============================================================================

export type {
  // Interface
  IEquationBridge,
} from './equation-bridge';

// =============================================================================
// TextEffect Rendering Bridge
// =============================================================================

export type { ITextEffectRenderingBridge } from './text-effect-rendering-bridge';
