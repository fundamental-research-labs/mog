/**
 * Spec-driven preset shape registration.
 *
 * Loads all 186 OOXML preset shape definitions from the generated JSON
 * (extracted from ECMA-376 presetShapeDefinitions.xml) and registers
 * each as a PathGenerator using the existing custom geometry evaluator.
 *
 * Also registers all shape metadata (categories, natural ratios, scaling
 * modes, text insets, unfilled state) — this is the single source of truth
 * for OOXML preset shapes.
 */
import type { BoundingBox } from '@mog-sdk/contracts/geometry';
import type { GeometryPathCommand } from '@mog-sdk/contracts/diagram';
import type { CustomPath } from '../custom-geometry';
import { customGeometryToPath, evaluateGuides, resolveOoxmlPath } from '../custom-geometry';
import type { ShapeAdjustment } from './registry';
import {
  registerCategory,
  registerNaturalRatio,
  registerPreset,
  registerScalingMode,
  registerTextInset,
  registerUnfilled,
} from './registry';

import presetShapeData from './preset-shape-data.json' with { type: 'json' };

// ─── OOXML Category Mapping ─────────────────────────────────────────────────

const SHAPE_CATEGORIES: Record<string, string[]> = {
  'Basic Shapes': [
    'rect',
    'roundRect',
    'snip1Rect',
    'snip2SameRect',
    'snip2DiagRect',
    'snipRoundRect',
    'round1Rect',
    'round2SameRect',
    'round2DiagRect',
    'ellipse',
    'triangle',
    'rtTriangle',
    'diamond',
    'parallelogram',
    'trapezoid',
    'nonIsoscelesTrapezoid',
    'pentagon',
    'hexagon',
    'heptagon',
    'octagon',
    'decagon',
    'dodecagon',
    'pie',
    'pieWedge',
    'chord',
    'teardrop',
    'frame',
    'halfFrame',
    'corner',
    'diagStripe',
    'plus',
    'cross',
    'cube',
    'can',
    'bevel',
    'donut',
    'noSmoking',
    'blockArc',
    'foldedCorner',
    'smileyFace',
    'heart',
    'lightningBolt',
    'sun',
    'moon',
    'plaque',
    'funnel',
    'gear6',
    'gear9',
    'cornerTabs',
    'squareTabs',
    'plaqueTabs',
    'chartX',
    'chartStar',
    'chartPlus',
  ],
  'Block Arrows': [
    'rightArrow',
    'leftArrow',
    'upArrow',
    'downArrow',
    'leftRightArrow',
    'upDownArrow',
    'quadArrow',
    'bentArrow',
    'bentUpArrow',
    'uturnArrow',
    'leftUpArrow',
    'leftRightUpArrow',
    'chevron',
    'homePlate',
    'stripedRightArrow',
    'notchedRightArrow',
    'circularArrow',
    'leftCircularArrow',
    'leftRightCircularArrow',
    'swooshArrow',
    'curvedRightArrow',
    'curvedLeftArrow',
    'curvedUpArrow',
    'curvedDownArrow',
    'rightArrowCallout',
    'leftArrowCallout',
    'upArrowCallout',
    'downArrowCallout',
    'leftRightArrowCallout',
    'upDownArrowCallout',
    'quadArrowCallout',
  ],
  Flowchart: [
    'flowChartProcess',
    'flowChartAlternateProcess',
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
    'flowChartOffpageConnector',
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
  ],
  'Stars & Banners': [
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
    'irregularSeal1',
    'irregularSeal2',
    'ribbon',
    'ribbon2',
    'ellipseRibbon',
    'ellipseRibbon2',
    'leftRightRibbon',
    'wave',
    'doubleWave',
    'verticalScroll',
    'horizontalScroll',
  ],
  Callouts: [
    'wedgeRectCallout',
    'wedgeRoundRectCallout',
    'wedgeEllipseCallout',
    'cloud',
    'cloudCallout',
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
  ],
  Math: ['mathPlus', 'mathMinus', 'mathMultiply', 'mathDivide', 'mathEqual', 'mathNotEqual'],
  'Action Buttons': [
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
  ],
  'Lines & Connectors': [
    'line',
    'lineInv',
    'straightConnector1',
    'arc',
    'bentConnector2',
    'bentConnector3',
    'bentConnector4',
    'bentConnector5',
    'curvedConnector2',
    'curvedConnector3',
    'curvedConnector4',
    'curvedConnector5',
  ],
  Brackets: ['leftBracket', 'rightBracket', 'leftBrace', 'rightBrace', 'bracketPair', 'bracePair'],
};

