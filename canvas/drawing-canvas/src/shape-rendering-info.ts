/**
 * Shape Rendering Info
 *
 * Provides information about how shapes should be rendered,
 * including whether they use native rendering or fallback.
 *
 * Architecture Issue #5 fix: Implements visual fallback strategy
 * for unsupported shape types.
 *
 * @module drawing-canvas/shape-rendering-info
 */

import { getRegisteredShapeTypes } from '@mog/shape-engine';
import type { ShapeType } from '@mog-sdk/contracts/floating-objects';

// =============================================================================
// Types
// =============================================================================

/**
 * Information about how a shape type is rendered.
 */
export interface ShapeRenderingInfo {
  /** Rendering strategy: 'native' for fully supported, 'fallback' for unsupported */
  strategy: 'native' | 'fallback';
  /** Category of the shape (for UI organization) */
  category:
    | 'basic'
    | 'rectangles'
    | 'arrows'
    | 'stars'
    | 'callouts'
    | 'lines'
    | 'flowchart'
    | 'equation'
    | 'symbols'
    | 'actionButtons'
    | 'other';
  /** Human-readable display name */
  displayName: string;
}

// =============================================================================
// Supported Shape Types
// =============================================================================

/**
 * Shape types that have native rendering support.
 *
 * Derived from the shape-engine preset registry instead of a hardcoded set.
 * The shape-engine registry is the single source of truth for which shape types
 * are supported.
 *
 * The hardcoded set below is kept as a fallback/union so that shape types not yet
 * in shape-engine still render natively. Once shape-engine has full coverage,
 * this hardcoded set can be removed.
 */
const HARDCODED_SHAPE_TYPES: ReadonlySet<ShapeType> = new Set<ShapeType>([
  // Basic shapes
  'rect',
  'roundRect',
  'ellipse',
  'triangle',
  'rtTriangle',
  'diamond',
  'pentagon',
  'hexagon',
  'octagon',
  'parallelogram',
  'trapezoid',
  'nonIsoscelesTrapezoid',
  'heptagon',
  'decagon',
  'dodecagon',
  'teardrop',
  'pie',
  'pieWedge',
  'blockArc',
  'donut',
  'noSmoking',
  'plaque',

  // Rectangle variants
  'round1Rect',
  'round2SameRect',
  'round2DiagRect',
  'snip1Rect',
  'snip2SameRect',
  'snip2DiagRect',
  'snipRoundRect',

  // Arrows
  'rightArrow',
  'leftArrow',
  'upArrow',
  'downArrow',
  'leftRightArrow',
  'upDownArrow',
  'quadArrow',
  'chevron',
  // Arrow Callouts
  'leftArrowCallout',
  'rightArrowCallout',
  'upArrowCallout',
  'downArrowCallout',
  'leftRightArrowCallout',
  'upDownArrowCallout',
  'quadArrowCallout',
  // Curved/Special Arrows
  'bentArrow',
  'uturnArrow',
  'circularArrow',
  'leftCircularArrow',
  'leftRightCircularArrow',
  'curvedRightArrow',
  'curvedLeftArrow',
  'curvedUpArrow',
  'curvedDownArrow',
  'swooshArrow',

  // Stars and banners
  'star4',
  'star5',
  'star6',
  'star7',
  'star8',
  'star10',
  'star12',
  'star16',
  'star24',
  'star32',
  'ribbon',
  'banner',

  // Callouts
  'wedgeRectCallout',
  'wedgeRoundRectCallout',
  'wedgeEllipseCallout',
  'cloud',
  'callout1',
  'callout2',
  'callout3',
  'borderCallout1',
  'borderCallout2',
  'borderCallout3',
  'accentCallout1',
  'accentCallout2',
  'accentCallout3',
  'accentBorderCallout1',
  'accentBorderCallout2',
  'accentBorderCallout3',

  // Lines and connectors
  'line',
  'lineArrow',
  'lineDoubleArrow',
  'curve',
  'arc',
  'connector',
  'bentConnector2',
  'bentConnector3',
  'bentConnector4',
  'bentConnector5',
  'curvedConnector2',
  'curvedConnector3',
  'curvedConnector4',
  'curvedConnector5',
  'ribbon2',
  'ellipseRibbon',
  'ellipseRibbon2',
  'leftRightRibbon',
  'verticalScroll',
  'horizontalScroll',
  'actionButtonBlank',
  'actionButtonHome',
  'actionButtonHelp',
  'actionButtonInformation',
  'actionButtonForwardNext',
  'actionButtonBackPrevious',
  'actionButtonEnd',
  'actionButtonBeginning',
  'actionButtonReturn',
  'actionButtonDocument',
  'actionButtonSound',
  'actionButtonMovie',
  'leftBracket',
  'rightBracket',
  'leftBrace',
  'rightBrace',
  'bracketPair',
  'bracePair',
  'mathPlus',
  'mathMinus',
  'mathMultiply',
  'mathDivide',
  'mathEqual',
  'mathNotEqual',
  'gear6',
  'gear9',
  'cornerTabs',
  'squareTabs',
  'plaqueTabs',
  'chartX',
  'chartStar',
  'chartPlus',

  // Flowchart shapes
  'flowChartProcess',
  'flowChartDecision',
  'flowChartInputOutput',
  'flowChartPredefinedProcess',
  'flowChartInternalStorage',
  'flowChartDocument',
  'flowChartMultidocument',
  'flowChartTerminator',
  'flowChartPreparation',
  'flowChartManualInput',
  'flowChartManualOperation',
  'flowChartConnector',
  'flowChartPunchedCard',
  'flowChartPunchedTape',
  'flowChartSummingJunction',
  'flowChartOr',
  'flowChartCollate',
  'flowChartSort',
  'flowChartExtract',
  'flowChartMerge',
  'flowChartOfflineStorage',
  'flowChartOnlineStorage',
  'flowChartMagneticTape',
  'flowChartMagneticDisk',
  'flowChartMagneticDrum',
  'flowChartDisplay',
  'flowChartDelay',
  'flowChartAlternateProcess',
  'flowChartOffpageConnector',

  // Decorative symbols
  'heart',
  'lightningBolt',
  'sun',
  'moon',
  'smileyFace',
  'foldedCorner',
  'bevel',
  'frame',
  'halfFrame',
  'corner',
  'diagStripe',
  'chord',
  'can',
  'cube',
  'plus',
  'cross',
  'irregularSeal1',
  'irregularSeal2',
  'homePlate',
  'funnel',
]);

