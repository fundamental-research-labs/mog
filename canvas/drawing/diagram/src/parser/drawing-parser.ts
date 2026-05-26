/**
 * Diagram Drawing Cache Parser (drawing#.xml)
 *
 * Parses the pre-rendered Diagram drawing cache XML into strongly-typed
 * DiagramDrawing objects. The drawing cache contains:
 * - Shape tree with fully positioned shapes
 * - Individual shapes (dsp:sp) with resolved transforms, fills, and text
 * - Group shapes (dsp:grpSp) containing nested shapes
 * - Style references linking shapes to the document theme
 * - Non-visual properties (names, IDs)
 *
 * Input: Pre-parsed XML object (from fast-xml-parser / WASM XML bridge format)
 * Output: DiagramDrawing interface from @mog-sdk/contracts
 *
 * @see [MS-ODRAWXML] Section 2.3 (Diagram Drawing)
 */

import type {
  CustomGeometry,
  DiagramCachedShapeProperties,
  DiagramCachedShapeStyle,
  DiagramDrawing,
  DiagramFontRef,
  DiagramGroupShape,
  DiagramGroupShapeProperties,
  DiagramGroupTransform,
  DiagramShape,
  DiagramThemeRef,
  GeometryConnectionSite,
  GeometryGuide,
  GeometryPath,
  ModelId,
  NonVisualShapeProperties,
} from '@mog-sdk/contracts/diagram';
import {
  parseDmlColor,
  parseEffectList,
  parseFill,
  parseLineProperties,
  parseRichText,
  parseShapeProperties,
} from './drawingml-helpers';
import type { XmlNode } from './xml-helpers';
import { attr, boolAttr, child, children, iterateChildrenInOrder, numAttr } from './xml-helpers';

// =============================================================================
// Enum Validation Sets
// =============================================================================

const VALID_GEOM_PATH_FILL = new Set<string>([
  'none',
  'norm',
  'lighten',
  'lightenLess',
  'darken',
  'darkenLess',
]);
const VALID_FONT_REF_IDX = new Set<string>(['major', 'minor', 'none']);

// =============================================================================
// Main Parse Function
// =============================================================================

/**
 * Parse a Diagram drawing cache from a pre-parsed XML object.
 *
 * @param xml - Pre-parsed XML object
 * @returns Parsed DiagramDrawing
 */
export function parseDiagramDrawing(xml: XmlNode): DiagramDrawing {
  // Navigate to the drawing element
  const drawing = child(xml, 'dsp:drawing') ?? xml;

  // Parse shape tree
  const spTree = child(drawing, 'dsp:spTree');
  const shapeTree = spTree ? parseShapeTreeChildren(spTree) : [];

  return { shapeTree };
}

// =============================================================================
// Shape Tree Parsing
// =============================================================================

/**
 * Parse children of a shape tree or group shape.
 * Returns array of shapes and group shapes in document order.
 *
 * IMPORTANT: Shapes (dsp:sp) and groups (dsp:grpSp) are iterated in document
 * order to preserve z-order. JavaScript objects preserve string key insertion
 * order (ES2015+), so walking Object.keys() gives the original XML sequence.
 */
function parseShapeTreeChildren(spTree: XmlNode): Array<DiagramShape | DiagramGroupShape> {
  const result: Array<DiagramShape | DiagramGroupShape> = [];

  iterateChildrenInOrder(spTree, {
    'dsp:sp': (spNode) => {
      const shape = parseDiagramShape(spNode);
      if (shape) result.push(shape);
    },
    'dsp:grpSp': (grpSpNode) => {
      const grpShape = parseDiagramGroupShape(grpSpNode);
      if (grpShape) result.push(grpShape);
    },
  });

  return result;
}

// =============================================================================
// Individual Shape Parsing
// =============================================================================

/**
 * Parse a dsp:sp element into a DiagramShape.
 */
