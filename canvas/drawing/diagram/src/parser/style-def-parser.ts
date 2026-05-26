/**
 * Diagram Style Definition Parser (quickStyle#.xml)
 *
 * Parses OOXML Diagram style definition XML into strongly-typed StyleDef objects.
 * The style definition maps style label names to shape styles:
 * - Style references (line, fill, effect, font indices into theme)
 * - 3D scene settings (camera, lighting)
 * - 3D shape properties (bevel, extrusion, contour)
 * - Text properties (font size, style)
 *
 * Input: Pre-parsed XML object (from fast-xml-parser / WASM XML bridge format)
 * Output: StyleDef interface from @mog-sdk/contracts
 *
 * @see ECMA-376 Part 1, Section 21.4.8 (Style Definition)
 */

import type {
  BevelPresetType,
  LightRigDirection,
  LightRigType,
  PresetCameraType,
  PresetMaterialType,
} from '@mog-sdk/contracts/drawing/three-d';
import type {
  Scene3D,
  SchemeColor,
  ShapeProperties3D,
  StyleDef,
  StyleLabelStyle,
  StyleReference,
  TextProperties,
} from '@mog-sdk/contracts/diagram';
import { parseCatLst, parseSchemeColor } from './drawingml-helpers';
import type { XmlNode } from './xml-helpers';
import { attr, boolAttr, child, children, numAttr } from './xml-helpers';

// =============================================================================
// Main Parse Function
// =============================================================================

/**
 * Parse a Diagram style definition from a pre-parsed XML object.
 *
 * @param xml - Pre-parsed XML object
 * @returns Parsed StyleDef
 */
export function parseStyleDef(xml: XmlNode): StyleDef {
  // Navigate to the styleDef element
  const styleDef = child(xml, 'dgm:styleDef') ?? xml;

  const uniqueId = attr(styleDef, 'uniqueId') ?? '';

  // Parse title and description
  const titleElem = child(styleDef, 'dgm:title');
  const title = titleElem ? (attr(titleElem, 'val') ?? '') : '';

  const descElem = child(styleDef, 'dgm:desc');
  const desc = descElem ? (attr(descElem, 'val') ?? '') : '';

  // Parse categories
  const categories = parseCatLst(child(styleDef, 'dgm:catLst'));

  // Parse top-level scene3d
  const scene3dNode = child(styleDef, 'dgm:scene3d');
  const scene3d = scene3dNode ? parseScene3D(scene3dNode) : undefined;

  // Parse style labels
  const styleLabelMap = new Map<string, StyleLabelStyle>();
  for (const styleLblNode of children(styleDef, 'dgm:styleLbl')) {
    const styleLabel = parseStyleLabelStyle(styleLblNode);
    if (styleLabel) {
      styleLabelMap.set(styleLabel.name, styleLabel);
    }
  }

  return {
    uniqueId,
    title,
    desc,
    categories,
    scene3d,
    styleLabelMap,
  };
}

// =============================================================================
// Scene3D Parsing
// =============================================================================

/**
 * Parse a scene3d element (dgm:scene3d or a:scene3d).
 */
export function parseScene3D(scene3dNode: XmlNode | undefined): Scene3D | undefined {
  if (!scene3dNode) return undefined;

  // Parse camera
  const cameraNode = child(scene3dNode, 'a:camera');
  if (!cameraNode) return undefined;

  const prst = (attr(cameraNode, 'prst') ?? 'orthographicFront') as PresetCameraType;
  const fov = numAttr(cameraNode, 'fov');
  const rotNode = child(cameraNode, 'a:rot');
  const rot = rotNode
    ? {
        lat: numAttr(rotNode, 'lat') ?? 0,
        lon: numAttr(rotNode, 'lon') ?? 0,
        rev: numAttr(rotNode, 'rev') ?? 0,
      }
    : undefined;

  // Parse light rig
  const lightRigNode = child(scene3dNode, 'a:lightRig');
  if (!lightRigNode) return undefined;

  const rig = (attr(lightRigNode, 'rig') ?? 'threePt') as LightRigType;
  const dir = (attr(lightRigNode, 'dir') ?? 't') as LightRigDirection;

  return {
    camera: {
      prst,
      fov,
      rot,
    },
    lightRig: {
      rig,
      dir,
    },
  };
}

// =============================================================================
// ShapeProperties3D Parsing
// =============================================================================

/**
 * Parse 3D shape properties from a:sp3d element.
 */
function parseSp3d(sp3dNode: XmlNode | undefined): ShapeProperties3D | undefined {
  if (!sp3dNode) return undefined;

  const result: ShapeProperties3D = {};

  // Parse bevels
  const bevelT = child(sp3dNode, 'a:bevelT');
  if (bevelT) {
    result.bevelT = {
      w: numAttr(bevelT, 'w') ?? 0,
      h: numAttr(bevelT, 'h') ?? 0,
      prst: (attr(bevelT, 'prst') ?? 'circle') as BevelPresetType,
    };
  }

  const bevelB = child(sp3dNode, 'a:bevelB');
  if (bevelB) {
    result.bevelB = {
      w: numAttr(bevelB, 'w') ?? 0,
      h: numAttr(bevelB, 'h') ?? 0,
      prst: (attr(bevelB, 'prst') ?? 'circle') as BevelPresetType,
    };
  }

  // Parse extrusion color
  const extrusionClr = child(sp3dNode, 'a:extrusionClr');
  if (extrusionClr) {
    result.extrusionClr = parseSchemeColor(extrusionClr);
  }

  // Parse contour color
  const contourClr = child(sp3dNode, 'a:contourClr');
  if (contourClr) {
    result.contourClr = parseSchemeColor(contourClr);
  }

  // Parse extrusion height and contour width
  const extrusionH = numAttr(sp3dNode, 'extrusionH');
  if (extrusionH !== undefined) result.extrusionH = extrusionH;

  const contourW = numAttr(sp3dNode, 'contourW');
  if (contourW !== undefined) result.contourW = contourW;

  // Parse material
  const prstMaterial = attr(sp3dNode, 'prstMaterial');
  if (prstMaterial) result.prstMaterial = prstMaterial as PresetMaterialType;

  return Object.keys(result).length > 0 ? result : undefined;
}