/**
 * Shape category mappings for organization.
 */
const SHAPE_CATEGORIES: Partial<Record<ShapeType, ShapeRenderingInfo['category']>> = {
  // Basic shapes
  rect: 'basic',
  roundRect: 'basic',
  ellipse: 'basic',
  triangle: 'basic',
  rtTriangle: 'basic',
  diamond: 'basic',
  pentagon: 'basic',
  hexagon: 'basic',
  octagon: 'basic',
  parallelogram: 'basic',
  trapezoid: 'basic',
  nonIsoscelesTrapezoid: 'basic',
  heptagon: 'basic',
  decagon: 'basic',
  dodecagon: 'basic',
  teardrop: 'basic',
  pie: 'basic',
  pieWedge: 'basic',
  blockArc: 'basic',
  donut: 'basic',
  noSmoking: 'basic',
  plaque: 'basic',

  // Rectangle variants
  round1Rect: 'rectangles',
  round2SameRect: 'rectangles',
  round2DiagRect: 'rectangles',
  snip1Rect: 'rectangles',
  snip2SameRect: 'rectangles',
  snip2DiagRect: 'rectangles',
  snipRoundRect: 'rectangles',

  // Arrows
  rightArrow: 'arrows',
  leftArrow: 'arrows',
  upArrow: 'arrows',
  downArrow: 'arrows',
  leftRightArrow: 'arrows',
  upDownArrow: 'arrows',
  quadArrow: 'arrows',
  chevron: 'arrows',
  // Arrow Callouts
  leftArrowCallout: 'arrows',
  rightArrowCallout: 'arrows',
  upArrowCallout: 'arrows',
  downArrowCallout: 'arrows',
  leftRightArrowCallout: 'arrows',
  upDownArrowCallout: 'arrows',
  quadArrowCallout: 'arrows',
  // Curved/Special Arrows
  bentArrow: 'arrows',
  uturnArrow: 'arrows',
  circularArrow: 'arrows',
  leftCircularArrow: 'arrows',
  leftRightCircularArrow: 'arrows',
  curvedRightArrow: 'arrows',
  curvedLeftArrow: 'arrows',
  curvedUpArrow: 'arrows',
  curvedDownArrow: 'arrows',
  swooshArrow: 'arrows',

  // Stars and banners
  star4: 'stars',
  star5: 'stars',
  star6: 'stars',
  star7: 'stars',
  star8: 'stars',
  star10: 'stars',
  star12: 'stars',
  star16: 'stars',
  star24: 'stars',
  star32: 'stars',
  ribbon: 'stars',
  ribbon2: 'stars',
  ellipseRibbon: 'stars',
  ellipseRibbon2: 'stars',
  leftRightRibbon: 'stars',
  banner: 'stars',

  // Callouts
  wedgeRectCallout: 'callouts',
  wedgeRoundRectCallout: 'callouts',
  wedgeEllipseCallout: 'callouts',
  cloud: 'callouts',
  callout1: 'callouts',
  callout2: 'callouts',
  callout3: 'callouts',
  borderCallout1: 'callouts',
  borderCallout2: 'callouts',
  borderCallout3: 'callouts',
  accentCallout1: 'callouts',
  accentCallout2: 'callouts',
  accentCallout3: 'callouts',
  accentBorderCallout1: 'callouts',
  accentBorderCallout2: 'callouts',
  accentBorderCallout3: 'callouts',

  // Lines and connectors
  line: 'lines',
  lineArrow: 'lines',
  lineDoubleArrow: 'lines',
  curve: 'lines',
  arc: 'lines',
  connector: 'lines',
  bentConnector2: 'lines',
  bentConnector3: 'lines',
  bentConnector4: 'lines',
  bentConnector5: 'lines',
  curvedConnector2: 'lines',
  curvedConnector3: 'lines',
  curvedConnector4: 'lines',
  curvedConnector5: 'lines',
  verticalScroll: 'stars',
  horizontalScroll: 'stars',
  actionButtonBlank: 'actionButtons',
  actionButtonHome: 'actionButtons',
  actionButtonHelp: 'actionButtons',
  actionButtonInformation: 'actionButtons',
  actionButtonForwardNext: 'actionButtons',
  actionButtonBackPrevious: 'actionButtons',
  actionButtonEnd: 'actionButtons',
  actionButtonBeginning: 'actionButtons',
  actionButtonReturn: 'actionButtons',
  actionButtonDocument: 'actionButtons',
  actionButtonSound: 'actionButtons',
  actionButtonMovie: 'actionButtons',
  leftBracket: 'equation',
  rightBracket: 'equation',
  leftBrace: 'equation',
  rightBrace: 'equation',
  bracketPair: 'equation',
  bracePair: 'equation',
  mathPlus: 'equation',
  mathMinus: 'equation',
  mathMultiply: 'equation',
  mathDivide: 'equation',
  mathEqual: 'equation',
  mathNotEqual: 'equation',
  gear6: 'other',
  gear9: 'other',
  cornerTabs: 'other',
  squareTabs: 'other',
  plaqueTabs: 'other',
  chartX: 'other',
  chartStar: 'other',
  chartPlus: 'other',

  // Flowchart shapes
  flowChartProcess: 'flowchart',
  flowChartDecision: 'flowchart',
  flowChartInputOutput: 'flowchart',
  flowChartPredefinedProcess: 'flowchart',
  flowChartInternalStorage: 'flowchart',
  flowChartDocument: 'flowchart',
  flowChartMultidocument: 'flowchart',
  flowChartTerminator: 'flowchart',
  flowChartPreparation: 'flowchart',
  flowChartManualInput: 'flowchart',
  flowChartManualOperation: 'flowchart',
  flowChartConnector: 'flowchart',
  flowChartPunchedCard: 'flowchart',
  flowChartPunchedTape: 'flowchart',
  flowChartSummingJunction: 'flowchart',
  flowChartOr: 'flowchart',
  flowChartCollate: 'flowchart',
  flowChartSort: 'flowchart',
  flowChartExtract: 'flowchart',
  flowChartMerge: 'flowchart',
  flowChartOfflineStorage: 'flowchart',
  flowChartOnlineStorage: 'flowchart',
  flowChartMagneticTape: 'flowchart',
  flowChartMagneticDisk: 'flowchart',
  flowChartMagneticDrum: 'flowchart',
  flowChartDisplay: 'flowchart',
  flowChartDelay: 'flowchart',
  flowChartAlternateProcess: 'flowchart',
  flowChartOffpageConnector: 'flowchart',

  // Decorative symbols
  heart: 'symbols',
  lightningBolt: 'symbols',
  sun: 'symbols',
  moon: 'symbols',
  smileyFace: 'symbols',
  foldedCorner: 'symbols',
  bevel: 'symbols',
  frame: 'symbols',
  halfFrame: 'symbols',
  corner: 'symbols',
  diagStripe: 'symbols',
  chord: 'symbols',
  can: 'symbols',
  cube: 'symbols',
  plus: 'symbols',
  cross: 'symbols',
  irregularSeal1: 'symbols',
  irregularSeal2: 'symbols',
  homePlate: 'symbols',
  funnel: 'symbols',
};

