/**
 * DrawingML Parsing Helpers
 *
 * Shared parsers for DrawingML (a: namespace) structures that appear
 * across multiple Diagram XML parts: colors, shapes, text, fills, etc.
 *
 * These helpers convert pre-parsed XML nodes into the strongly-typed
 * objects defined in @mog-sdk/contracts.
 */

import type {
  BulletProperties,
  ColorTransform,
  ColorTransformType,
  DmlArrowStyle,
  DmlColorTransform,
  DmlColorTransformType,
  DmlColorValue,
  DmlEffectProperties,
  DmlFillProperties,
  DmlGradientStop,
  DmlLineProperties,
  DmlShapeProperties,
  DmlShapeTransform,
  HyperlinkInfo,
  Paragraph,
  ParagraphProperties,
  RichText,
  SchemeColor,
  SpacingValue,
  TextBodyProperties,
  TextRun,
  TextRunProperties,
  TextUnderlineType,
} from '@mog-sdk/contracts/diagram';
import type { XmlNode } from './xml-helpers';
import { attr, boolAttr, child, children, numAttr, textContent } from './xml-helpers';

// =============================================================================
// Color Transform Types (subset used in style labels)
// =============================================================================

/** Color transform element names recognized in DrawingML */
const COLOR_TRANSFORM_NAMES: readonly string[] = [
  'a:tint',
  'a:shade',
  'a:satMod',
  'a:satOff',
  'a:lumMod',
  'a:lumOff',
  'a:hueMod',
  'a:hueOff',
  'a:alpha',
  'a:alphaOff',
  'a:alphaMod',
  'a:comp',
  'a:inv',
  'a:gray',
  'a:red',
  'a:redMod',
  'a:redOff',
  'a:green',
  'a:greenMod',
  'a:greenOff',
  'a:blue',
  'a:blueMod',
  'a:blueOff',
  'a:gamma',
  'a:invGamma',
];

/** Short color transform element names (without prefix) */
const COLOR_TRANSFORM_NAMES_SHORT: readonly string[] = [
  'tint',
  'shade',
  'satMod',
  'satOff',
  'lumMod',
  'lumOff',
  'hueMod',
  'hueOff',
  'alpha',
  'alphaOff',
  'alphaMod',
  'comp',
  'inv',
  'gray',
  'red',
  'redMod',
  'redOff',
  'green',
  'greenMod',
  'greenOff',
  'blue',
  'blueMod',
  'blueOff',
  'gamma',
  'invGamma',
];

// =============================================================================
// DmlColorValue Parsing (Full DrawingML color model)
// =============================================================================

/**
 * Parse a DmlColorValue from a parent node that may contain
 * a:schemeClr, a:srgbClr, a:sysClr, or a:prstClr.
 *
 * @param node - Parent XML node
 * @returns Parsed color value or undefined
 */
export function parseDmlColor(node: XmlNode | undefined | null): DmlColorValue | undefined {
  if (!node) return undefined;

  // Try scheme color
  const schemeClr = child(node, 'a:schemeClr');
  if (schemeClr) {
    return {
      type: 'scheme',
      value: attr(schemeClr, 'val') ?? '',
      transforms: parseDmlColorTransforms(schemeClr),
    };
  }

  // Try sRGB color
  const srgbClr = child(node, 'a:srgbClr');
  if (srgbClr) {
    return {
      type: 'srgb',
      value: attr(srgbClr, 'val') ?? '',
      transforms: parseDmlColorTransforms(srgbClr),
    };
  }

  // Try system color
  const sysClr = child(node, 'a:sysClr');
  if (sysClr) {
    return {
      type: 'system',
      value: attr(sysClr, 'val') ?? '',
      lastColor: attr(sysClr, 'lastClr'),
      transforms: parseDmlColorTransforms(sysClr),
    };
  }

  // Try preset color
  const prstClr = child(node, 'a:prstClr');
  if (prstClr) {
    return {
      type: 'preset',
      value: attr(prstClr, 'val') ?? '',
      transforms: parseDmlColorTransforms(prstClr),
    };
  }

  return undefined;
}

