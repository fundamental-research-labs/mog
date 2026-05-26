/**
 * Rich Text Editor Component
 *
 * Rich Text Editing
 *
 * Provides contentEditable-based editing for rich text cells.
 * Enables character-level formatting (bold, italic, colors, fonts) within a cell.
 *
 * Architecture:
 * - Uses native contentEditable (no library dependencies)
 * - Renders RichTextSegment[] as nested <span> elements
 * - Maps DOM Selection to character offsets for state machine
 * - WYSIWYG: Uses same styles as canvas rendering
 * - Exposes selection format state for toolbar integration
 *
 * Formatting Architecture
 * - All formatting actions MUST use dispatch() through the action system
 * - RichTextEditor exposes selection format via onSelectionFormatChange callback
 * - Toolbar buttons read this state and dispatch actions accordingly
 * - Character-level formatting is handled by action handlers (font-styles.ts)
 *
 */

import type { CellFormat, CellValue } from '@mog-sdk/contracts/core';
import type { RichTextSegment } from '@mog-sdk/contracts/rich-text';
import { computeTextAlign } from '@mog/spreadsheet-utils/cells/cell-style';
import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { richTextSelectionManager } from '../../domain/editor';
import type { Direction } from '../../systems/shared/types';
// =============================================================================
// Types
// =============================================================================

/**
 * Format state for the current selection.
 * Used by toolbar to show active formatting state.
 */
export interface SelectionFormatState {
  /** Whether selection has bold formatting */
  bold: boolean;
  /** Whether selection has italic formatting */
  italic: boolean;
  /** Whether selection has underline formatting */
  underline: boolean;
  /** Whether selection has strikethrough formatting */
  strikethrough: boolean;
  /** Font family of selection (undefined if mixed) */
  fontFamily?: string;
  /** Font size of selection (undefined if mixed) */
  fontSize?: number;
  /** Font color of selection (undefined if mixed) */
  fontColor?: string;
  /** Whether selection format is mixed (multiple formats in selection) */
  isMixed: boolean;
}

export interface RichTextEditorProps {
  // Content state
  segments: RichTextSegment[];

  // Selection state (from editor machine)
  selectionStart: number; // Character offset in plain text
  selectionEnd: number;
  hasSelection: boolean;

  // Event handlers
  onInput: (segments: RichTextSegment[]) => void;
  onSelectionChange: (start: number, end: number) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  onCommit: (direction: Direction | 'none') => void;
  onCancel: () => void;

  /**
   * Called when the selection's format state changes.
   * Enables toolbar to show active formatting state.
   * This is for UI feedback only - actual formatting uses dispatch().
   */
  onSelectionFormatChange?: (format: SelectionFormatState) => void;