/**
 * Human-readable display names for shape types.
 */
const SHAPE_DISPLAY_NAMES: Partial<Record<ShapeType, string>> = {
  // Basic shapes
  rect: 'Rectangle',
  roundRect: 'Rounded Rectangle',
  ellipse: 'Oval',
  triangle: 'Triangle',
  rtTriangle: 'Right Triangle',
  diamond: 'Diamond',
  pentagon: 'Pentagon',
  hexagon: 'Hexagon',
  octagon: 'Octagon',
  parallelogram: 'Parallelogram',
  trapezoid: 'Trapezoid',
  nonIsoscelesTrapezoid: 'Non-Isosceles Trapezoid',
  heptagon: 'Heptagon',
  decagon: 'Decagon',
  dodecagon: 'Dodecagon',
  teardrop: 'Teardrop',
  pie: 'Pie',
  pieWedge: 'Pie Wedge',
  blockArc: 'Block Arc',
  donut: 'Donut',
  noSmoking: 'No Smoking',
  plaque: 'Plaque',

  // Rectangle variants
  round1Rect: 'Round Single Corner Rectangle',
  round2SameRect: 'Round Same Side Corner Rectangle',
  round2DiagRect: 'Round Diagonal Corner Rectangle',
  snip1Rect: 'Snip Single Corner Rectangle',
  snip2SameRect: 'Snip Same Side Corner Rectangle',
  snip2DiagRect: 'Snip Diagonal Corner Rectangle',
  snipRoundRect: 'Snip and Round Single Corner Rectangle',

  // Arrows
  rightArrow: 'Right Arrow',
  leftArrow: 'Left Arrow',
  upArrow: 'Up Arrow',
  downArrow: 'Down Arrow',
  leftRightArrow: 'Left-Right Arrow',
  upDownArrow: 'Up-Down Arrow',
  quadArrow: 'Quad Arrow',
  chevron: 'Chevron',
  // Arrow Callouts
  leftArrowCallout: 'Left Arrow Callout',
  rightArrowCallout: 'Right Arrow Callout',
  upArrowCallout: 'Up Arrow Callout',
  downArrowCallout: 'Down Arrow Callout',
  leftRightArrowCallout: 'Left-Right Arrow Callout',
  upDownArrowCallout: 'Up-Down Arrow Callout',
  quadArrowCallout: 'Quad Arrow Callout',
  // Curved/Special Arrows
  bentArrow: 'Bent Arrow',
  uturnArrow: 'U-Turn Arrow',
  circularArrow: 'Circular Arrow',
  leftCircularArrow: 'Left Circular Arrow',
  leftRightCircularArrow: 'Left-Right Circular Arrow',
  curvedRightArrow: 'Curved Right Arrow',
  curvedLeftArrow: 'Curved Left Arrow',
  curvedUpArrow: 'Curved Up Arrow',
  curvedDownArrow: 'Curved Down Arrow',
  swooshArrow: 'Swoosh Arrow',

  // Stars and banners
  star4: '4-Point Star',
  star5: '5-Point Star',
  star6: '6-Point Star',
  star7: '7-Point Star',
  star8: '8-Point Star',
  star10: '10-Point Star',
  star12: '12-Point Star',
  star16: '16-Point Star',
  star24: '24-Point Star',
  star32: '32-Point Star',
  ribbon: 'Ribbon',
  ribbon2: 'Ribbon 2',
  ellipseRibbon: 'Curved Ribbon',
  ellipseRibbon2: 'Curved Ribbon 2',
  leftRightRibbon: 'Left Right Ribbon',
  banner: 'Banner',

  // Callouts
  wedgeRectCallout: 'Callout',
  wedgeRoundRectCallout: 'Rounded Callout',
  wedgeEllipseCallout: 'Oval Callout',
  cloud: 'Cloud',
  callout1: 'Line Callout 1',
  callout2: 'Line Callout 2',
  callout3: 'Line Callout 3',
  borderCallout1: 'Line Callout 1 (Border)',
  borderCallout2: 'Line Callout 2 (Border)',
  borderCallout3: 'Line Callout 3 (Border)',
  accentCallout1: 'Line Callout 1 (Accent Bar)',
  accentCallout2: 'Line Callout 2 (Accent Bar)',
  accentCallout3: 'Line Callout 3 (Accent Bar)',
  accentBorderCallout1: 'Line Callout 1 (Border and Accent Bar)',
  accentBorderCallout2: 'Line Callout 2 (Border and Accent Bar)',
  accentBorderCallout3: 'Line Callout 3 (Border and Accent Bar)',

  // Lines and connectors
  line: 'Line',
  lineArrow: 'Arrow Line',
  lineDoubleArrow: 'Double Arrow Line',
  curve: 'Curve',
  arc: 'Arc',
  connector: 'Connector',
  bentConnector2: 'Elbow Connector',
  bentConnector3: 'Elbow Connector 3',
  bentConnector4: 'Elbow Connector 4',
  bentConnector5: 'Elbow Connector 5',
  curvedConnector2: 'Curved Connector 2',
  curvedConnector3: 'Curved Connector 3',
  curvedConnector4: 'Curved Connector 4',
  curvedConnector5: 'Curved Connector 5',
  verticalScroll: 'Vertical Scroll',
  horizontalScroll: 'Horizontal Scroll',
  actionButtonBlank: 'Blank Button',
  actionButtonHome: 'Home Button',
  actionButtonHelp: 'Help Button',
  actionButtonInformation: 'Information Button',
  actionButtonForwardNext: 'Forward or Next Button',
  actionButtonBackPrevious: 'Back or Previous Button',
  actionButtonEnd: 'End Button',
  actionButtonBeginning: 'Beginning Button',
  actionButtonReturn: 'Return Button',
  actionButtonDocument: 'Document Button',
  actionButtonSound: 'Sound Button',
  actionButtonMovie: 'Movie Button',
  leftBracket: 'Left Bracket',
  rightBracket: 'Right Bracket',
  leftBrace: 'Left Brace',
  rightBrace: 'Right Brace',
  bracketPair: 'Bracket Pair',
  bracePair: 'Brace Pair',
  mathPlus: 'Plus',
  mathMinus: 'Minus',
  mathMultiply: 'Multiply',
  mathDivide: 'Divide',
  mathEqual: 'Equal',
  mathNotEqual: 'Not Equal',
  gear6: '6-Tooth Gear',
  gear9: '9-Tooth Gear',
  cornerTabs: 'Corner Tabs',
  squareTabs: 'Square Tabs',
  plaqueTabs: 'Plaque Tabs',
  chartX: 'Chart X',
  chartStar: 'Chart Star',
  chartPlus: 'Chart Plus',

  // Flowchart shapes
  flowChartProcess: 'Process',
  flowChartDecision: 'Decision',
  flowChartInputOutput: 'Data',
  flowChartPredefinedProcess: 'Predefined Process',
  flowChartInternalStorage: 'Internal Storage',
  flowChartDocument: 'Document',
  flowChartMultidocument: 'Multidocument',
  flowChartTerminator: 'Terminator',
  flowChartPreparation: 'Preparation',
  flowChartManualInput: 'Manual Input',
  flowChartManualOperation: 'Manual Operation',
  flowChartConnector: 'Connector',
  flowChartPunchedCard: 'Card',
  flowChartPunchedTape: 'Tape',
  flowChartSummingJunction: 'Summing Junction',
  flowChartOr: 'Or',
  flowChartCollate: 'Collate',
  flowChartSort: 'Sort',
  flowChartExtract: 'Extract',
  flowChartMerge: 'Merge',
  flowChartOfflineStorage: 'Stored Data',
  flowChartOnlineStorage: 'Sequential Access',
  flowChartMagneticTape: 'Magnetic Tape',
  flowChartMagneticDisk: 'Direct Access Storage',
  flowChartMagneticDrum: 'Magnetic Drum',
  flowChartDisplay: 'Display',
  flowChartDelay: 'Delay',
  flowChartAlternateProcess: 'Alternate Process',
  flowChartOffpageConnector: 'Off-Page Reference',

  // Decorative symbols
  heart: 'Heart',
  lightningBolt: 'Lightning Bolt',
  sun: 'Sun',
  moon: 'Moon',
  smileyFace: 'Smiley Face',
  foldedCorner: 'Folded Corner',
  bevel: 'Bevel',
  frame: 'Frame',
  halfFrame: 'Half Frame',
  corner: 'Corner',
  diagStripe: 'Diagonal Stripe',
  chord: 'Chord',
  can: 'Can',
  cube: 'Cube',
  plus: 'Plus',
  cross: 'Cross',
  irregularSeal1: 'Explosion 1',
  irregularSeal2: 'Explosion 2',
  homePlate: 'Home Plate',
  funnel: 'Funnel',
};

