/**
 * Events Index
 *
 * Central export for all spreadsheet event types.
 * Each domain has its own event file for better organization.
 */

// =============================================================================
// Re-exports from domain-specific event files
// =============================================================================

// Cell events (value, format, border, metadata)
export * from './cell-events';

// Structure events (row/column insert, delete, resize, hide)
export * from './structure-events';

// Merge events (merge/unmerge)
export * from './merge-events';

// Sheet events (create, delete, rename, reorder, etc.)
export * from './sheet-events';

// Chart events (CRUD)
export * from './chart-events';

// Pivot table events
export * from './pivot-events';

// Selection events
export * from './selection-events';

// View events (freeze, split, scroll, viewport)
export * from './view-events';

// Print & page setup events
export * from './print-events';

// Settings events (workbook/sheet settings, themes)
export * from './settings-events';

// Store events (Yjs lifecycle)
export * from './store-events';

// Recalculation events
export * from './recalc-events';

// Validation events (schema, data validation)
export * from './validation-events';

// Data tools events (remove duplicates, text to columns)
export * from './data-tools-events';

// Table events (CRUD, resize, rename, etc.)
export * from './table-events';

// Floating object events (images, shapes, drawings)
export * from './floating-object-events';

// Grouping events (row/column grouping, outline)
export * from './grouping-events';

// Conditional formatting events
export * from './conditional-formatting-events';

// Sparkline events
export * from './sparkline-events';

// Filter events (AutoFilter)
export * from './filter-events';

// Comment events
export * from './comment-events';

// File I/O events (import/export progress)
export * from './file-io-events';

// Named range events (defined names)
export * from './named-range-events';

// Slicer events
export * from './slicer-events';

// Scenario events (What-If analysis)
export * from './scenario-events';

// Ink events (stroke, recognition, collaboration)
export * from './ink-events';

// Diagram events
export * from './diagram-events';

// TextEffect events
export * from './text-effect-events';

// Canvas object events (universal canvasObject:* events)
export * from './canvas-object-events';

// Security events (privacy/access-control layer)
export * from './security-events';
export * from './range-events';

// Version-control lifecycle events
export * from './version-events';

// Sort events (from sorting module)
export type {
  RangeSortedEvent,
  ColumnSortedEvent,
  RowSortedEvent,
} from '@mog/types-data/data/sorting';

// =============================================================================
// Import domain union types for the SpreadsheetEvent union
// =============================================================================

import type {
  RangeSortedEvent,
  ColumnSortedEvent,
  RowSortedEvent,
} from '@mog/types-data/data/sorting';
import type { CanvasObjectEventUnion } from './canvas-object-events';
import type { CellEvent } from './cell-events';
import type { ChartEvent } from './chart-events';
import type { CommentEvent } from './comment-events';
import type { ConditionalFormattingEvent } from './conditional-formatting-events';
import type { DataToolsEvent } from './data-tools-events';
import type { FileIOEvent } from './file-io-events';
import type { FilterEvent } from './filter-events';
import type { FloatingObjectEvent } from './floating-object-events';
import type { GroupingEvent } from './grouping-events';
import type { InkEvent } from './ink-events';
import type { MergeEvent } from './merge-events';
import type { NamedRangeEvent } from './named-range-events';
import type { PivotEvent } from './pivot-events';
import type { PrintEvent } from './print-events';
import type { RecalcEvent } from './recalc-events';
import type { ScenarioEvent } from './scenario-events';
import type { SelectionEvent } from './selection-events';
import type { SettingsEvent } from './settings-events';
import type { SheetEvent } from './sheet-events';
import type { SlicerEvent } from './slicer-events';
import type { DiagramEvent } from './diagram-events';
import type { SparklineEvent } from './sparkline-events';
import type { StoreEvent } from './store-events';
import type { StructureEvent } from './structure-events';
import type { TableEvent } from './table-events';
import type { ValidationEvent } from './validation-events';
import type { ViewEvent } from './view-events';
import type { SecurityEvent } from './security-events';
import type { RangeEvent } from './range-events';
import type { TextEffectEvent } from './text-effect-events';
import type { VersionEvent } from './version-events';

