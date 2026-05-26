/**
 * Layout type definitions for the math typesetting engine.
 *
 * Defines the FontMetricsProvider interface that consumers can implement
 * to inject browser-measured or custom font metrics, plus supporting types
 * for glyph measurement, math styles, and TeX font parameters.
 *
 * This module also hosts the operator-facing layout interface:
 *   - LayoutBox / LayoutConfig
 *   - Pure math-style transition helpers (fracNumeratorStyle, supStyle, ...)
 *   - configForStyle / fontSizeForStyle
 *   - arrangeHorizontally (TeX inter-atom spacing)
 *
 * Operator modules (accent.ts, delimiter.ts, fraction.ts, matrix.ts,
 * radical.ts, script.ts) import only from this file, and receive their
 * recursive dispatcher via LayoutConfig.layoutNodes. layout-engine.ts
 * then imports the operator modules one-way for dispatch.
 */

import type { MathNode } from '@mog-sdk/contracts/equation/omml-ast';

/** Style attributes for a glyph lookup */
export interface GlyphStyle {
  italic?: boolean;
  bold?: boolean;
  fontFamily?: string;
}

/** Metrics for a single glyph */
export interface GlyphMetrics {
  width: number; // em-relative width
  height: number; // ascent (above baseline), em-relative
  depth: number; // descent (below baseline), em-relative
  italic: number; // italic correction, em-relative
  skew: number; // skew for accent placement, em-relative
}

/** Provider interface -- consumers can inject browser-measured metrics */
export interface FontMetricsProvider {
  measureGlyph(char: string, fontSize: number, style: GlyphStyle): GlyphMetrics;
}

/**
 * Math style -- controls sizing and layout parameter selection.
 * D = Display, T = Text, S = Script, SS = ScriptScript
 */
export type MathStyle = 'D' | 'T' | 'S' | 'SS';

/**
 * Font-level parameters from TeX (sigma values).
 * These are em-relative constants that control layout rules.
 */
export interface FontParameters {
  /** Axis height (center of fraction bar, center of +/= signs) */
  axisHeight: number;
  /** Default rule (bar) thickness */
  ruleThickness: number;

  // Fraction parameters
  /** Numerator shift for display style */
  num1: number;
  /** Numerator shift for text style */
  num2: number;
  /** Denominator shift for display style */
  denom1: number;
  /** Denominator shift for text style */
  denom2: number;

  // Script parameters
  /** Superscript shift for display style */
  sup1: number;
  /** Superscript shift for cramped style */
  sup2: number;
  /** Superscript shift for text style */
  sup3: number;
  /** Subscript shift */
  sub1: number;
  /** Subscript shift (with superscript) */
  sub2: number;
  /** Superscript drop below top of base */
  supDrop: number;
  /** Subscript drop below bottom of base */
  subDrop: number;

  // Delimiter parameters
  /** Delimiter shortfall (for auto-sizing) */
  delimiterShortfall: number;
  /** Null delimiter space (for invisible delimiters) */
  nullDelimiterSpace: number;

  // Big operator parameters
  bigOpSpacing1: number;
  bigOpSpacing2: number;
  bigOpSpacing3: number;
  bigOpSpacing4: number;
  bigOpSpacing5: number;
}

/**
 * A laid-out box for a math node. Contains position, dimensions,
 * baseline offset, and children.
 */
export interface LayoutBox {
  /** X position (relative to parent or absolute) */
  x: number;
  /** Y position (relative to parent or absolute) */
  y: number;
  /** Width of this box */
  width: number;
  /** Height of this box */
  height: number;
  /** Distance from the top of the box to the baseline */
  baseline: number;
  /** Font size used for this box */
  fontSize: number;
  /** Child layout boxes */
  children: LayoutBox[];
  /** Reference to the AST node this box represents */
  node: MathNode;
}

/**
 * Recursive layout dispatcher signature. Operator modules receive this via
 * LayoutConfig.layoutNodes so they can lay out their children without
 * importing layout-engine.ts (which would create a cycle).
 */
export type LayoutNodesFn = (nodes: MathNode[], config: LayoutConfig) => LayoutBox[];