function parseDiagramShape(spNode: XmlNode): DiagramShape | null {
  if (!spNode) return null;

  const result: DiagramShape = {};

  // Parse model ID (links back to data model)
  const modelId = attr(spNode, 'modelId');
  if (modelId) result.modelId = modelId as ModelId;

  // Parse non-visual properties
  const nvSpPr = child(spNode, 'dsp:nvSpPr');
  if (nvSpPr) {
    result.nvSpPr = parseNonVisualShapeProperties(nvSpPr);
  }

  // Parse shape properties
  const spPrNode = child(spNode, 'dsp:spPr') ?? child(spNode, 'a:spPr');
  if (spPrNode) {
    result.shapeProperties = parseCachedShapeProperties(spPrNode);
  }

  // Parse text body
  const txBody = child(spNode, 'dsp:txBody') ?? child(spNode, 'a:txBody');
  if (txBody) {
    result.textBody = parseRichText(txBody);
  }

  // Parse style
  const styleNode = child(spNode, 'dsp:style') ?? child(spNode, 'a:style');
  if (styleNode) {
    result.style = parseCachedShapeStyle(styleNode);
  }

  return result;
}

// =============================================================================
// Non-Visual Shape Properties
// =============================================================================

/**
 * Parse non-visual shape properties from dsp:nvSpPr element.
 */
function parseNonVisualShapeProperties(nvSpPr: XmlNode): NonVisualShapeProperties {
  const result: NonVisualShapeProperties = {};

  // Parse cNvPr (common non-visual properties)
  const cNvPr = child(nvSpPr, 'dsp:cNvPr') ?? child(nvSpPr, 'a:cNvPr');
  if (cNvPr) {
    const name = attr(cNvPr, 'name');
    if (name) result.name = name;

    const id = numAttr(cNvPr, 'id');
    if (id !== undefined) result.id = id;

    const hidden = boolAttr(cNvPr, 'hidden');
    if (hidden !== undefined) result.hidden = hidden;

    const title = attr(cNvPr, 'title');
    if (title) result.title = title;

    const descr = attr(cNvPr, 'descr');
    if (descr) result.descr = descr;
  }

  return result;
}

// =============================================================================
// Cached Shape Properties
// =============================================================================

/**
 * Parse cached shape properties (extends DmlShapeProperties with custom geometry).
 */
function parseCachedShapeProperties(spPrNode: XmlNode): DiagramCachedShapeProperties | undefined {
  // First parse the base DmlShapeProperties
  const base = parseShapeProperties(spPrNode);
  if (!base) {
    // Still try to parse custom geometry
    const custGeom = child(spPrNode, 'a:custGeom');
    if (custGeom) {
      return { customGeometry: parseCustomGeometry(custGeom) };
    }
    return undefined;
  }

  const result: DiagramCachedShapeProperties = { ...base };

  // Parse custom geometry
  const custGeom = child(spPrNode, 'a:custGeom');
  if (custGeom) {
    result.customGeometry = parseCustomGeometry(custGeom);
  }

  return result;
}

// =============================================================================
// Custom Geometry Parsing
// =============================================================================

/**
 * Parse custom geometry from a:custGeom element.
 */
function parseCustomGeometry(custGeom: XmlNode): CustomGeometry {
  const result: CustomGeometry = {
    pathLst: [],
  };

  // Parse adjustment values
  const avLst = child(custGeom, 'a:avLst');
  if (avLst) {
    const avs: Record<string, number> = {};
    for (const gd of children(avLst, 'a:gd')) {
      const name = attr(gd, 'name');
      const fmla = attr(gd, 'fmla');
      if (name && fmla) {
        const match = fmla.match(/val\s+(-?\d+)/);
        if (match) {
          avs[name] = parseInt(match[1], 10);
        }
      }
    }
    if (Object.keys(avs).length > 0) result.avLst = avs;
  }

  // Parse guide list
  const gdLst = child(custGeom, 'a:gdLst');
  if (gdLst) {
    const guides: GeometryGuide[] = [];
    for (const gd of children(gdLst, 'a:gd')) {
      const name = attr(gd, 'name');
      const fmla = attr(gd, 'fmla');
      if (name && fmla) {
        guides.push({ name, formula: fmla });
      }
    }
    if (guides.length > 0) result.gdLst = guides;
  }

  // Parse connection sites
  const cxnLst = child(custGeom, 'a:cxnLst');
  if (cxnLst) {
    const cxns: GeometryConnectionSite[] = [];
    for (const cxn of children(cxnLst, 'a:cxn')) {
      const ang = attr(cxn, 'ang') ?? '0';
      const pos = child(cxn, 'a:pos');
      if (pos) {
        cxns.push({
          angle: ang,
          x: attr(pos, 'x') ?? '0',
          y: attr(pos, 'y') ?? '0',
        });
      }
    }
    if (cxns.length > 0) result.cxnLst = cxns;
  }

  // Parse path list
  const pathLst = child(custGeom, 'a:pathLst');
  if (pathLst) {
    for (const pathNode of children(pathLst, 'a:path')) {
      result.pathLst.push(parseGeometryPath(pathNode));
    }
  }

  return result;
}

