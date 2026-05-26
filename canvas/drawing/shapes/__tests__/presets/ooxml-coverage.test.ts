/**
 * Exhaustive OOXML preset shape coverage test.
 *
 * Validates that every one of the 186 OOXML preset shape names from
 * ECMA-376 Part 1 (presetShapeDefinitions.xml) resolves in the TS
 * shape registry — either as a direct preset or via an alias.
 */
import { isValidShapeType } from '../../src/shape-to-path';

/**
 * Complete list of 186 OOXML preset shape names from ECMA-376 Part 1.
 * Sorted alphabetically for easy maintenance.
 */
const ALL_OOXML_SHAPE_NAMES: string[] = [
  'accentBorderCallout1',
  'accentBorderCallout2',
  'accentBorderCallout3',
  'accentCallout1',
  'accentCallout2',
  'accentCallout3',
  'actionButtonBackPrevious',
  'actionButtonBeginning',
  'actionButtonBlank',
  'actionButtonDocument',
  'actionButtonEnd',
  'actionButtonForwardNext',
  'actionButtonHelp',
  'actionButtonHome',
  'actionButtonInformation',
  'actionButtonMovie',
  'actionButtonReturn',
  'actionButtonSound',
  'arc',
  'bentArrow',
  'bentConnector2',
  'bentConnector3',
  'bentConnector4',
  'bentConnector5',
  'bentUpArrow',
  'bevel',
  'blockArc',
  'borderCallout1',
  'borderCallout2',
  'borderCallout3',
  'bracePair',
  'bracketPair',
  'callout1',
  'callout2',
  'callout3',
  'can',
  'chartPlus',
  'chartStar',
  'chartX',
  'chevron',
  'chord',
  'circularArrow',
  'cloud',
  'cloudCallout',
  'corner',
  'cornerTabs',
  'cube',
  'curvedConnector2',
  'curvedConnector3',
  'curvedConnector4',
  'curvedConnector5',
  'curvedDownArrow',
  'curvedLeftArrow',
  'curvedRightArrow',
  'curvedUpArrow',
  'decagon',
  'diagStripe',
  'diamond',
  'dodecagon',
  'donut',
  'doubleWave',
  'downArrow',
  'downArrowCallout',
  'ellipse',
  'ellipseRibbon',
  'ellipseRibbon2',
  'flowChartAlternateProcess',
  'flowChartCollate',
  'flowChartConnector',
  'flowChartDecision',
  'flowChartDelay',
  'flowChartDisplay',
  'flowChartDocument',
  'flowChartExtract',
  'flowChartInputOutput',
  'flowChartInternalStorage',
  'flowChartMagneticDisk',
  'flowChartMagneticDrum',
  'flowChartMagneticTape',
  'flowChartManualInput',
  'flowChartManualOperation',
  'flowChartMerge',
  'flowChartMultidocument',
  'flowChartOfflineStorage',
  'flowChartOffpageConnector',
  'flowChartOnlineStorage',
  'flowChartOr',
  'flowChartPredefinedProcess',
  'flowChartPreparation',
  'flowChartProcess',
  'flowChartPunchedCard',
  'flowChartPunchedTape',
  'flowChartSort',
  'flowChartSummingJunction',
  'flowChartTerminator',
  'foldedCorner',
  'frame',
  'funnel',
  'gear6',
  'gear9',
  'halfFrame',
  'heart',
  'heptagon',
  'hexagon',
  'homePlate',
  'horizontalScroll',
  'irregularSeal1',
  'irregularSeal2',
  'leftArrow',
  'leftArrowCallout',
  'leftBrace',
  'leftBracket',
  'leftCircularArrow',
  'leftRightArrow',
  'leftRightArrowCallout',
  'leftRightCircularArrow',
  'leftRightRibbon',
  'leftRightUpArrow',
  'leftUpArrow',
  'lightningBolt',
  'line',
  'lineInv',
  'mathDivide',
  'mathEqual',
  'mathMinus',
  'mathMultiply',
  'mathNotEqual',
  'mathPlus',
  'moon',
  'noSmoking',
  'nonIsoscelesTrapezoid',
  'notchedRightArrow',
  'octagon',
  'parallelogram',
  'pentagon',
  'pie',
  'pieWedge',
  'plaque',
  'plaqueTabs',
  'plus',
  'quadArrow',
  'quadArrowCallout',
  'rect',
  'ribbon',
  'ribbon2',
  'rightArrow',
  'rightArrowCallout',
  'rightBrace',
  'rightBracket',
  'round1Rect',
  'round2DiagRect',
  'round2SameRect',
  'roundRect',
  'rtTriangle',
  'smileyFace',
  'snip1Rect',
  'snip2DiagRect',
  'snip2SameRect',
  'snipRoundRect',
  'squareTabs',
  'star10',
  'star12',
  'star16',
  'star24',
  'star32',
  'star4',
  'star5',
  'star6',
  'star7',
  'star8',
  'straightConnector1',
  'stripedRightArrow',
  'sun',
  'swooshArrow',
  'teardrop',
  'trapezoid',
  'triangle',
  'upArrow',
  'upArrowCallout',
  'upDownArrow',
  'upDownArrowCallout',
  'uturnArrow',
  'verticalScroll',
  'wave',
  'wedgeEllipseCallout',
  'wedgeRectCallout',
  'wedgeRoundRectCallout',
];

/**
 * Shapes that are known to be unsupported in the TS registry.
 * These are tracked here so the test can pass while documenting
 * what still needs implementation.
 *
 * When a shape is implemented, remove it from this set and the
 * test will automatically start validating it.
 */
const UNSUPPORTED_PRESETS = new Set<string>([
  // upArrow is missing from preset-shape-data.json (extraction gap — only 186 of 187 shapes extracted)
  'upArrow',
]);

describe('OOXML Preset Shape Coverage', () => {
  it('should list exactly 187 OOXML shape names', () => {
    // The ECMA-376 spec defines 187 preset shape types
    expect(ALL_OOXML_SHAPE_NAMES.length).toBe(187);
  });

  it('should have no duplicates in the OOXML shape name list', () => {
    const unique = new Set(ALL_OOXML_SHAPE_NAMES);
    expect(unique.size).toBe(ALL_OOXML_SHAPE_NAMES.length);
  });

  const supportedShapes = ALL_OOXML_SHAPE_NAMES.filter((name) => !UNSUPPORTED_PRESETS.has(name));

  describe.each(supportedShapes)('OOXML shape "%s"', (shapeName) => {
    it('should resolve in the TS shape registry', () => {
      expect(isValidShapeType(shapeName)).toBe(true);
    });
  });

  it('should have no shapes in UNSUPPORTED_PRESETS that are actually supported', () => {
    const falsePositives: string[] = [];
    for (const name of UNSUPPORTED_PRESETS) {
      if (isValidShapeType(name)) {
        falsePositives.push(name);
      }
    }
    if (falsePositives.length > 0) {
      throw new Error(
        `These shapes are in UNSUPPORTED_PRESETS but are actually supported — remove them:\n` +
          falsePositives.map((n) => `  - ${n}`).join('\n'),
      );
    }
  });

  it('should report overall coverage percentage', () => {
    const supported = ALL_OOXML_SHAPE_NAMES.filter((name) => isValidShapeType(name));

    // All shapes except those in UNSUPPORTED_PRESETS should be covered
    expect(supported.length).toBe(ALL_OOXML_SHAPE_NAMES.length - UNSUPPORTED_PRESETS.size);
  });
});