// =============================================================================
// Combined Supported Set (shape-engine registry + hardcoded fallback)
// =============================================================================

/**
 * Lazily-computed combined set of supported shape types.
 * Merges shape-engine registry with the hardcoded fallback set.
 */
let _combinedSupportedTypes: ReadonlySet<string> | null = null;

function getCombinedSupportedTypes(): ReadonlySet<string> {
  if (!_combinedSupportedTypes) {
    const engineTypes = getRegisteredShapeTypes();
    const combined = new Set<string>(engineTypes);
    for (const t of HARDCODED_SHAPE_TYPES) {
      combined.add(t);
    }
    _combinedSupportedTypes = combined;
  }
  return _combinedSupportedTypes;
}

/**
 * Get the full set of supported shape types.
 *
 * Returns the combined set from the shape-engine registry + hardcoded fallback,
 * lazily initialized. Previously this was a static constant equal to
 * HARDCODED_SHAPE_TYPES only.
 *
 * @returns Combined set of all supported shape types
 */
export function getSupportedShapeTypes(): ReadonlySet<string> {
  return getCombinedSupportedTypes();
}

// =============================================================================
// Functions
// =============================================================================

/**
 * Check if a shape type has native rendering support.
 *
 * Checks both the shape-engine preset registry and the hardcoded fallback set.
 * A shape type is considered supported if it is registered in either source.
 *
 * @param shapeType - The shape type to check
 * @returns True if the shape renders natively, false if it uses fallback
 */