// =============================================================================
// SpreadsheetEvent Union Type
// =============================================================================

/**
 * Union of all spreadsheet events.
 */
export type SpreadsheetEvent =
  // Cell events
  | CellEvent
  // Structure events
  | StructureEvent
  // Merge events
  | MergeEvent
  // Sheet events
  | SheetEvent
  // Chart events
  | ChartEvent
  // Pivot events
  | PivotEvent
  // Selection events
  | SelectionEvent
  // View events
  | ViewEvent
  // Print events
  | PrintEvent
  // Settings events
  | SettingsEvent
  // Store events
  | StoreEvent
  // Recalc events
  | RecalcEvent
  // Validation events
  | ValidationEvent
  // Data tools events
  | DataToolsEvent
  // Table events
  | TableEvent
  // Floating object events
  | FloatingObjectEvent
  // Grouping events
  | GroupingEvent
  // Conditional formatting events
  | ConditionalFormattingEvent
  // Sparkline events
  | SparklineEvent
  // Filter events
  | FilterEvent
  // Comment events
  | CommentEvent
  // File I/O events
  | FileIOEvent
  // Named range events
  | NamedRangeEvent
  // Slicer events
  | SlicerEvent
  // Scenario events
  | ScenarioEvent
  // Ink events
  | InkEvent
  // Diagram events
  | DiagramEvent
  // TextEffect events
  | TextEffectEvent
  // Canvas object events (universal canvasObject:* events)
  | CanvasObjectEventUnion
  // Security events (privacy / access-control)
  | SecurityEvent
  // Range events (first-class range lifecycle)
  | RangeEvent
  // Version-control lifecycle events
  | VersionEvent
  // Sort events
  | RangeSortedEvent
  | ColumnSortedEvent
  | RowSortedEvent;

/**
 * All spreadsheet event type strings.
 */
export type SpreadsheetEventType = SpreadsheetEvent['type'];

/**
 * Extract event type by its type string.
 */
export type EventByType<T extends SpreadsheetEventType> = Extract<SpreadsheetEvent, { type: T }>;

// =============================================================================
// Event Handler Types
// =============================================================================

/**
 * Handler function for a specific event type.
 */
export type EventHandler<T extends { type: string }> = (event: T) => void;

/**
 * Handler function for all events (wildcard subscription).
 * Generic over the event union — defaults to SpreadsheetEvent for backward compat.
 */
export type AllEventsHandler<TEvent extends { type: string } = SpreadsheetEvent> = (
  event: TEvent,
) => void;

// =============================================================================
// Event Bus Interface
// =============================================================================

/**
 * Generic event bus interface.
 *
 * The type parameter `TEvent` defaults to `SpreadsheetEvent`, so all existing
 * code that doesn't pass a type parameter keeps working unchanged. Future app
 * types (CRM, kanban, docs) can instantiate `IEventBus<CustomEvent>`.
 */
export interface IEventBus<TEvent extends { type: string } = SpreadsheetEvent> {
  /**
   * Subscribe to a specific event type.
   */
  on<T extends TEvent>(type: T['type'], handler: EventHandler<T>): () => void;

  /**
   * Subscribe to multiple event types with a single handler.
   */
  onMany(types: TEvent['type'][], handler: EventHandler<TEvent>): () => void;

  /**
   * Subscribe to all events.
   */
  onAll(handler: AllEventsHandler<TEvent>): () => void;

  /**
   * Emit an event to all subscribers.
   */
  emit(event: TEvent): void;

  /**
   * Emit multiple events as a batch (with shared transaction ID).
   */
  emitBatch(events: TEvent[]): void;

  /**
   * Clear all event handlers (useful for tests).
   */
  clear(): void;
}
