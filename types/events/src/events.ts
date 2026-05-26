/**
 * Event Bus Contracts
 *
 * Type definitions for the spreadsheet event bus system.
 * The event bus translates Yjs CRDT operations into semantic events,
 * enabling decoupled, reactive rendering and feature integration.
 *
 * This file re-exports all event types from the events/ directory.
 * Each domain has its own event file for better organization:
 *
 * - cell-events.ts: Cell value, format, border, metadata changes
 * - structure-events.ts: Row/column insert, delete, resize, hide
 * - merge-events.ts: Cell merge/unmerge operations
 * - sheet-events.ts: Sheet lifecycle (create, delete, rename, etc.)
 * - chart-events.ts: Chart CRUD operations
 * - pivot-events.ts: Pivot table operations
 * - selection-events.ts: Cell selection changes
 * - view-events.ts: Freeze panes, split views, scroll, viewport
 * - print-events.ts: Print settings, page breaks, PDF export
 * - settings-events.ts: Workbook/sheet settings, themes
 * - store-events.ts: Yjs store lifecycle
 * - recalc-events.ts: Formula recalculation
 * - validation-events.ts: Schema and data validation
 * - data-tools-events.ts: Remove duplicates, text to columns
 * - table-events.ts: Table CRUD and operations
 * - floating-object-events.ts: Images, shapes, drawings
 * - grouping-events.ts: Row/column grouping, outline
 * - conditional-formatting-events.ts: CF rule operations
 * - sparkline-events.ts: Sparkline CRUD
 * - filter-events.ts: AutoFilter operations
 * - comment-events.ts: Cell comments
 * - file-io-events.ts: Import/export progress
 * - named-range-events.ts: Defined names
 * - slicer-events.ts: Slicer operations
 * - scenario-events.ts: What-If analysis
 * - ink-events.ts: Ink/drawing operations
 * - text-effects-events.ts: TextEffect operations
 * - diagram-events.ts: Diagram operations
 */

// Re-export everything from the events index
export * from './index';