// Build reverse map: shapeName -> category
const shapeToCategoryMap = new Map<string, string>();
for (const [category, shapes] of Object.entries(SHAPE_CATEGORIES)) {
  for (const shape of shapes) {
    shapeToCategoryMap.set(shape, category);
  }
}

// ─── Types for the JSON structure ────────────────────────────────────────────

interface JsonGuide {
  name: string;
  fmla: string;
}

interface JsonPathCommand {
  type: string;
  x?: string;
  y?: string;
  x1?: string;
  y1?: string;
  x2?: string;
  y2?: string;
  x3?: string;
  y3?: string;
  wR?: string;
  hR?: string;
  stAng?: string;
  swAng?: string;
}

interface JsonPath {
  w?: number;
  h?: number;
  fill?: string;
  stroke?: boolean;
  commands: JsonPathCommand[];
}

interface JsonConnectionPoint {
  ang: string;
  x: string;
  y: string;
}

interface JsonShapeDef {
  avLst: JsonGuide[];
  gdLst: JsonGuide[];
  pathLst: JsonPath[];
  cxnLst?: JsonConnectionPoint[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseAdjDefault(fmla: string): number {
  const parts = fmla.trim().split(/\s+/);
  if (parts[0] === 'val' && parts[1] !== undefined) {
    const num = Number(parts[1]);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

function toGeometryCommands(commands: JsonPathCommand[]): GeometryPathCommand[] {
  return commands.map((cmd): GeometryPathCommand => {
    switch (cmd.type) {
      case 'moveTo':
        return { type: 'moveTo', x: cmd.x!, y: cmd.y! };
      case 'lineTo':
        return { type: 'lineTo', x: cmd.x!, y: cmd.y! };
      case 'cubicBezTo':
        return {
          type: 'cubicBezTo',
          x1: cmd.x1!,
          y1: cmd.y1!,
          x2: cmd.x2!,
          y2: cmd.y2!,
          x3: cmd.x3!,
          y3: cmd.y3!,
        };
      case 'quadBezTo':
        return {
          type: 'quadBezTo',
          x1: cmd.x1!,
          y1: cmd.y1!,
          x2: cmd.x2!,
          y2: cmd.y2!,
        };
      case 'arcTo':
        return {
          type: 'arcTo',
          wR: cmd.wR!,
          hR: cmd.hR!,
          stAng: cmd.stAng!,
          swAng: cmd.swAng!,
        };
      case 'close':
        return { type: 'close' };
      default:
        return { type: 'close' };
    }
  });
}

// ─── Registration ────────────────────────────────────────────────────────────

const shapeData = presetShapeData as Record<string, JsonShapeDef>;

for (const [shapeName, def] of Object.entries(shapeData)) {
  // Set category for this shape
  const category = shapeToCategoryMap.get(shapeName) ?? 'Other';
  registerCategory(category);

  const adjDefaults: Array<{ name: string; defaultValue: number; fmla: string }> = def.avLst.map(
    (av) => ({
      name: av.name,
      defaultValue: parseAdjDefault(av.fmla),
      fmla: av.fmla,
    }),
  );

  const geometryPaths: Array<{
    w?: number;
    h?: number;
    fill?: string;
    stroke?: boolean;
    commands: GeometryPathCommand[];
  }> = def.pathLst.map((p) => ({
    w: p.w,
    h: p.h,
    fill: p.fill,
    stroke: p.stroke,
    commands: toGeometryCommands(p.commands),
  }));

  const gdGuides = def.gdLst.map((g) => ({ name: g.name, formula: g.fmla }));

  const defaults: ShapeAdjustment[] = adjDefaults.map((ad) => ({
    name: ad.name,
    value: ad.defaultValue,
  }));

  registerPreset(
    shapeName,
    (w: number, h: number, adjustments: ShapeAdjustment[]) => {
      const adjGuides = adjDefaults.map((ad) => {
        const userAdj = adjustments.find((a) => a.name === ad.name);
        const value = userAdj !== undefined ? userAdj.value : ad.defaultValue;
        return { name: ad.name, formula: `val ${value}` };
      });

      const allGuides = [...adjGuides, ...gdGuides];
      const guideMap = evaluateGuides(allGuides, w, h);

      const strokablePaths = geometryPaths.filter((p) => p.stroke !== false);
      const pathsToUse = strokablePaths.length > 0 ? strokablePaths : geometryPaths;
      const resolvedPaths: CustomPath[] = pathsToUse.map((p) => ({
        width: p.w,
        height: p.h,
        fill: p.fill as CustomPath['fill'],
        stroke: p.stroke,
        commands: resolveOoxmlPath(p.commands, guideMap),
      }));

      return customGeometryToPath([], resolvedPaths, {
        width: w,
        height: h,
        targetWidth: w,
        targetHeight: h,
      });
    },
    defaults.length > 0 ? defaults : undefined,
  );
}

// ─── Natural Aspect Ratios ──────────────────────────────────────────────────
// Migrated from hand-coded preset files. ratio = width / height.

// Square (1:1)
for (const name of [
  'ellipse',
  'pentagon',
  'heptagon',
  'decagon',
  'dodecagon',
  'diamond',
  'pie',
  'blockArc',
  'donut',
  'noSmoking',
  'cross',
  'plus',
  'smileyFace',
  'heart',
  'teardrop',
  'chord',
  'triangle',
  'rtTriangle',
  'lightningBolt',
  'diagStripe',
  'pieWedge',
  'hexagon',
  'octagon',
  'cornerTabs',
  'squareTabs',
  'plaqueTabs',
  'chartX',
  'chartStar',
  'chartPlus',
]) {
  registerNaturalRatio(name, 1);
}

// Action buttons (1:1)
for (const name of [
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
]) {
  registerNaturalRatio(name, 1);
}

// Locked 1:1 (resize constrained — geometry degrades when non-square)
registerNaturalRatio('sun', 1, true);
registerNaturalRatio('gear6', 1, true);
registerNaturalRatio('gear9', 1, true);

// Rectangle-like (3:2)
for (const name of [
  'rect',
  'roundRect',
  'parallelogram',
  'trapezoid',
  'nonIsoscelesTrapezoid',
  'plaque',
  'frame',
  'halfFrame',
  'corner',
  'bevel',
  'foldedCorner',
  'round1Rect',
  'round2SameRect',
  'round2DiagRect',
  'snip1Rect',
  'snip2SameRect',
  'snip2DiagRect',
  'snipRoundRect',
]) {
  registerNaturalRatio(name, 1.5);
}

// Slightly taller (3:4)
for (const name of ['can', 'cube', 'funnel']) {
  registerNaturalRatio(name, 0.75);
}

// Taller (1:2)
for (const name of ['moon', 'bracketPair', 'bracePair']) {
  registerNaturalRatio(name, 0.5);
}

// Very tall (2:5)
for (const name of ['leftBracket', 'rightBracket', 'leftBrace', 'rightBrace']) {
  registerNaturalRatio(name, 0.4);
}

// ─── Arrow Ratios ───────────────────────────────────────────────────────────

// Wide horizontal arrows (2.0)
for (const name of [
  'rightArrow',
  'leftArrow',
  'leftRightArrow',
  'chevron',
  'homePlate',
  'stripedRightArrow',
  'notchedRightArrow',
  'rightArrowCallout',
  'leftArrowCallout',
  'leftRightArrowCallout',
]) {
  registerNaturalRatio(name, 2.0);
}

// Tall vertical arrows (0.5)
for (const name of [
  'upArrow',
  'downArrow',
  'upDownArrow',
  'upArrowCallout',
  'downArrowCallout',
  'upDownArrowCallout',
]) {
  registerNaturalRatio(name, 0.5);
}

// Symmetric arrows (1.0)
for (const name of [
  'quadArrow',
  'quadArrowCallout',
  'bentArrow',
  'bentUpArrow',
  'leftUpArrow',
  'leftRightUpArrow',
  'uturnArrow',
  'circularArrow',
  'leftCircularArrow',
  'leftRightCircularArrow',
  'curvedRightArrow',
  'curvedLeftArrow',
  'curvedUpArrow',
  'curvedDownArrow',
  'swooshArrow',
]) {
  registerNaturalRatio(name, 1.0);
}

// ─── Callout Ratios ─────────────────────────────────────────────────────────

// Rectangular callouts (1.5)
for (const name of [
  'wedgeRectCallout',
  'wedgeRoundRectCallout',
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
]) {
  registerNaturalRatio(name, 1.5);
}

// Symmetric callouts (1.0)
for (const name of ['wedgeEllipseCallout', 'cloud', 'cloudCallout']) {
  registerNaturalRatio(name, 1.0);
}

// ─── Flowchart Ratios ───────────────────────────────────────────────────────

// Rectangular flowchart shapes (1.5)
for (const name of [
  'flowChartProcess',
  'flowChartAlternateProcess',
  'flowChartInputOutput',
  'flowChartPredefinedProcess',
  'flowChartDocument',
  'flowChartMultidocument',
  'flowChartTerminator',
  'flowChartPreparation',
  'flowChartManualInput',
  'flowChartManualOperation',
  'flowChartPunchedCard',
  'flowChartPunchedTape',
  'flowChartOnlineStorage',
  'flowChartMagneticDisk',
  'flowChartMagneticDrum',
  'flowChartDisplay',
  'flowChartDelay',
  'flowChartOfflineStorage',
  'flowChartInternalStorage',
]) {
  registerNaturalRatio(name, 1.5);
}

// Symmetric flowchart shapes (1.0)
for (const name of [
  'flowChartDecision',
  'flowChartConnector',
  'flowChartOffpageConnector',
  'flowChartSummingJunction',
  'flowChartOr',
  'flowChartCollate',
  'flowChartSort',
  'flowChartExtract',
  'flowChartMerge',
  'flowChartMagneticTape',
]) {
  registerNaturalRatio(name, 1.0);
}

// ─── Stars & Banners Ratios ─────────────────────────────────────────────────

// Stars and seals (1.0)
for (const name of [
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
  'irregularSeal1',
  'irregularSeal2',
]) {
  registerNaturalRatio(name, 1.0);
}

// Ribbons and banners (2.5)
for (const name of ['ribbon', 'ribbon2', 'ellipseRibbon', 'ellipseRibbon2', 'leftRightRibbon']) {
  registerNaturalRatio(name, 2.5);
}

// Waves (2.0)
registerNaturalRatio('wave', 2.0);
registerNaturalRatio('doubleWave', 2.0);

// Scrolls
registerNaturalRatio('verticalScroll', 0.75);
registerNaturalRatio('horizontalScroll', 1.33);

// ─── Math Ratios ────────────────────────────────────────────────────────────

for (const name of [
  'mathPlus',
  'mathMinus',
  'mathMultiply',
  'mathDivide',
  'mathEqual',
  'mathNotEqual',
]) {
  registerNaturalRatio(name, 1.0);
}

// ─── Scaling Modes ──────────────────────────────────────────────────────────

registerScalingMode('smileyFace', 'uniform');

for (const name of ['flowChartConnector', 'flowChartSummingJunction', 'flowChartOr']) {
  registerScalingMode(name, 'uniform');
}

for (const name of [
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
]) {
  registerScalingMode(name, 'uniform');
}

// ─── Unfilled Shapes (stroke-only) ──────────────────────────────────────────

for (const name of [
  'leftBracket',
  'rightBracket',
  'leftBrace',
  'rightBrace',
  'bracketPair',
  'bracePair',
  'line',
  'lineInv',
  'arc',
  'straightConnector1',
  'bentConnector2',
  'bentConnector3',
  'bentConnector4',
  'bentConnector5',
  'curvedConnector2',
  'curvedConnector3',
  'curvedConnector4',
  'curvedConnector5',
]) {
  registerUnfilled(name);
}

// ─── Text Inset Registrations ───────────────────────────────────────────────

// Helper for compute-based text insets
type ComputeFn = (
  shapeBounds: BoundingBox,
  adjustments: ShapeAdjustment[],
) => {
  insetBox: BoundingBox;
  verticalAlign: 'top' | 'middle' | 'bottom';
  margins: { top: number; right: number; bottom: number; left: number };
};

// Rectangle and similar box shapes: 5% margin
registerTextInset('rect', { marginFraction: 0.05 });

// Rounded rectangle: margin depends on corner radius
registerTextInset('roundRect', {
  compute: ((shapeBounds: BoundingBox, adj: ShapeAdjustment[]) => {
    const { x, y, width: w, height: h } = shapeBounds;
    const cornerRadius = adj.find((a) => a.name === 'cornerRadius');
    const r = cornerRadius ? cornerRadius.value : 0.1667;
    const clampedR = Math.max(0.05, Math.min(r, 0.5));
    const marginFraction = Math.max(0.05, clampedR * 0.3);
    const mx = marginFraction * w;
    const my = marginFraction * h;
    return {
      insetBox: {
        x: x + mx,
        y: y + my,
        width: Math.max(0, w - mx * 2),
        height: Math.max(0, h - my * 2),
      },
      verticalAlign: 'middle' as const,
      margins: { top: my, right: mx, bottom: my, left: mx },
    };
  }) as ComputeFn,
});

// Oval: inscribed rectangle in an ellipse
registerTextInset('ellipse', { marginFraction: (1 - Math.SQRT1_2) / 2 });

// Diamond: inscribed rectangle
registerTextInset('diamond', { marginFraction: 0.25 });

// Triangle: custom layout with large top margin
registerTextInset('triangle', {
  compute: ((shapeBounds: BoundingBox) => {
    const { x, y, width: w, height: h } = shapeBounds;
    const topMargin = h * 0.4;
    const sideMargin = w * 0.2;
    return {
      insetBox: {
        x: x + sideMargin,
        y: y + topMargin,
        width: Math.max(0, w - sideMargin * 2),
        height: Math.max(0, h - topMargin - h * 0.05),
      },
      verticalAlign: 'top' as const,
      margins: { top: topMargin, right: sideMargin, bottom: h * 0.05, left: sideMargin },
    };
  }) as ComputeFn,
});

// Parallelogram: asymmetric margins based on skew
registerTextInset('parallelogram', {
  compute: ((shapeBounds: BoundingBox, adj: ShapeAdjustment[]) => {
    const { x, y, width: w, height: h } = shapeBounds;
    const f = adj.find((a) => a.name === 'adjust');
    const adjustVal = f ? Math.max(0, Math.min(f.value, 1)) : 0.25;
    const dx = adjustVal * w;
    return {
      insetBox: {
        x: x + dx * 0.6,
        y: y + h * 0.05,
        width: Math.max(0, w - dx * 1.2),
        height: Math.max(0, h * 0.9),
      },
      verticalAlign: 'middle' as const,
      margins: { top: h * 0.05, right: dx * 0.6, bottom: h * 0.05, left: dx * 0.6 },
    };
  }) as ComputeFn,
});

// Trapezoid: margins due to slanted sides
registerTextInset('trapezoid', {
  compute: ((shapeBounds: BoundingBox, adj: ShapeAdjustment[]) => {
    const { x, y, width: w, height: h } = shapeBounds;
    const f = adj.find((a) => a.name === 'adjust');
    const adjustVal = f ? Math.max(0, Math.min(f.value, 0.5)) : 0.25;
    const dx = adjustVal * w * 0.5;
    return {
      insetBox: {
        x: x + dx,
        y: y + h * 0.05,
        width: Math.max(0, w - dx * 2),
        height: Math.max(0, h * 0.9),
      },
      verticalAlign: 'middle' as const,
      margins: { top: h * 0.05, right: dx, bottom: h * 0.05, left: dx },
    };
  }) as ComputeFn,
});

// Regular polygons: 10% margin
for (const name of ['pentagon', 'hexagon', 'heptagon', 'octagon', 'decagon', 'dodecagon']) {
  registerTextInset(name, { marginFraction: 0.1 });
}

// Can (cylinder): larger top margin for the cap
registerTextInset('can', {
  compute: ((shapeBounds: BoundingBox, adj: ShapeAdjustment[]) => {
    const { x, y, width: w, height: h } = shapeBounds;
    const f = adj.find((a) => a.name === 'adjust');
    const adjustVal = f ? Math.max(0.05, Math.min(f.value, 0.5)) : 0.25;
    const topInset = adjustVal * h * 0.5;
    return {
      insetBox: {
        x: x + w * 0.05,
        y: y + topInset,
        width: Math.max(0, w * 0.9),
        height: Math.max(0, h - topInset - h * 0.05),
      },
      verticalAlign: 'middle' as const,
      margins: { top: topInset, right: w * 0.05, bottom: h * 0.05, left: w * 0.05 },
    };
  }) as ComputeFn,
});

// Arrow shapes: 15% margin
for (const name of ['rightArrow', 'leftArrow', 'upArrow', 'downArrow', 'chevron', 'homePlate']) {
  registerTextInset(name, { marginFraction: 0.15 });
}

// Star shapes: 30% margin (limited internal space)
for (const name of ['star4', 'star5', 'star6', 'star7', 'star8', 'star10', 'star12']) {
  registerTextInset(name, { marginFraction: 0.3 });
}

// Flowchart basic shapes: use geometry-appropriate margins
registerTextInset('flowChartProcess', { marginFraction: 0.05 });
registerTextInset('flowChartAlternateProcess', { marginFraction: 0.05 });
registerTextInset('flowChartDecision', { marginFraction: 0.25 }); // diamond shape
registerTextInset('flowChartConnector', { marginFraction: (1 - Math.SQRT1_2) / 2 }); // circle (oval margins)
registerTextInset('flowChartOr', { marginFraction: (1 - Math.SQRT1_2) / 2 }); // circle
registerTextInset('flowChartSummingJunction', { marginFraction: (1 - Math.SQRT1_2) / 2 }); // circle
registerTextInset('flowChartInternalStorage', { marginFraction: 0.1 });
registerTextInset('flowChartPredefinedProcess', { marginFraction: 0.1 });

// Flowchart text insets (complex shapes)
registerTextInset('flowChartExtract', {
  compute: ((shapeBounds: BoundingBox) => {
    const { x, y, width: w, height: h } = shapeBounds;
    const topMargin = h * 0.4;
    const sideMargin = w * 0.2;
    return {
      insetBox: {
        x: x + sideMargin,
        y: y + topMargin,
        width: Math.max(0, w - sideMargin * 2),
        height: Math.max(0, h - topMargin - h * 0.05),
      },
      verticalAlign: 'top' as const,
      margins: { top: topMargin, right: sideMargin, bottom: h * 0.05, left: sideMargin },
    };
  }) as ComputeFn,
});

registerTextInset('flowChartInputOutput', {
  compute: ((shapeBounds: BoundingBox) => {
    const { x, y, width: w, height: h } = shapeBounds;
    const dx = 0.2 * w;
    return {
      insetBox: {
        x: x + dx * 0.6,
        y: y + h * 0.05,
        width: Math.max(0, w - dx * 1.2),
        height: Math.max(0, h * 0.9),
      },
      verticalAlign: 'middle' as const,
      margins: { top: h * 0.05, right: dx * 0.6, bottom: h * 0.05, left: dx * 0.6 },
    };
  }) as ComputeFn,
});

registerTextInset('flowChartManualOperation', {
  compute: ((shapeBounds: BoundingBox) => {
    const { x, y, width: w, height: h } = shapeBounds;
    const dx = 0.2 * w * 0.5;
    return {
      insetBox: {
        x: x + dx,
        y: y + h * 0.05,
        width: Math.max(0, w - dx * 2),
        height: Math.max(0, h * 0.9),
      },
      verticalAlign: 'middle' as const,
      margins: { top: h * 0.05, right: dx, bottom: h * 0.05, left: dx },
    };
  }) as ComputeFn,
});

registerTextInset('flowChartPreparation', { marginFraction: 0.1 });
registerTextInset('flowChartTerminator', { marginFraction: 0.1 });

const flowChartDocumentInset: ComputeFn = (shapeBounds: BoundingBox) => {
  const { x, y, width: w, height: h } = shapeBounds;
  return {
    insetBox: {
      x: x + w * 0.05,
      y: y + h * 0.05,
      width: Math.max(0, w * 0.9),
      height: Math.max(0, h * 0.8),
    },
    verticalAlign: 'middle' as const,
    margins: { top: h * 0.05, right: w * 0.05, bottom: h * 0.15, left: w * 0.05 },
  };
};
registerTextInset('flowChartDocument', { compute: flowChartDocumentInset });
registerTextInset('flowChartMultidocument', { compute: flowChartDocumentInset });