/**
 * Parse a single geometry path from a:path element.
 */
function parseGeometryPath(pathNode: XmlNode): GeometryPath {
  const result: GeometryPath = {
    commands: [],
  };

  const w = numAttr(pathNode, 'w');
  if (w !== undefined) result.w = w;

  const h = numAttr(pathNode, 'h');
  if (h !== undefined) result.h = h;

  const fill = attr(pathNode, 'fill');
  if (fill && VALID_GEOM_PATH_FILL.has(fill)) result.fill = fill as GeometryPath['fill'];

  const stroke = boolAttr(pathNode, 'stroke');
  if (stroke !== undefined) result.stroke = stroke;

  // Parse path commands in document order.
  // IMPORTANT: Commands must be iterated in document order to preserve the
  // correct path sequence (e.g., moveTo -> lineTo -> cubicBezTo -> close).
  // Walking Object.keys() gives insertion order (ES2015+).
  iterateChildrenInOrder(pathNode, {
    'a:moveTo': (moveTo) => {
      const pt = child(moveTo, 'a:pt');
      if (pt) {
        result.commands.push({
          type: 'moveTo',
          x: attr(pt, 'x') ?? '0',
          y: attr(pt, 'y') ?? '0',
        });
      }
    },
    'a:lnTo': (lineTo) => {
      const pt = child(lineTo, 'a:pt');
      if (pt) {
        result.commands.push({
          type: 'lineTo',
          x: attr(pt, 'x') ?? '0',
          y: attr(pt, 'y') ?? '0',
        });
      }
    },
    'a:cubicBezTo': (cubicBezTo) => {
      const pts = children(cubicBezTo, 'a:pt');
      if (pts.length >= 3) {
        result.commands.push({
          type: 'cubicBezTo',
          x1: attr(pts[0], 'x') ?? '0',
          y1: attr(pts[0], 'y') ?? '0',
          x2: attr(pts[1], 'x') ?? '0',
          y2: attr(pts[1], 'y') ?? '0',
          x3: attr(pts[2], 'x') ?? '0',
          y3: attr(pts[2], 'y') ?? '0',
        });
      }
    },
    'a:quadBezTo': (quadBezTo) => {
      const pts = children(quadBezTo, 'a:pt');
      if (pts.length >= 2) {
        result.commands.push({
          type: 'quadBezTo',
          x1: attr(pts[0], 'x') ?? '0',
          y1: attr(pts[0], 'y') ?? '0',
          x2: attr(pts[1], 'x') ?? '0',
          y2: attr(pts[1], 'y') ?? '0',
        });
      }
    },
    'a:arcTo': (arcTo) => {
      result.commands.push({
        type: 'arcTo',
        wR: attr(arcTo, 'wR') ?? '0',
        hR: attr(arcTo, 'hR') ?? '0',
        stAng: attr(arcTo, 'stAng') ?? '0',
        swAng: attr(arcTo, 'swAng') ?? '0',
      });
    },
    'a:close': () => {
      result.commands.push({ type: 'close' });
    },
  });

  return result;
}

// =============================================================================
// Cached Shape Style
// =============================================================================

/**
 * Parse a cached shape style (dsp:style or a:style element).
 */
function parseCachedShapeStyle(styleNode: XmlNode): DiagramCachedShapeStyle {
  const result: DiagramCachedShapeStyle = {};

  // Parse line reference
  const lnRef = child(styleNode, 'a:lnRef');
  if (lnRef) result.lnRef = parseDiagramThemeRef(lnRef);

  // Parse fill reference
  const fillRef = child(styleNode, 'a:fillRef');
  if (fillRef) result.fillRef = parseDiagramThemeRef(fillRef);

  // Parse effect reference
  const effectRef = child(styleNode, 'a:effectRef');
  if (effectRef) result.effectRef = parseDiagramThemeRef(effectRef);

  // Parse font reference
  const fontRef = child(styleNode, 'a:fontRef');
  if (fontRef) result.fontRef = parseDiagramFontRef(fontRef);

  return result;
}