export function isShapeTypeSupported(shapeType: ShapeType): boolean {
  return getCombinedSupportedTypes().has(shapeType);
}

/**
 * Get rendering information for a shape type.
 *
 * @param shapeType - The shape type to get info for
 * @returns Rendering info including strategy, category, and display name
 */
export function getShapeRenderingInfo(shapeType: ShapeType): ShapeRenderingInfo {
  const isSupported = getCombinedSupportedTypes().has(shapeType);

  return {
    strategy: isSupported ? 'native' : 'fallback',
    category: SHAPE_CATEGORIES[shapeType] ?? 'other',
    displayName: SHAPE_DISPLAY_NAMES[shapeType] ?? formatShapeTypeName(shapeType),
  };
}

/**
 * Format a camelCase shape type name as a human-readable string.
 * Fallback for shape types not in the display names map.
 *
 * @param shapeType - The shape type to format
 * @returns Human-readable name
 */
function formatShapeTypeName(shapeType: string): string {
  // Convert camelCase to Title Case with spaces
  return shapeType
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

/**
 * Get all shape types that render with fallback (for debugging/monitoring).
 *
 * @param shapeTypes - Array of shape types to check
 * @returns Array of shape types that use fallback rendering
 */
export function getUnsupportedShapeTypes(shapeTypes: ShapeType[]): ShapeType[] {
  const supported = getCombinedSupportedTypes();
  return shapeTypes.filter((type) => !supported.has(type));
}