// =============================================================================
// Text Properties Parsing
// =============================================================================

/**
 * Parse text properties from dgm:txPr element.
 */
function parseTextProperties(txPrNode: XmlNode | undefined): TextProperties | undefined {
  if (!txPrNode) return undefined;

  const result: TextProperties = {};

  // Parse body properties
  const bodyPr = child(txPrNode, 'a:bodyPr');
  if (bodyPr) {
    result.bodyPr = {
      anchor: attr(bodyPr, 'anchor'),
      horzOverflow: attr(bodyPr, 'horzOverflow'),
      vertOverflow: attr(bodyPr, 'vertOverflow'),
    };
  }

  // Parse default run properties from a:p/a:pPr/a:defRPr
  // or from a:lstStyle/a:defPPr/a:defRPr
  const pNode = child(txPrNode, 'a:p');
  if (pNode) {
    const pPr = child(pNode, 'a:pPr');
    if (pPr) {
      const defRPr = child(pPr, 'a:defRPr');
      if (defRPr) {
        result.defRPr = {
          sz: numAttr(defRPr, 'sz'),
          b: boolAttr(defRPr, 'b'),
          i: boolAttr(defRPr, 'i'),
          latin: attr(child(defRPr, 'a:latin'), 'typeface'),
        };
      }
    }
  }

  // Also try lstStyle path
  const lstStyle = child(txPrNode, 'a:lstStyle');
  if (lstStyle && !result.defRPr) {
    const defPPr = child(lstStyle, 'a:defPPr');
    if (defPPr) {
      const defRPr = child(defPPr, 'a:defRPr');
      if (defRPr) {
        result.defRPr = {
          sz: numAttr(defRPr, 'sz'),
          b: boolAttr(defRPr, 'b'),
          i: boolAttr(defRPr, 'i'),
          latin: attr(child(defRPr, 'a:latin'), 'typeface'),
        };
      }
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

// =============================================================================
// Style Label Style Parsing
// =============================================================================

/**
 * Parse a dgm:styleLbl element into StyleLabelStyle.
 */
function parseStyleLabelStyle(styleLblNode: XmlNode): StyleLabelStyle | null {
  const name = attr(styleLblNode, 'name');
  if (!name) return null;

  // Parse style references
  const style = parseStyleReference(styleLblNode);

  // Parse optional per-label scene3d
  const scene3dNode = child(styleLblNode, 'dgm:scene3d') ?? child(styleLblNode, 'a:scene3d');
  const scene3d = scene3dNode ? parseScene3D(scene3dNode) : undefined;

  // Parse optional sp3d
  const sp3dNode = child(styleLblNode, 'a:sp3d');
  const sp3d = sp3dNode ? parseSp3d(sp3dNode) : undefined;

  // Parse optional text properties
  const txPrNode = child(styleLblNode, 'dgm:txPr');
  const txPr = txPrNode ? parseTextProperties(txPrNode) : undefined;

  return {
    name,
    scene3d,
    sp3d,
    txPr,
    style,
  };
}

// =============================================================================
// Style Reference Parsing
// =============================================================================

/**
 * Parse style references (lnRef, fillRef, effectRef, fontRef) from a style label element.
 */
function parseStyleReference(styleLblNode: XmlNode): StyleReference {
  return {
    lnRef: parseThemeRef(child(styleLblNode, 'dgm:lnRef') ?? child(styleLblNode, 'a:lnRef')),
    fillRef: parseThemeRef(child(styleLblNode, 'dgm:fillRef') ?? child(styleLblNode, 'a:fillRef')),
    effectRef: parseThemeRef(
      child(styleLblNode, 'dgm:effectRef') ?? child(styleLblNode, 'a:effectRef'),
    ),
    fontRef: parseFontRef(child(styleLblNode, 'dgm:fontRef') ?? child(styleLblNode, 'a:fontRef')),
  };
}

/**
 * Parse a theme style reference (lnRef, fillRef, effectRef).
 */
function parseThemeRef(refNode: XmlNode | undefined): { idx: number; schemeClr?: SchemeColor } {
  if (!refNode) {
    return { idx: 0 };
  }

  const idx = numAttr(refNode, 'idx') ?? 0;
  const schemeClr = parseSchemeColor(refNode);

  return { idx, schemeClr };
}

/**
 * Parse a font style reference.
 */
function parseFontRef(refNode: XmlNode | undefined): { idx: string; schemeClr?: SchemeColor } {
  if (!refNode) {
    return { idx: 'none' };
  }

  const idx = attr(refNode, 'idx') ?? 'none';
  const schemeClr = parseSchemeColor(refNode);

  return { idx, schemeClr };
}