/**
 * Parse a theme reference (lnRef, fillRef, effectRef).
 */
function parseDiagramThemeRef(refNode: XmlNode): DiagramThemeRef {
  const idx = numAttr(refNode, 'idx') ?? 0;
  const color = parseDmlColor(refNode);

  return { idx, color };
}

/**
 * Parse a font reference.
 */
function parseDiagramFontRef(refNode: XmlNode): DiagramFontRef {
  const idxStr = attr(refNode, 'idx') ?? 'none';
  const idx = (VALID_FONT_REF_IDX.has(idxStr) ? idxStr : 'none') as 'major' | 'minor' | 'none';
  const color = parseDmlColor(refNode);

  return { idx, color };
}

// =============================================================================
// Group Shape Parsing
// =============================================================================

/**
 * Parse a dsp:grpSp element into a DiagramGroupShape.
 */
function parseDiagramGroupShape(grpSpNode: XmlNode): DiagramGroupShape | null {
  if (!grpSpNode) return null;

  const result: DiagramGroupShape = {
    shapes: [],
  };

  // Parse non-visual properties
  const nvGrpSpPr = child(grpSpNode, 'dsp:nvGrpSpPr');
  if (nvGrpSpPr) {
    result.nvGrpSpPr = parseNonVisualShapeProperties(nvGrpSpPr);
  }

  // Parse group shape properties
  const grpSpPr = child(grpSpNode, 'dsp:grpSpPr') ?? child(grpSpNode, 'a:grpSpPr');
  if (grpSpPr) {
    result.groupShapeProperties = parseGroupShapeProperties(grpSpPr);
  }

  // Parse children (shapes and nested groups)
  result.shapes = parseShapeTreeChildren(grpSpNode);

  return result;
}

/**
 * Parse group shape properties.
 */
function parseGroupShapeProperties(grpSpPr: XmlNode): DiagramGroupShapeProperties {
  const result: DiagramGroupShapeProperties = {};

  // Parse group transform
  const xfrm = child(grpSpPr, 'a:xfrm');
  if (xfrm) {
    result.xfrm = parseGroupTransform(xfrm);
  }

  // Parse fill
  const fill = parseFill(grpSpPr);
  if (fill) result.fill = fill;

  // Parse line
  const ln = child(grpSpPr, 'a:ln');
  if (ln) result.line = parseLineProperties(ln);

  // Parse effects
  const effectLst = child(grpSpPr, 'a:effectLst');
  if (effectLst) result.effectList = parseEffectList(effectLst);

  return result;
}

/**
 * Parse group transform from a:xfrm element.
 */
function parseGroupTransform(xfrm: XmlNode): DiagramGroupTransform {
  const result: DiagramGroupTransform = {};

  const off = child(xfrm, 'a:off');
  if (off) {
    result.offset = {
      x: numAttr(off, 'x') ?? 0,
      y: numAttr(off, 'y') ?? 0,
    };
  }

  const ext = child(xfrm, 'a:ext');
  if (ext) {
    result.extent = {
      cx: numAttr(ext, 'cx') ?? 0,
      cy: numAttr(ext, 'cy') ?? 0,
    };
  }

  const chOff = child(xfrm, 'a:chOff');
  if (chOff) {
    result.childOffset = {
      x: numAttr(chOff, 'x') ?? 0,
      y: numAttr(chOff, 'y') ?? 0,
    };
  }

  const chExt = child(xfrm, 'a:chExt');
  if (chExt) {
    result.childExtent = {
      cx: numAttr(chExt, 'cx') ?? 0,
      cy: numAttr(chExt, 'cy') ?? 0,
    };
  }

  const rot = numAttr(xfrm, 'rot');
  if (rot !== undefined) result.rotation = rot;

  const flipH = boolAttr(xfrm, 'flipH');
  if (flipH !== undefined) result.flipH = flipH;

  const flipV = boolAttr(xfrm, 'flipV');
  if (flipV !== undefined) result.flipV = flipV;

  return result;
}