  // Styling (WYSIWYG - matches canvas)
  cellFormat: CellFormat; // Base cell format
  /** Typed cell value for value-aware alignment (general → right for numbers, etc.) */
  cellValue?: CellValue;
  position: { x: number; y: number };
  width: number;
  height: number;
  /** Zoom level for scaling font sizes (1.0 = 100%, default: 1.0) */
  zoom?: number;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Extract TextFormat from DOM element's inline styles.
 * Reverse of segmentToStyle - reads CSS and builds segment format.
 */
function styleToFormat(element: HTMLElement): RichTextSegment['format'] {
  const style = element.style;
  const format: RichTextSegment['format'] = {};

  // Font styling
  if (style.fontWeight === 'bold' || style.fontWeight === '700') {
    format.bold = true;
  }
  if (style.fontStyle === 'italic') {
    format.italic = true;
  }
  if (style.textDecoration?.includes('line-through')) {
    format.strikethrough = true;
  }
  if (style.textDecoration?.includes('underline')) {
    // Check for double underline (CSS: underline double)
    format.underlineType = style.textDecoration.includes('double') ? 'double' : 'single';
  }

  // Font properties
  if (style.fontFamily) {
    format.fontFamily = style.fontFamily.replace(/["']/g, ''); // Remove quotes
  }
  if (style.fontSize) {
    // Convert from pt or px to number
    const sizeMatch = style.fontSize.match(/^([\d.]+)/);
    if (sizeMatch) {
      format.fontSize = parseFloat(sizeMatch[1]);
    }
  }
  if (style.color) {
    format.fontColor = style.color;
  }

  // Vertical alignment (superscript/subscript)
  if (style.verticalAlign === 'super') {
    format.superscript = true;
  }
  if (style.verticalAlign === 'sub') {
    format.subscript = true;
  }

  // Return undefined if no formatting applied (cleaner output)
  return Object.keys(format).length > 0 ? format : undefined;
}

/**
 * Convert contentEditable DOM tree back to RichTextSegment[].
 * Walks child nodes and extracts text + formatting from inline styles.
 *
 * Handles:
 * - <span> elements with inline styles
 * - Text nodes (plain text without formatting)
 * - Nested structures (flattens to segment array)
 */
function domToSegments(root: HTMLElement): RichTextSegment[] {
  const segments: RichTextSegment[] = [];

  function walkNode(node: Node, inheritedFormat?: RichTextSegment['format']): void {
    if (node.nodeType === Node.TEXT_NODE) {
      // Text node - add as segment with inherited format
      const text = node.textContent || '';
      if (text) {
        segments.push({ text, format: inheritedFormat });
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;

      // Extract format from this element's styles
      const elementFormat = styleToFormat(element);

      // Merge with inherited format (element format takes precedence)
      const mergedFormat =
        inheritedFormat || elementFormat ? { ...inheritedFormat, ...elementFormat } : undefined;

      // Walk children with merged format
      for (const child of Array.from(node.childNodes)) {
        walkNode(child, mergedFormat);
      }
    }
  }

  // Walk all children of the root contentEditable div
  for (const child of Array.from(root.childNodes)) {
    walkNode(child);
  }

  // If no segments found (empty editor), return single empty segment
  if (segments.length === 0) {
    return [{ text: '' }];
  }

  // Normalize: merge adjacent segments with same formatting
  return normalizeSegments(segments);
}

/**
 * Compute the format state for a character range within segments.
 * Used for toolbar visual feedback.
 *
 * Returns:
 * - For single-format selection: returns that format
 * - For mixed-format selection: returns common properties, undefined for mixed
 * - isMixed flag indicates if selection spans multiple formats
 */
function computeSelectionFormat(
  segments: RichTextSegment[],
  selectionStart: number,
  selectionEnd: number,
  baseFormat: CellFormat,
): SelectionFormatState {
  // Default state (inherit from cell format)
  const defaultState: SelectionFormatState = {
    bold: baseFormat.bold ?? false,
    italic: baseFormat.italic ?? false,
    underline: (baseFormat.underlineType && baseFormat.underlineType !== 'none') ?? false,
    strikethrough: baseFormat.strikethrough ?? false,
    fontFamily: baseFormat.fontFamily,
    fontSize: baseFormat.fontSize,
    fontColor: baseFormat.fontColor,
    isMixed: false,
  };

  // Handle collapsed selection (cursor position) - return format at cursor
  if (selectionStart === selectionEnd) {
    // Find segment at cursor position
    let charIndex = 0;
    for (const segment of segments) {
      const segmentEnd = charIndex + segment.text.length;
      if (selectionStart >= charIndex && selectionStart <= segmentEnd) {
        const format = segment.format;
        return {
          bold: format?.bold ?? defaultState.bold,
          italic: format?.italic ?? defaultState.italic,
          underline:
            (format?.underlineType && format.underlineType !== 'none') ?? defaultState.underline,
          strikethrough: format?.strikethrough ?? defaultState.strikethrough,
          fontFamily: format?.fontFamily ?? defaultState.fontFamily,
          fontSize: format?.fontSize ?? defaultState.fontSize,
          fontColor: format?.fontColor ?? defaultState.fontColor,
          isMixed: false,
        };
      }
      charIndex = segmentEnd;
    }
    return defaultState;
  }

  // Collect formats from all segments in selection
  const formatsInSelection: Array<RichTextSegment['format']> = [];
  let charIndex = 0;

  for (const segment of segments) {
    const segmentStart = charIndex;
    const segmentEnd = charIndex + segment.text.length;

    // Check if segment overlaps with selection
    if (segmentEnd > selectionStart && segmentStart < selectionEnd) {
      formatsInSelection.push(segment.format);
    }

    charIndex = segmentEnd;
    if (charIndex >= selectionEnd) break;
  }

  // No formats found - return default
  if (formatsInSelection.length === 0) {
    return defaultState;
  }

  // Single format - return it directly
  if (formatsInSelection.length === 1) {
    const format = formatsInSelection[0];
    return {
      bold: format?.bold ?? defaultState.bold,
      italic: format?.italic ?? defaultState.italic,
      underline:
        (format?.underlineType && format.underlineType !== 'none') ?? defaultState.underline,
      strikethrough: format?.strikethrough ?? defaultState.strikethrough,
      fontFamily: format?.fontFamily ?? defaultState.fontFamily,
      fontSize: format?.fontSize ?? defaultState.fontSize,
      fontColor: format?.fontColor ?? defaultState.fontColor,
      isMixed: false,
    };
  }

  // Multiple formats - compute common properties
  const first = formatsInSelection[0];
  let bold = first?.bold ?? defaultState.bold;
  let italic = first?.italic ?? defaultState.italic;
  let underline =
    (first?.underlineType && first.underlineType !== 'none') ?? defaultState.underline;
  let strikethrough = first?.strikethrough ?? defaultState.strikethrough;
  let fontFamily: string | undefined = first?.fontFamily ?? defaultState.fontFamily;
  let fontSize: number | undefined = first?.fontSize ?? defaultState.fontSize;
  let fontColor: string | undefined = first?.fontColor ?? defaultState.fontColor;
  let isMixed = false;

  for (let i = 1; i < formatsInSelection.length; i++) {
    const format = formatsInSelection[i];
    const fBold = format?.bold ?? defaultState.bold;
    const fItalic = format?.italic ?? defaultState.italic;
    const fUnderline =
      (format?.underlineType && format.underlineType !== 'none') ?? defaultState.underline;
    const fStrike = format?.strikethrough ?? defaultState.strikethrough;
    const fFamily = format?.fontFamily ?? defaultState.fontFamily;
    const fSize = format?.fontSize ?? defaultState.fontSize;
    const fColor = format?.fontColor ?? defaultState.fontColor;

    // For booleans: if any differs, result is the AND of all (all must be true)
    if (fBold !== bold) {
      bold = bold && fBold;
      isMixed = true;
    }
    if (fItalic !== italic) {
      italic = italic && fItalic;
      isMixed = true;
    }
    if (fUnderline !== underline) {
      underline = underline && fUnderline;
      isMixed = true;
    }
    if (fStrike !== strikethrough) {
      strikethrough = strikethrough && fStrike;
      isMixed = true;
    }

    // For non-booleans: if mixed, set to undefined
    if (fFamily !== fontFamily) {
      fontFamily = undefined;
      isMixed = true;
    }
    if (fSize !== fontSize) {
      fontSize = undefined;
      isMixed = true;
    }
    if (fColor !== fontColor) {
      fontColor = undefined;
      isMixed = true;
    }
  }

  return {
    bold,
    italic,
    underline,
    strikethrough,
    fontFamily,
    fontSize,
    fontColor,
    isMixed,
  };
}

/**
 * Normalize segments by merging adjacent segments with identical formatting.
 * Similar to normalizeRichText in contracts but inline for local use.
 */
function normalizeSegments(segments: RichTextSegment[]): RichTextSegment[] {
  if (segments.length === 0) return [];

  const result: RichTextSegment[] = [];
  let current = { ...segments[0] };

  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    const currentFormatKey = JSON.stringify(current.format ?? {});
    const segmentFormatKey = JSON.stringify(segment.format ?? {});

    if (currentFormatKey === segmentFormatKey) {
      // Same formatting - merge text
      current.text += segment.text;
    } else {
      // Different formatting - push current and start new
      if (current.text) result.push(current);
      current = { ...segment };
    }
  }

  // Push final segment
  if (current.text) result.push(current);

  return result;
}

/**
 * Convert RichTextSegment format to inline CSS styles.
 * Matches Excel's character-level formatting properties.
 *
 * @param format - Segment format properties
 * @param zoom - Zoom level for scaling font sizes (1.0 = 100%)
 */
function segmentToStyle(
  format: RichTextSegment['format'],
  zoom: number = 1.0,
): React.CSSProperties {
  if (!format) return {};

  const style: React.CSSProperties = {};

  // Font styling
  if (format.bold) style.fontWeight = 'bold';
  if (format.italic) style.fontStyle = 'italic';
  if (format.strikethrough) style.textDecoration = 'line-through';
  if (format.underlineType && format.underlineType !== 'none') {
    // Excel supports single/double underlines
    style.textDecoration = format.underlineType === 'double' ? 'underline double' : 'underline';
  }

  // Font properties - scale font size by zoom for WYSIWYG
  if (format.fontFamily) style.fontFamily = format.fontFamily;
  if (format.fontSize) style.fontSize = `${format.fontSize * zoom}pt`;
  if (format.fontColor) style.color = format.fontColor;

  // Vertical alignment (superscript/subscript)
  // These use relative sizing (em), which will scale automatically
  if (format.superscript) {
    style.verticalAlign = 'super';
    style.fontSize = '0.75em';
  }
  if (format.subscript) {
    style.verticalAlign = 'sub';
    style.fontSize = '0.75em';
  }

  return style;
}

/**
 * Convert cell format to base styles for contentEditable container.
 * Uses same logic as getCellDOMStyle() from cell-style.ts.
 *
 * @param format - Cell format properties
 * @param width - Container width in pixels
 * @param height - Container height in pixels
 * @param zoom - Zoom level for scaling font sizes (1.0 = 100%)
 */
function cellFormatToBaseStyle(
  format: CellFormat,
  width: number,
  height: number,
  zoom: number = 1.0,
  cellValue?: CellValue,
): React.CSSProperties {
  const style: React.CSSProperties = {
    width: `${width}px`,
    height: `${height}px`,
    boxSizing: 'border-box',
    outline: '2px solid var(--primary)',
    outlineOffset: '-2px',
    padding: '2px 4px',
    overflow: 'hidden',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    backgroundColor: format.backgroundColor || 'var(--color-ss-surface, #ffffff)',
  };

  // Font - scale font size by zoom for WYSIWYG
  if (format.fontFamily) style.fontFamily = format.fontFamily;
  if (format.fontSize) style.fontSize = `${format.fontSize * zoom}pt`;

  // Alignment — delegate to computeTextAlign for value-aware 'general' resolution
  style.textAlign = computeTextAlign(format.horizontalAlign, cellValue);

  if (format.verticalAlign) {
    const alignMap: Record<string, string> = {
      top: 'flex-start',
      middle: 'center',
      center: 'center',
      bottom: 'flex-end',
    };
    style.display = 'flex';
    style.alignItems = alignMap[format.verticalAlign] || 'flex-end';
  }

  return style;
}

// =============================================================================
// Component
// =============================================================================

export function RichTextEditor({
  segments,
  // Selection props used for format state computation and character selection tracking
  selectionStart,
  selectionEnd,
  hasSelection: _hasSelection, // Reserved for future range selection features
  onInput,
  onSelectionChange,
  onKeyDown,
  onCommit,
  onCancel,
  // Selection format callback for toolbar integration
  onSelectionFormatChange,
  cellFormat,
  cellValue,
  position,
  width,
  height,
  zoom = 1.0,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false); // Track IME composition
  const lastFormatRef = useRef<SelectionFormatState | null>(null);

  // Compute and memoize selection format state
  const selectionFormat = useMemo(() => {
    return computeSelectionFormat(segments, selectionStart, selectionEnd, cellFormat);
  }, [segments, selectionStart, selectionEnd, cellFormat]);

  // Notify toolbar of format changes
  useEffect(() => {
    if (onSelectionFormatChange) {
      // Only fire if format actually changed
      const lastFormat = lastFormatRef.current;
      if (
        !lastFormat ||
        lastFormat.bold !== selectionFormat.bold ||
        lastFormat.italic !== selectionFormat.italic ||
        lastFormat.underline !== selectionFormat.underline ||
        lastFormat.strikethrough !== selectionFormat.strikethrough ||
        lastFormat.fontFamily !== selectionFormat.fontFamily ||
        lastFormat.fontSize !== selectionFormat.fontSize ||
        lastFormat.fontColor !== selectionFormat.fontColor ||
        lastFormat.isMixed !== selectionFormat.isMixed
      ) {
        lastFormatRef.current = selectionFormat;
        onSelectionFormatChange(selectionFormat);
      }
    }
  }, [selectionFormat, onSelectionFormatChange]);

  // Focus on mount
  useEffect(() => {
    editorRef.current?.focus();
  }, []);

  // Handle input (text changes)
  const handleInput = useCallback(() => {
    if (isComposingRef.current) return; // Skip during IME composition

    const div = editorRef.current;
    if (!div) return;

    // Convert contentEditable DOM back to RichTextSegment[]
    // Walk child spans and extract text + formatting from inline styles
    const newSegments = domToSegments(div);
    onInput(newSegments);
  }, [onInput]);

  // Handle selection change - uses RichTextSelectionManager for accurate offset mapping
  const handleSelectionChange = useCallback(() => {
    const div = editorRef.current;
    if (!div) return;

    // Use selection manager to map DOM selection to character offsets
    // This correctly handles selections across multiple span elements
    const { start, end } = richTextSelectionManager.getCharacterOffsets(div);

    onSelectionChange(start, end);
  }, [onSelectionChange]);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      // IME composition handling
      if (e.nativeEvent.isComposing) {
        isComposingRef.current = true;
        return;
      }

      // Pass to external handler first (for machine state)
      onKeyDown(e);
      if (e.defaultPrevented) return;

      // Local keyboard handling
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        onCommit('down');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        onCommit(e.shiftKey ? 'left' : 'right');
      }
    },
    [onKeyDown, onCommit, onCancel],
  );

  // Handle composition events (IME for CJK input)
  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false;
    handleInput(); // Process input after composition ends
  }, [handleInput]);

  // Base styles for container - pass zoom for font scaling
  const baseStyle = cellFormatToBaseStyle(cellFormat, width, height, zoom, cellValue);
  const containerStyle: React.CSSProperties = {
    ...baseStyle,
    position: 'absolute',
    left: `${position.x}px`,
    top: `${position.y}px`,
    zIndex: 1000,
  };

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      style={containerStyle}
      onInput={handleInput}
      onSelect={handleSelectionChange}
      onKeyDown={handleKeyDown}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      spellCheck={false}
      // Accessibility
      role="textbox"
      aria-label="Rich text editor"
      aria-multiline="true"
    >
      {/* Render segments as nested spans - pass zoom for font scaling */}
      {segments.map((segment, index) => (
        <span key={index} style={segmentToStyle(segment.format, zoom)}>
          {segment.text}
        </span>
      ))}
    </div>
  );
}
