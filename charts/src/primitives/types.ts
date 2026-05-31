/**
 * Mark primitive types for the chart rendering engine.
 *
 * Marks are the fundamental visual building blocks of charts.
 * Each mark represents a single visual element (rect, path, arc, text, symbol)
 * that can be rendered to canvas.
 */

export type PaintSpec =
  | { type: 'none' }
  | { type: 'solid'; color: string; opacity?: number }
  | {
      type: 'linearGradient';
      angle?: number;
      stops: Array<{ offset: number; color: string; opacity?: number }>;
    }
  | {
      type: 'radialGradient';
      centerX?: number;
      centerY?: number;
      radius?: number;
      stops: Array<{ offset: number; color: string; opacity?: number }>;
    }
  | {
      type: 'rectangularGradient';
      stops: Array<{ offset: number; color: string; opacity?: number }>;
    }
  | {
      type: 'pattern';
      pattern: string;
      foreground?: string;
      background?: string;
      opacity?: number;
    }
  | {
      type: 'image';
      imageId?: string;
      src?: string;
      opacity?: number;
      status?: 'loaded' | 'pending' | 'external' | 'unsupported';
    }
  | { type: 'groupInherited'; fallback?: PaintSpec };

export interface LineStyleSpec {
  paint?: PaintSpec;
  width?: number;
  opacity?: number;
  dash?: number[];
  cap?: CanvasLineCap;
  join?: CanvasLineJoin;
  miterLimit?: number;
  compound?: string;
  alignment?: string;
  headEnd?: string;
  tailEnd?: string;
}

export interface ShadowSpec {
  color: string;
  blur?: number;
  offsetX?: number;
  offsetY?: number;
  opacity?: number;
}

export interface EffectSpec {
  outerShadow?: ShadowSpec;
  preserved?: string[];
}

export interface TextRunSpec {
  text: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: 'normal' | 'bold' | number;
  fontStyle?: 'normal' | 'italic';
  fill?: PaintSpec;
  stroke?: PaintSpec;
  underline?: boolean;
  strikethrough?: boolean;
  baseline?: number;
  language?: string;
  rtl?: boolean;
  highlight?: string;
}

/**
 * Common style properties for all marks.
 */
export interface MarkStyle {
  /** Fill color (CSS color string) */
  fill?: string;
  /** Fill paint. Takes precedence over fill when renderable. */
  fillPaint?: PaintSpec;
  /** Stroke color (CSS color string) */
  stroke?: string;
  /** Stroke paint. Takes precedence over stroke when renderable. */
  strokePaint?: PaintSpec;
  /** Stroke width in pixels */
  strokeWidth?: number;
  /** Full line style. Takes precedence over strokeWidth/strokeDash where set. */
  line?: LineStyleSpec;
  /** Stroke dash array for dashed/dotted lines */
  strokeDash?: number[];
  /** Opacity (0-1) */
  opacity?: number;
  /** Corner radius for rect marks */
  cornerRadius?: number;
  /** Canvas-renderable effect subset. */
  effects?: EffectSpec;
  /** Convenience outer shadow alias used by frame/text styles. */
  shadow?: ShadowSpec;
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
  /** Rich text runs. When present, text is used only for fallback/hit testing. */
  richText?: TextRunSpec[];
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
  /** Optional font style */
  fontStyle?: 'normal' | 'italic';
  /** Underline text after fill/stroke rendering */
  underline?: boolean;
  /** Strikethrough text after fill/stroke rendering */
  strikethrough?: boolean;
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