/** Layout configuration */
export interface LayoutConfig {
  fontSize: number;
  /** Immutable original font size (never changes across style transitions) */
  baseFontSize: number;
  /** Scaling factor for subscript/superscript */
  scriptScale: number;
  /** Minimum gap between fraction bar and numerator/denominator */
  fractionGap: number;
  /** Thickness of fraction bar */
  fractionBarThickness: number;
  /** Radical sign width relative to content height */
  radicalWidthRatio: number;
  /** Extra vertical padding for delimiters */
  delimiterPadding: number;
  /** Horizontal gap between matrix columns */
  matrixColGap: number;
  /** Vertical gap between matrix rows */
  matrixRowGap: number;
  /** Accent vertical offset above base */
  accentOffset: number;
  /** Font metrics provider for glyph measurement */
  metrics?: FontMetricsProvider;
  /** TeX font-level parameters for layout rules */
  fontParams?: FontParameters;
  /** Math style (Display, Text, Script, ScriptScript) */
  style?: MathStyle;
  /** Cramped style flag (used inside denominators, radicals) */
  cramped?: boolean;
  /**
   * Recursive layout dispatcher, injected by layout-engine.ts. Always
   * populated on configs reaching operator modules; optional only so that
   * ad-hoc configs in tests can omit it when they don't recurse.
   */
  layoutNodes?: LayoutNodesFn;
}

// ─── Math Style Utilities (pure) ─────────────────────────────────────

/**
 * Get the style for a fraction's numerator.
 * D -> T, T -> S, S -> SS, SS -> SS
 */
export function fracNumeratorStyle(style: MathStyle): MathStyle {
  switch (style) {
    case 'D':
      return 'T';
    case 'T':
      return 'S';
    case 'S':
      return 'SS';
    case 'SS':
      return 'SS';
  }
}

/**
 * Get the style for a fraction's denominator.
 * D -> T', T -> S', S -> SS', SS -> SS' (cramped variants)
 * The MathStyle transition is the same as numerator; the cramped flag
 * is set at the call site in fraction.ts.
 */
export function fracDenominatorStyle(style: MathStyle): MathStyle {
  return fracNumeratorStyle(style);
}

/**
 * Get the style for a superscript.
 * D -> S, T -> S, S -> SS, SS -> SS
 */
export function supStyle(style: MathStyle): MathStyle {
  switch (style) {
    case 'D':
      return 'S';
    case 'T':
      return 'S';
    case 'S':
      return 'SS';
    case 'SS':
      return 'SS';
  }
}

/**
 * Get the style for a subscript.
 * D -> S', T -> S', S -> SS', SS -> SS'
 * The MathStyle transition is the same as supStyle; the cramped flag
 * is set at the call site.
 */
export function subStyle(style: MathStyle): MathStyle {
  return supStyle(style);
}

/**
 * Get the fontSize for a given math style relative to the base fontSize.
 * D and T use full size, S uses scriptScale, SS uses scriptScale^2.
 */
export function fontSizeForStyle(
  baseFontSize: number,
  style: MathStyle,
  scriptScale: number,
): number {
  switch (style) {
    case 'D':
      return baseFontSize;
    case 'T':
      return baseFontSize;
    case 'S':
      return baseFontSize * scriptScale;
    case 'SS':
      return baseFontSize * scriptScale * scriptScale;
  }
}

/**
 * Create a child config with a new math style.
 * Updates fontSize based on the style transition, always computing from baseFontSize
 * to avoid compounding bugs.
 */
export function configForStyle(
  config: LayoutConfig,
  newStyle: MathStyle,
  cramped?: boolean,
): LayoutConfig {
  const newCramped = cramped ?? config.cramped ?? false;
  if (newStyle === config.style && newCramped === (config.cramped ?? false)) return config;
  const baseFontSize = config.baseFontSize;
  return {
    ...config,
    style: newStyle,
    cramped: newCramped,
    fontSize: fontSizeForStyle(baseFontSize, newStyle, config.scriptScale),
  };
}

// ─── Inter-Atom Spacing (TeXbook Chapter 18) ─────────────────────────

type AtomType = 'Ord' | 'Op' | 'Bin' | 'Rel' | 'Open' | 'Close' | 'Punct' | 'Inner';

/**
 * Classify a MathNode into a TeX atom type for spacing.
 * See TeXbook Chapter 18, Table 18.
 */
