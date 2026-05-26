/**
 * Interactive Element Types
 *
 * Types for canvas-rendered interactive elements that need DOM overlays.
 * These elements are painted on canvas but require real DOM elements for:
 * - Radix UI integration (Popover, Select, etc.)
 * - Accessibility (screen readers, keyboard navigation)
 * - Focus management
 *
 * @module @mog-sdk/contracts/rendering/interactive-elements
 */

/**
 * Types of interactive elements rendered on canvas that need DOM overlays.
 */
export type InteractiveElementType =
  | 'filter-button' // AutoFilter and Table filter dropdown triggers
  | 'checkbox' // Boolean schema cells rendered as checkboxes
  | 'comment-indicator' // Red triangle indicating cell has comments
  | 'validation-dropdown' // List validation dropdown trigger
  | 'sparkline-edit' // Double-click to edit sparkline (future)
  | 'hyperlink'; // Ctrl+click to follow link (future)

/**
 * Position and bounds of an interactive element in viewport coordinates.
 */
export interface InteractiveElementBounds {
  /** X position relative to grid viewport (not including headers) */
  x: number;
  /** Y position relative to grid viewport */
  y: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
}

/**
 * Metadata for filter button elements.
 */
export interface FilterButtonMetadata {
  type: 'filter-button';
  /** Filter ID (AutoFilter or Table filter) */
  filterId: string;
  /** Header cell ID for this column */
  headerCellId: string;
  /** Whether this column has active filter criteria */
  hasActiveFilter: boolean;
  /** 0-based column index of this filter button, for stable test selectors */
  col: number;
}

/**
 * Metadata for checkbox elements.
 */
export interface CheckboxMetadata {
  type: 'checkbox';
  /** Cell ID */
  cellId: string;
  /** Sheet ID */
  sheetId: string;
  /** Current checked state */
  checked: boolean;
  /** Row position */
  row: number;
  /** Column position */
  col: number;
}

/**
 * Metadata for comment indicator elements.
 */
export interface CommentIndicatorMetadata {
  type: 'comment-indicator';
  /** Cell ID that has the comment */
  cellId: string;
  /** Sheet ID */
  sheetId: string;
  /** Row position */
  row: number;
  /** Column position */
  col: number;
}

/**
 * Metadata for validation dropdown elements.
 */
export interface ValidationDropdownMetadata {
  type: 'validation-dropdown';
  /** Cell ID */
  cellId: string;
  /** Sheet ID */
  sheetId: string;
  /** Row position */
  row: number;
  /** Column position */
  col: number;
  /** Validation options */
  options: string[];
}

/**
 * Union of all metadata types.
 */
export type InteractiveElementMetadata =
  | FilterButtonMetadata
  | CheckboxMetadata
  | CommentIndicatorMetadata
  | ValidationDropdownMetadata;

/**
 * Complete interactive element with position and metadata.
 */
export interface InteractiveElement {
  /** Unique identifier for this element instance */
  id: string;
  /** Element type */
  type: InteractiveElementType;
  /** Position and size in viewport coordinates */
  bounds: InteractiveElementBounds;
  /** Type-specific metadata */
  metadata: InteractiveElementMetadata;
}

/**
 * Collector interface for render context to emit interactive elements.
 *
 * The collector is cleared at the start of each render frame, and elements
 * are added during the render pass. Subscribers are notified once per frame
 * with the complete set of visible interactive elements.
 */
export interface InteractiveElementCollector {
  /** Clear all elements (called at start of render frame) */
  clear(): void;
  /** Add an interactive element */
  add(element: InteractiveElement): void;
  /** Get all collected elements */
  getAll(): InteractiveElement[];
  /** Subscribe to element updates */
  subscribe(callback: (elements: InteractiveElement[]) => void): () => void;
}