/** Set of known color transform short names for quick lookup */
const COLOR_TRANSFORM_SHORT_SET = new Set<string>(COLOR_TRANSFORM_NAMES_SHORT);

/** Set of known color transform prefixed names for quick lookup */
const COLOR_TRANSFORM_PREFIXED_SET = new Set<string>(COLOR_TRANSFORM_NAMES);

/**
 * Parse DmlColorTransform array from a color element.
 *
 * IMPORTANT: Transforms are collected in document order by iterating
 * Object.keys() on the color node (which preserves insertion order from
 * fast-xml-parser). This ensures transforms like shade-then-tint produce
 * different results than tint-then-shade, per the OOXML spec.
 */
function parseDmlColorTransforms(colorNode: XmlNode): DmlColorTransform[] | undefined {
  const transforms: DmlColorTransform[] = [];
  const seenTypes = new Set<string>();

  for (const key of Object.keys(colorNode)) {
    // Skip attributes and text content
    if (key.startsWith('@_') || key === '#text') continue;

    let shortName: string | undefined;

    if (COLOR_TRANSFORM_PREFIXED_SET.has(key)) {
      shortName = key.replace('a:', '');
    } else if (COLOR_TRANSFORM_SHORT_SET.has(key)) {
      shortName = key;
    }

    if (!shortName) continue;

    // Deduplicate by type name (skip if we already saw this transform type
    // via its prefixed or unprefixed variant)
    if (seenTypes.has(shortName)) continue;
    seenTypes.add(shortName);

    const elems = children(colorNode, key);
    for (const elem of elems) {
      const val = numAttr(elem, 'val');
      transforms.push({ type: shortName as DmlColorTransformType, value: val });
    }
  }

  return transforms.length > 0 ? transforms : undefined;
}

// =============================================================================
// Style-Label SchemeColor Parsing (simpler subset)
// =============================================================================

/**
 * Parse a SchemeColor (style-label color) from a node.
 * Used in colors/style definition files (dgm: namespace).
 */
export function parseSchemeColor(node: XmlNode | undefined | null): SchemeColor | undefined {
  if (!node) return undefined;

  const schemeClr = child(node, 'a:schemeClr');
  if (!schemeClr) return undefined;

  const val = attr(schemeClr, 'val');
  if (!val) return undefined;

  const transforms = parseStyleColorTransforms(schemeClr);

  return {
    val,
    transforms: transforms.length > 0 ? transforms : undefined,
  };
}

/** Set of known style color transform short names */
const STYLE_TRANSFORM_SHORT_SET = new Set<string>([
  'lumMod',
  'lumOff',
  'satMod',
  'satOff',
  'tint',
  'shade',
  'alpha',
  'hueMod',
  'hueOff',
  'comp',
  'inv',
  'gray',
]);

/** Set of known style color transform prefixed names */
const STYLE_TRANSFORM_PREFIXED_SET = new Set<string>(
  [...STYLE_TRANSFORM_SHORT_SET].map((n) => `a:${n}`),
);

/**
 * Parse ColorTransform array (style label subset) from a scheme color element.
 *
 * IMPORTANT: Transforms are collected in document order by iterating
 * Object.keys() on the color node (which preserves insertion order from
 * fast-xml-parser). This ensures transforms like shade-then-tint produce
 * different results than tint-then-shade, per the OOXML spec.
 */
