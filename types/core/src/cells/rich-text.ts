/**
 * Rich Text Types
 *
 * Defines the rich text segment model for Excel-compatible rich text support.
 * Rich text is stored as an array of segments, where each segment has text
 * and optional formatting.
 *
 * Key design decisions:
 * - Segment array (not formatted string) for clean storage and rendering
 * - TextFormat matches Excel's inline rich text capabilities
 * - Runtime utility functions live in utils/rich-text.ts and are re-exported here
 *
 * @see STREAM-C3-COMMENTS-RICHTEXT.md
 */

// =============================================================================
// Text Formatting
// =============================================================================

/**
 * Formatting options for a text segment.
 * Matches Excel's inline rich text capabilities.
 */
export interface TextFormat {
  // Font styling
  /** Bold text */
  bold?: boolean;
  /** Italic text */
  italic?: boolean;
  /** Underline type (single, double, accounting styles) */
  underlineType?: 'none' | 'single' | 'double' | 'singleAccounting' | 'doubleAccounting';
  /** Strikethrough text */
  strikethrough?: boolean;

  // Font properties
  /** Font family name (e.g., "Arial", "Calibri") */
  fontFamily?: string;
  /** Font size in points */
  fontSize?: number;
  /** Font color in hex format (e.g., "#FF0000") */
  fontColor?: string;

  // Vertical alignment
  /** Superscript text (e.g., for exponents) */
  superscript?: boolean;
  /** Subscript text (e.g., for chemical formulas) */
  subscript?: boolean;
}

// =============================================================================
// Rich Text Segments
// =============================================================================

/**
 * A segment of rich text with optional formatting.
 * Rich text is stored as an array of segments.
 *
 * @example
 * // "Hello World" with "World" in bold
 * [
 *   { text: "Hello " },
 *   { text: "World", format: { bold: true } }
 * ]
 */
export interface RichTextSegment {
  /** The text content of this segment */
  text: string;
  /** Optional formatting for this segment */
  format?: Partial<TextFormat>;
}

/**
 * Type alias for rich text content.
 * Empty array = no content, single segment with no format = plain text.
 */
export type RichText = RichTextSegment[];

/**
 * Utility type for cells that can have rich text.
 * A cell's text content can be either a plain string or rich text.
 */
export type CellTextContent = string | RichText;