function classifyAtom(node: MathNode): AtomType {
  switch (node.type) {
    case 'r': {
      const text = node.text || '';
      if (text.length === 0) return 'Ord';
      const ch = text.charAt(text.length - 1); // last character determines type
      // Relations
      if ('=<>≤≥≠≈≡≪≫∝∼≃≅≲≳⊂⊃⊆⊇∈∉⊢⊨'.includes(ch)) return 'Rel';
      // Binary operators
      if ('+-±∓×÷∗⋅∘⊕⊗∧∨∩∪△▽⊎⊔'.includes(ch)) return 'Bin';
      // Opening delimiters
      if ('([{⌊⌈⟨'.includes(ch)) return 'Open';
      // Closing delimiters
      if (')]⌋⌉⟩}'.includes(ch)) return 'Close';
      // Punctuation
      if (',;!'.includes(ch)) return 'Punct';
      return 'Ord';
    }
    case 'nary':
      return 'Op';
    case 'f':
      return 'Inner';
    case 'rad':
      return 'Ord';
    case 'd':
      return 'Inner';
    case 'sSub':
    case 'sSup':
    case 'sSubSup':
    case 'sPre':
      return 'Ord';
    case 'func':
      return 'Op';
    case 'acc':
      return 'Ord';
    case 'bar':
      return 'Ord';
    case 'm':
      return 'Inner';
    default:
      return 'Ord';
  }
}

/**
 * TeX inter-atom spacing table (TeXbook, Appendix G).
 * Rows = left atom type, Columns = right atom type.
 * Values: 0 = none, 1 = thin (3mu), 2 = medium (4mu), 3 = thick (5mu)
 * Negative = suppressed in script/scriptscript styles.
 */
const SPACING_TABLE: Record<AtomType, Record<AtomType, number>> = {
  Ord: { Ord: 0, Op: 1, Bin: -2, Rel: -3, Open: 0, Close: 0, Punct: 0, Inner: -1 },
  Op: { Ord: 1, Op: 1, Bin: 0, Rel: -3, Open: 0, Close: 0, Punct: 0, Inner: -1 },
  Bin: { Ord: -2, Op: -2, Bin: 0, Rel: 0, Open: -2, Close: 0, Punct: 0, Inner: -2 },
  Rel: { Ord: -3, Op: -3, Bin: 0, Rel: 0, Open: -3, Close: 0, Punct: 0, Inner: -3 },
  Open: { Ord: 0, Op: 0, Bin: 0, Rel: 0, Open: 0, Close: 0, Punct: 0, Inner: 0 },
  Close: { Ord: 0, Op: 1, Bin: -2, Rel: -3, Open: 0, Close: 0, Punct: 0, Inner: -1 },
  Punct: { Ord: -1, Op: -1, Bin: 0, Rel: -1, Open: -1, Close: -1, Punct: -1, Inner: -1 },
  Inner: { Ord: -1, Op: 1, Bin: -2, Rel: -3, Open: -1, Close: 0, Punct: -1, Inner: -1 },
};

/**
 * Convert a spacing table entry to actual pixels.
 * 1 mu = 1/18 em. Thin=3mu, Medium=4mu, Thick=5mu.
 */
function spacingAmount(entry: number, fontSize: number, isScript: boolean): number {
  if (entry === 0) return 0;
  // Negative entries are suppressed in script/scriptscript styles
  if (entry < 0 && isScript) return 0;
  const absEntry = Math.abs(entry);
  const mu = fontSize / 18;
  switch (absEntry) {
    case 1:
      return 3 * mu; // thin space
    case 2:
      return 4 * mu; // medium space
    case 3:
      return 5 * mu; // thick space
    default:
      return 0;
  }
}

/**
 * Arrange a set of boxes horizontally, aligning baselines.
 * When a math style is provided, inter-atom spacing from the
 * TeXbook spacing table is inserted between adjacent boxes.
 */
export function arrangeHorizontally(
  boxes: LayoutBox[],
  style?: MathStyle,
): {
  width: number;
  height: number;
  baseline: number;
  children: LayoutBox[];
} {
  if (boxes.length === 0) {
    return { width: 0, height: 0, baseline: 0, children: [] };
  }

  const isScript = style === 'S' || style === 'SS';
  const maxBaseline = Math.max(...boxes.map((b) => b.baseline));
  const maxDepth = Math.max(...boxes.map((b) => b.height - b.baseline));

  const totalHeight = maxBaseline + maxDepth;
  let xOffset = 0;
  const positioned: LayoutBox[] = [];

  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];

    // Add inter-atom spacing between adjacent boxes
    if (i > 0 && style != null) {
      const leftType = classifyAtom(boxes[i - 1].node);
      const rightType = classifyAtom(box.node);
      const entry = SPACING_TABLE[leftType]?.[rightType] ?? 0;
      const space = spacingAmount(entry, box.fontSize, isScript);
      xOffset += space;
    }

    const yOffset = maxBaseline - box.baseline;
    positioned.push({
      ...box,
      x: xOffset,
      y: yOffset,
    });
    xOffset += box.width;
  }

  return {
    width: xOffset,
    height: totalHeight,
    baseline: maxBaseline,
    children: positioned,
  };
}