export function parseStyleColorTransforms(schemeClrNode: XmlNode): ColorTransform[] {
  const transforms: ColorTransform[] = [];
  const seenTypes = new Set<string>();

  for (const key of Object.keys(schemeClrNode)) {
    // Skip attributes and text content
    if (key.startsWith('@_') || key === '#text') continue;

    let shortName: string | undefined;

    if (STYLE_TRANSFORM_PREFIXED_SET.has(key)) {
      shortName = key.replace('a:', '');
    } else if (STYLE_TRANSFORM_SHORT_SET.has(key)) {
      shortName = key;
    }

    if (!shortName) continue;

    // Deduplicate by type name (skip if we already saw this transform type
    // via its prefixed or unprefixed variant)
    if (seenTypes.has(shortName)) continue;
    seenTypes.add(shortName);

    const elems = children(schemeClrNode, key);
    for (const elem of elems) {
      const val = numAttr(elem, 'val');
      transforms.push({ type: shortName as ColorTransformType, val });
    }
  }

  return transforms;
}

// =============================================================================
// Shape Properties Parsing (DmlShapeProperties)
// =============================================================================

/**
 * Parse DmlShapeProperties from a:spPr or dgm:spPr element.
 */
export function parseShapeProperties(
  spPr: XmlNode | undefined | null,
): DmlShapeProperties | undefined {
  if (!spPr) return undefined;

  const result: DmlShapeProperties = {};

  // Parse xfrm
  const xfrm = child(spPr, 'a:xfrm');
  if (xfrm) {
    result.xfrm = parseShapeTransform(xfrm);
  }

  // Parse prstGeom
  const prstGeom = child(spPr, 'a:prstGeom');
  if (prstGeom) {
    result.presetGeometry = attr(prstGeom, 'prst');

    // Parse adjustment values
    const avLst = child(prstGeom, 'a:avLst');
    if (avLst) {
      const gdElems = children(avLst, 'a:gd');
      if (gdElems.length > 0) {
        result.adjustValues = {};
        for (const gd of gdElems) {
          const name = attr(gd, 'name');
          const fmla = attr(gd, 'fmla');
          if (name && fmla) {
            const match = fmla.match(/val\s+(-?\d+)/);
            if (match) {
              result.adjustValues[name] = parseInt(match[1], 10);
            }
          }
        }
      }
    }
  }

  // Parse fill
  const fill = parseFill(spPr);
  if (fill) result.fill = fill;

  // Parse line
  const ln = child(spPr, 'a:ln');
  if (ln) {
    result.line = parseLineProperties(ln);
  }

  // Parse effect list
  const effectLst = child(spPr, 'a:effectLst');
  if (effectLst) {
    result.effectList = parseEffectList(effectLst);
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Parse DmlShapeTransform from a:xfrm element.
 */
export function parseShapeTransform(
  xfrm: XmlNode | undefined | null,
): DmlShapeTransform | undefined {
  if (!xfrm) return undefined;

  const result: DmlShapeTransform = {};

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

  const rot = numAttr(xfrm, 'rot');
  if (rot !== undefined) result.rotation = rot;

  const flipH = boolAttr(xfrm, 'flipH');
  if (flipH !== undefined) result.flipH = flipH;

  const flipV = boolAttr(xfrm, 'flipV');
  if (flipV !== undefined) result.flipV = flipV;

  return Object.keys(result).length > 0 ? result : undefined;
}

// =============================================================================
// Fill Parsing
// =============================================================================

/**
 * Parse fill properties from a parent element (looks for noFill, solidFill, gradFill, pattFill, blipFill).
 */
export function parseFill(parentNode: XmlNode | undefined | null): DmlFillProperties | undefined {
  if (!parentNode) return undefined;

  if (child(parentNode, 'a:noFill')) {
    return { type: 'none' };
  }

  const solidFill = child(parentNode, 'a:solidFill');
  if (solidFill) {
    const color = parseDmlColor(solidFill);
    if (color) {
      return { type: 'solid', color };
    }
  }

  const gradFill = child(parentNode, 'a:gradFill');
  if (gradFill) {
    const gsLst = child(gradFill, 'a:gsLst');
    const stops: DmlGradientStop[] = [];
    if (gsLst) {
      for (const gs of children(gsLst, 'a:gs')) {
        const pos = numAttr(gs, 'pos') ?? 0;
        const color = parseDmlColor(gs);
        if (color) {
          stops.push({ position: pos, color });
        }
      }
    }
    const lin = child(gradFill, 'a:lin');
    const linearProps = lin
      ? {
          angle: numAttr(lin, 'ang') ?? 0,
          scaled: boolAttr(lin, 'scaled'),
        }
      : undefined;

    return { type: 'gradient', stops, linear: linearProps };
  }

  const pattFill = child(parentNode, 'a:pattFill');
  if (pattFill) {
    const fg = child(pattFill, 'a:fgClr');
    const bg = child(pattFill, 'a:bgClr');
    return {
      type: 'pattern',
      preset: attr(pattFill, 'prst') ?? '',
      foregroundColor: fg ? parseDmlColor(fg) : undefined,
      backgroundColor: bg ? parseDmlColor(bg) : undefined,
    };
  }

  const blipFill = child(parentNode, 'a:blipFill');
  if (blipFill) {
    const blip = child(blipFill, 'a:blip');
    return {
      type: 'blip',
      embed: blip ? attr(blip, 'r:embed') : undefined,
      stretch: !!child(blipFill, 'a:stretch'),
    };
  }

  return undefined;
}

// =============================================================================
// Line Properties Parsing
// =============================================================================

/**
 * Parse DmlLineProperties from an a:ln element.
 */
export function parseLineProperties(ln: XmlNode | undefined | null): DmlLineProperties | undefined {
  if (!ln) return undefined;

  const result: DmlLineProperties = {};

  const w = numAttr(ln, 'w');
  if (w !== undefined) result.width = w;

  const cap = attr(ln, 'cap');
  if (cap && VALID_LINE_CAPS.has(cap)) result.cap = cap as DmlLineProperties['cap'];

  const cmpd = attr(ln, 'cmpd');
  if (cmpd && VALID_LINE_COMPOUNDS.has(cmpd))
    result.compound = cmpd as DmlLineProperties['compound'];

  // Parse dash style
  const prstDash = child(ln, 'a:prstDash');
  if (prstDash) {
    const dashVal = attr(prstDash, 'val');
    if (dashVal && VALID_DASH_STYLES.has(dashVal))
      result.dash = dashVal as DmlLineProperties['dash'];
  }

  // Parse fill
  const fill = parseFill(ln);
  if (fill) result.fill = fill;

  // Parse join
  if (child(ln, 'a:round')) result.join = 'round';
  else if (child(ln, 'a:bevel')) result.join = 'bevel';
  else if (child(ln, 'a:miter')) result.join = 'miter';

  // Parse arrowheads
  const headEnd = child(ln, 'a:headEnd');
  if (headEnd) result.headEnd = parseArrowStyle(headEnd);

  const tailEnd = child(ln, 'a:tailEnd');
  if (tailEnd) result.tailEnd = parseArrowStyle(tailEnd);

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Parse DmlArrowStyle from a:headEnd or a:tailEnd element.
 */
function parseArrowStyle(node: XmlNode): DmlArrowStyle {
  const result: DmlArrowStyle = {};
  const type = attr(node, 'type');
  if (type && VALID_ARROW_TYPES.has(type)) result.type = type as DmlArrowStyle['type'];
  const width = attr(node, 'w');
  if (width && VALID_ARROW_SIZES.has(width)) result.width = width as DmlArrowStyle['width'];
  const length = attr(node, 'len');
  if (length && VALID_ARROW_SIZES.has(length)) result.length = length as DmlArrowStyle['length'];
  return result;
}

// =============================================================================
// Effect Properties Parsing
// =============================================================================

/**
 * Parse DmlEffectProperties from an a:effectLst element.
 */
export function parseEffectList(
  effectLst: XmlNode | undefined | null,
): DmlEffectProperties | undefined {
  if (!effectLst) return undefined;

  const result: DmlEffectProperties = {};

  const outerShdw = child(effectLst, 'a:outerShdw');
  if (outerShdw) {
    result.outerShadow = {
      blurRadius: numAttr(outerShdw, 'blurRad'),
      distance: numAttr(outerShdw, 'dist'),
      direction: numAttr(outerShdw, 'dir'),
      color: parseDmlColor(outerShdw),
      alignment: attr(outerShdw, 'algn'),
      rotateWithShape: boolAttr(outerShdw, 'rotWithShape'),
    };
  }

  const innerShdw = child(effectLst, 'a:innerShdw');
  if (innerShdw) {
    result.innerShadow = {
      blurRadius: numAttr(innerShdw, 'blurRad'),
      distance: numAttr(innerShdw, 'dist'),
      direction: numAttr(innerShdw, 'dir'),
      color: parseDmlColor(innerShdw),
    };
  }

  const glow = child(effectLst, 'a:glow');
  if (glow) {
    result.glow = {
      radius: numAttr(glow, 'rad'),
      color: parseDmlColor(glow),
    };
  }

  const softEdge = child(effectLst, 'a:softEdge');
  if (softEdge) {
    result.softEdge = {
      radius: numAttr(softEdge, 'rad'),
    };
  }

  const reflection = child(effectLst, 'a:reflection');
  if (reflection) {
    result.reflection = {
      blurRadius: numAttr(reflection, 'blurRad'),
      startOpacity: numAttr(reflection, 'stA'),
      startPosition: numAttr(reflection, 'stPos'),
      endOpacity: numAttr(reflection, 'endA'),
      endPosition: numAttr(reflection, 'endPos'),
      distance: numAttr(reflection, 'dist'),
      direction: numAttr(reflection, 'dir'),
      fadeDirection: numAttr(reflection, 'fadeDir'),
      alignment: attr(reflection, 'algn'),
      rotateWithShape: boolAttr(reflection, 'rotWithShape'),
    };
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

// =============================================================================
// Rich Text Parsing
// =============================================================================

/**
 * Parse RichText from a dgm:t element (or any element containing a:bodyPr + a:p).
 */
export function parseRichText(textElem: XmlNode | undefined | null): RichText | undefined {
  if (!textElem) return undefined;

  const bodyPrNode = child(textElem, 'a:bodyPr');
  const bodyProperties = parseTextBodyProperties(bodyPrNode);

  const paragraphs: Paragraph[] = [];
  for (const pNode of children(textElem, 'a:p')) {
    paragraphs.push(parseParagraph(pNode));
  }

  if (!bodyProperties && paragraphs.length === 0) return undefined;

  return {
    bodyProperties: bodyProperties ?? {},
    paragraphs,
  };
}

/**
 * Parse TextBodyProperties from a:bodyPr element.
 */
function parseTextBodyProperties(
  bodyPr: XmlNode | undefined | null,
): TextBodyProperties | undefined {
  if (!bodyPr) return undefined;

  const result: TextBodyProperties = {};

  const anchor = attr(bodyPr, 'anchor');
  if (anchor && VALID_TEXT_ANCHORS.has(anchor))
    result.anchor = anchor as TextBodyProperties['anchor'];

  const horzOverflow = attr(bodyPr, 'horzOverflow');
  if (horzOverflow && VALID_OVERFLOW.has(horzOverflow))
    result.horzOverflow = horzOverflow as TextBodyProperties['horzOverflow'];

  const vertOverflow = attr(bodyPr, 'vertOverflow');
  if (vertOverflow && VALID_VERT_OVERFLOW.has(vertOverflow))
    result.vertOverflow = vertOverflow as TextBodyProperties['vertOverflow'];

  const wrap = attr(bodyPr, 'wrap');
  if (wrap && VALID_WRAP.has(wrap)) result.wrap = wrap as TextBodyProperties['wrap'];

  const lIns = numAttr(bodyPr, 'lIns');
  if (lIns !== undefined) result.lIns = lIns;

  const tIns = numAttr(bodyPr, 'tIns');
  if (tIns !== undefined) result.tIns = tIns;

  const rIns = numAttr(bodyPr, 'rIns');
  if (rIns !== undefined) result.rIns = rIns;

  const bIns = numAttr(bodyPr, 'bIns');
  if (bIns !== undefined) result.bIns = bIns;

  const numCol = numAttr(bodyPr, 'numCol');
  if (numCol !== undefined) result.numCol = numCol;

  const spcCol = numAttr(bodyPr, 'spcCol');
  if (spcCol !== undefined) result.spcCol = spcCol;

  const rot = numAttr(bodyPr, 'rot');
  if (rot !== undefined) result.rot = rot;

  const upright = boolAttr(bodyPr, 'upright');
  if (upright !== undefined) result.upright = upright;

  // Auto-fit
  if (child(bodyPr, 'a:noAutofit')) {
    result.autoFit = { type: 'none' };
  } else if (child(bodyPr, 'a:spAutoFit')) {
    result.autoFit = { type: 'shapeAutoFit' };
  } else {
    const normAutofit = child(bodyPr, 'a:normAutofit');
    if (normAutofit) {
      result.autoFit = {
        type: 'normalAutoFit',
        fontScale: numAttr(normAutofit, 'fontScale'),
        lineSpaceReduction: numAttr(normAutofit, 'lnSpcReduction'),
      };
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Parse a Paragraph from an a:p element.
 */
function parseParagraph(pNode: XmlNode): Paragraph {
  const runs: TextRun[] = [];

  // Parse text runs (a:r)
  for (const rNode of children(pNode, 'a:r')) {
    const text = textContent(child(rNode, 'a:t')) ?? '';
    const rPr = child(rNode, 'a:rPr');
    runs.push({
      text,
      properties: rPr ? parseTextRunProperties(rPr) : undefined,
    });
  }

  // Parse paragraph properties
  const pPr = child(pNode, 'a:pPr');
  const properties = pPr ? parseParagraphProperties(pPr) : undefined;

  return { runs, properties };
}

/**
 * Parse ParagraphProperties from a:pPr element.
 */
function parseParagraphProperties(pPr: XmlNode): ParagraphProperties | undefined {
  const result: ParagraphProperties = {};

  const algn = attr(pPr, 'algn');
  if (algn && VALID_ALIGNMENT.has(algn))
    result.alignment = algn as ParagraphProperties['alignment'];

  const lvl = numAttr(pPr, 'lvl');
  if (lvl !== undefined) result.level = lvl;

  const marL = numAttr(pPr, 'marL');
  if (marL !== undefined) result.marL = marL;

  const marR = numAttr(pPr, 'marR');
  if (marR !== undefined) result.marR = marR;

  const indent = numAttr(pPr, 'indent');
  if (indent !== undefined) result.indent = indent;

  // Line spacing
  const lnSpc = child(pPr, 'a:lnSpc');
  if (lnSpc) result.lineSpacing = parseSpacingValue(lnSpc);

  // Space before/after
  const spcBef = child(pPr, 'a:spcBef');
  if (spcBef) result.spaceBefore = parseSpacingValue(spcBef);

  const spcAft = child(pPr, 'a:spcAft');
  if (spcAft) result.spaceAfter = parseSpacingValue(spcAft);

  // Default run properties
  const defRPr = child(pPr, 'a:defRPr');
  if (defRPr) result.defaultRunProperties = parseTextRunProperties(defRPr);

  // Bullet properties
  const bullet = parseBulletProperties(pPr);
  if (bullet) result.bullet = bullet;

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Parse SpacingValue from a:lnSpc, a:spcBef, or a:spcAft element.
 */
function parseSpacingValue(spacingNode: XmlNode): SpacingValue | undefined {
  const spcPct = child(spacingNode, 'a:spcPct');
  if (spcPct) {
    return { type: 'percent', value: numAttr(spcPct, 'val') ?? 0 };
  }

  const spcPts = child(spacingNode, 'a:spcPts');
  if (spcPts) {
    return { type: 'points', value: numAttr(spcPts, 'val') ?? 0 };
  }

  return undefined;
}

/**
 * Parse BulletProperties from an a:pPr element.
 */
function parseBulletProperties(pPr: XmlNode): BulletProperties | undefined {
  // No bullet
  if (child(pPr, 'a:buNone')) {
    return { type: 'none' };
  }

  // Character bullet
  const buChar = child(pPr, 'a:buChar');
  if (buChar) {
    return {
      type: 'char',
      char: attr(buChar, 'char'),
      sizePercent: numAttr(child(pPr, 'a:buSzPct'), 'val'),
      color: parseBulletColor(pPr),
      font: attr(child(pPr, 'a:buFont'), 'typeface'),
    };
  }

  // Auto-numbering bullet
  const buAutoNum = child(pPr, 'a:buAutoNum');
  if (buAutoNum) {
    return {
      type: 'autoNum',
      autoNumType: attr(buAutoNum, 'type'),
      startAt: numAttr(buAutoNum, 'startAt'),
      sizePercent: numAttr(child(pPr, 'a:buSzPct'), 'val'),
      color: parseBulletColor(pPr),
      font: attr(child(pPr, 'a:buFont'), 'typeface'),
    };
  }

  // Blip bullet
  if (child(pPr, 'a:buBlip')) {
    return { type: 'blip' };
  }

  return undefined;
}

/**
 * Parse bullet color from a:buClr element.
 */
function parseBulletColor(pPr: XmlNode): DmlColorValue | undefined {
  const buClr = child(pPr, 'a:buClr');
  if (!buClr) return undefined;
  return parseDmlColor(buClr);
}

/**
 * Parse TextRunProperties from a:rPr or a:defRPr element.
 */
function parseTextRunProperties(rPr: XmlNode): TextRunProperties | undefined {
  const result: TextRunProperties = {};

  const b = boolAttr(rPr, 'b');
  if (b !== undefined) result.bold = b;

  const i = boolAttr(rPr, 'i');
  if (i !== undefined) result.italic = i;

  const u = attr(rPr, 'u');
  if (u && VALID_UNDERLINE.has(u)) result.underline = u as TextUnderlineType;

  const strike = attr(rPr, 'strike');
  if (strike && VALID_STRIKETHROUGH.has(strike))
    result.strikethrough = strike as TextRunProperties['strikethrough'];

  const sz = numAttr(rPr, 'sz');
  if (sz !== undefined) result.fontSize = sz;

  const spc = numAttr(rPr, 'spc');
  if (spc !== undefined) result.spacing = spc;

  const baseline = numAttr(rPr, 'baseline');
  if (baseline !== undefined) result.baseline = baseline;

  const capVal = attr(rPr, 'cap');
  if (capVal && VALID_CAP.has(capVal)) result.cap = capVal as TextRunProperties['cap'];

  const lang = attr(rPr, 'lang');
  if (lang) result.lang = lang;

  // Font families
  const latin = child(rPr, 'a:latin');
  if (latin) result.fontFamily = attr(latin, 'typeface');

  const ea = child(rPr, 'a:ea');
  if (ea) result.fontFamilyEastAsian = attr(ea, 'typeface');

  const cs = child(rPr, 'a:cs');
  if (cs) result.fontFamilyComplexScript = attr(cs, 'typeface');

  // Color
  const solidFill = child(rPr, 'a:solidFill');
  if (solidFill) {
    result.color = parseDmlColor(solidFill);
  }

  // Hyperlink
  const hlinkClick = child(rPr, 'a:hlinkClick');
  if (hlinkClick) {
    result.hyperlink = parseHyperlink(hlinkClick);
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Parse HyperlinkInfo from a:hlinkClick element.
 */
function parseHyperlink(hlinkClick: XmlNode): HyperlinkInfo {
  return {
    target: attr(hlinkClick, 'r:id') ?? attr(hlinkClick, 'id') ?? '',
    newWindow: boolAttr(hlinkClick, 'newWindow'),
    tooltip: attr(hlinkClick, 'tooltip'),
  };
}

// =============================================================================
// Enum Validation Helpers
// =============================================================================

/**
 * Validate a string value against a known set of valid values.
 * Returns the value cast to type T if valid, or the defaultValue if invalid.
 *
 * @param value - The string to validate
 * @param validSet - Set of known valid values
 * @param defaultValue - Fallback when the value is not in the valid set
 * @returns The validated value or default
 */
export function validateEnum<T extends string>(
  value: string | undefined,
  validSet: ReadonlySet<string>,
  defaultValue: T,
): T {
  if (value === undefined) return defaultValue;
  return validSet.has(value) ? (value as T) : defaultValue;
}

// --- DrawingML line/arrow/text enum valid value sets ---

const VALID_LINE_CAPS = new Set<string>(['flat', 'rnd', 'sq']);
const VALID_LINE_COMPOUNDS = new Set<string>(['sng', 'dbl', 'thickThin', 'thinThick', 'tri']);
const VALID_DASH_STYLES = new Set<string>([
  'solid',
  'dot',
  'dash',
  'lgDash',
  'dashDot',
  'lgDashDot',
  'lgDashDotDot',
  'sysDash',
  'sysDot',
  'sysDashDot',
  'sysDashDotDot',
]);
const VALID_ARROW_TYPES = new Set<string>([
  'none',
  'triangle',
  'stealth',
  'diamond',
  'oval',
  'arrow',
]);
const VALID_ARROW_SIZES = new Set<string>(['sm', 'med', 'lg']);
const VALID_TEXT_ANCHORS = new Set<string>(['t', 'ctr', 'b', 'just', 'dist']);
const VALID_OVERFLOW = new Set<string>(['overflow', 'clip']);
const VALID_VERT_OVERFLOW = new Set<string>(['overflow', 'clip', 'ellipsis']);
const VALID_WRAP = new Set<string>(['none', 'square']);
const VALID_ALIGNMENT = new Set<string>(['l', 'ctr', 'r', 'just', 'justLow', 'dist', 'thaiDist']);
const VALID_UNDERLINE = new Set<string>([
  'none',
  'sng',
  'dbl',
  'heavy',
  'dotted',
  'dottedHeavy',
  'dash',
  'dashHeavy',
  'dashLong',
  'dashLongHeavy',
  'dotDash',
  'dotDashHeavy',
  'dotDotDash',
  'dotDotDashHeavy',
  'wavy',
  'wavyHeavy',
  'wavyDbl',
  'words',
]);
const VALID_STRIKETHROUGH = new Set<string>(['noStrike', 'sngStrike', 'dblStrike']);
const VALID_CAP = new Set<string>(['none', 'small', 'all']);

// =============================================================================
// Category List Parsing (shared across colors/style/layout definitions)
// =============================================================================

/**
 * Parse a dgm:catLst element into an array of { type, pri } categories.
 *
 * This pattern is shared across colors definitions, style definitions, and
 * layout definitions, all of which contain a `dgm:catLst` with `dgm:cat`
 * children.
 *
 * @param catLst - The parsed dgm:catLst node
 * @returns Array of categories with type and priority
 */
export function parseCatLst(
  catLst: XmlNode | undefined | null,
): Array<{ type: string; pri: number }> {
  if (!catLst) return [];

  const categories: Array<{ type: string; pri: number }> = [];
  for (const catNode of children(catLst, 'dgm:cat')) {
    const type = attr(catNode, 'type');
    const pri = numAttr(catNode, 'pri') ?? 0;
    if (type) {
      categories.push({ type, pri });
    }
  }
  return categories;
}
