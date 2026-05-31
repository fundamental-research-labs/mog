/**
 * Mark primitive types for the chart rendering engine.
 *
 * Marks are the fundamental visual building blocks of charts.
 * Each mark represents a single visual element (rect, path, arc, text, symbol)
 * that can be rendered to canvas.
 */

/**
 * Common style properties for all marks.
 */
export interface MarkStyle {
  /** Fill color (CSS color string) */
  fill?: string;
  /** Stroke color (CSS color string) */
  stroke?: string;
  /** Stroke width in pixels */
  strokeWidth?: number;
  /** Stroke dash array for dashed/dotted lines */
  strokeDash?: number[];
  /** Opacity (0-1) */
  opacity?: number;
  /** Corner radius for rect marks */
  cornerRadius?: number;
}

/**
 * Rectangular clipping region in canvas coordinates.
 */
export interface MarkClip {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Base mark interface - all marks extend this.
 */
export interface Mark {
  /** Mark type discriminator */
  type: 'rect' | 'path' | 'arc' | 'text' | 'symbol';
  /** X position in pixels */
  x: number;
  /** Y position in pixels */
  y: number;
  /** Original data row for tooltips and interactions */
  datum?: unknown;
  /** Visual styling */
  style: MarkStyle;
  /** Optional clipping rectangle for plot-area constrained data marks. */
  clip?: MarkClip;
  /** Whether this mark is interactive (default: true) */
  interactive?: boolean;
}

/**
 * Rectangle mark - used for bars, heatmap cells, backgrounds.
 */
export interface RectMark extends Mark {
  type: 'rect';
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
}

/**
 * Path mark - used for lines, areas, complex shapes.
 * Uses SVG path d attribute format.
 */
export interface PathMark extends Mark {
  type: 'path';
  /** SVG path d attribute string (e.g., "M0,0 L100,100") */
  path: string;
}

/**
 * Arc mark - used for pie charts, doughnut charts, radial visualizations.
 */
export interface ArcMark extends Mark {
  type: 'arc';
  /** Inner radius (0 for pie, > 0 for doughnut) */
  innerRadius: number;
  /** Outer radius */
  outerRadius: number;
  /** Start angle in radians (0 = 12 o'clock, clockwise) */
  startAngle: number;
  /** End angle in radians */
  endAngle: number;
}

/**
 * Text alignment options.
 */
export type TextAlign = 'left' | 'center' | 'right';

/**
 * Text baseline options.
 */
export type TextBaseline = 'top' | 'middle' | 'bottom';

/**
 * Text mark - used for labels, titles, annotations.
 */
export interface TextMark extends Mark {
  type: 'text';
  /** Text content to render */
  text: string;
  /** Font size in pixels */
  fontSize: number;
  /** Font family */
  fontFamily: string;
  /** Horizontal text alignment */
  textAlign: TextAlign;
  /** Vertical text baseline */
  textBaseline: TextBaseline;
  /** Optional rotation angle in radians */
  rotation?: number;
  /** Optional font weight */
  fontWeight?: 'normal' | 'bold' | number;
}

/**
 * Symbol shape types for point marks.
 */
export type SymbolShape =
  | 'circle'
  | 'square'
  | 'diamond'
  | 'cross'
  | 'triangle-up'
  | 'triangle-down';

/**
 * Symbol mark - used for scatter plots, data points.
 */
export interface SymbolMark extends Mark {
  type: 'symbol';
  /** Symbol shape */
  shape: SymbolShape;
  /** Symbol size (area in square pixels) */
  size: number;
}

/**
 * Union type of all mark types.
 */
export type AnyMark = RectMark | PathMark | ArcMark | TextMark | SymbolMark;
