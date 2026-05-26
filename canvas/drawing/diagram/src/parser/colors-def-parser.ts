/**
 * Diagram Colors Definition Parser (colors#.xml)
 *
 * Parses OOXML Diagram colors definition XML into strongly-typed ColorsDef objects.
 * The colors definition maps style label names to color lists for:
 * - Fill colors (shape background)
 * - Line colors (shape outline)
 * - Effect colors (shadow, glow, etc.)
 * - Text fill colors
 * - Text line colors
 * - Text effect colors
 *
 * Each color list contains scheme colors with optional transforms and a
 * distribution method (repeat or span).
 *
 * Input: Pre-parsed XML object (from fast-xml-parser / WASM XML bridge format)
 * Output: ColorsDef interface from @mog-sdk/contracts
 *
 * @see ECMA-376 Part 1, Section 21.4.7 (Colors Definition)
 */

import type {
  ColorList,
  ColorsDef,
  SchemeColor,
  StyleLabelColors,
} from '@mog-sdk/contracts/diagram';
import { parseCatLst, parseSchemeColor, parseStyleColorTransforms } from './drawingml-helpers';
import type { XmlNode } from './xml-helpers';
import { attr, child, children } from './xml-helpers';

// =============================================================================
// Main Parse Function
// =============================================================================

/**
 * Parse a Diagram colors definition from a pre-parsed XML object.
 *
 * @param xml - Pre-parsed XML object
 * @returns Parsed ColorsDef
 */
export function parseColorsDef(xml: XmlNode): ColorsDef {
  // Navigate to the colorsDef element
  const colorsDef = child(xml, 'dgm:colorsDef') ?? xml;

  const uniqueId = attr(colorsDef, 'uniqueId') ?? '';

  // Parse title and description
  const titleElem = child(colorsDef, 'dgm:title');
  const title = titleElem ? (attr(titleElem, 'val') ?? '') : '';

  const descElem = child(colorsDef, 'dgm:desc');
  const desc = descElem ? (attr(descElem, 'val') ?? '') : '';

  // Parse categories
  const categories = parseCatLst(child(colorsDef, 'dgm:catLst'));

  // Parse style labels into a map
  const styleLabelMap = new Map<string, StyleLabelColors>();
  for (const styleLblNode of children(colorsDef, 'dgm:styleLbl')) {
    const styleLblColors = parseStyleLabelColors(styleLblNode);
    if (styleLblColors) {
      styleLabelMap.set(styleLblColors.name, styleLblColors);
    }
  }

  return {
    uniqueId,
    title,
    desc,
    categories,
    styleLabelMap,
  };
}

// =============================================================================
// Style Label Colors Parsing
// =============================================================================

/**
 * Parse a dgm:styleLbl element into StyleLabelColors.
 */
function parseStyleLabelColors(styleLblNode: XmlNode): StyleLabelColors | null {
  const name = attr(styleLblNode, 'name');
  if (!name) return null;

  return {
    name,
    fillClrLst: parseColorList(child(styleLblNode, 'dgm:fillClrLst')),
    linClrLst: parseColorList(child(styleLblNode, 'dgm:linClrLst')),
    effectClrLst: parseColorList(child(styleLblNode, 'dgm:effectClrLst')),
    txLinClrLst: parseColorList(child(styleLblNode, 'dgm:txLinClrLst')),
    txFillClrLst: parseColorList(child(styleLblNode, 'dgm:txFillClrLst')),
    txEffectClrLst: parseColorList(child(styleLblNode, 'dgm:txEffectClrLst')),
  };
}

// =============================================================================
// Color List Parsing
// =============================================================================

/**
 * Parse a color list element (dgm:fillClrLst, dgm:linClrLst, etc.).
 * Color lists contain a method attribute and one or more a:schemeClr children.
 */
function parseColorList(clrLstNode: XmlNode | undefined): ColorList {
  if (!clrLstNode) {
    return { method: 'repeat', colors: [] };
  }

  const VALID_METHODS = new Set<string>(['repeat', 'span']);
  const methodStr = attr(clrLstNode, 'meth') ?? 'repeat';
  const method: 'repeat' | 'span' = VALID_METHODS.has(methodStr)
    ? (methodStr as 'repeat' | 'span')
    : 'repeat';

  const colors: SchemeColor[] = [];

  // Parse a:schemeClr children
  for (const schemeClrNode of children(clrLstNode, 'a:schemeClr')) {
    const val = attr(schemeClrNode, 'val');
    if (val) {
      const transforms = parseStyleColorTransforms(schemeClrNode);
      colors.push({
        val,
        transforms: transforms.length > 0 ? transforms : undefined,
      });
    }
  }

  // Parse a:srgbClr children — OOXML color lists can contain any DrawingML
  // color type. We represent sRGB colors as SchemeColor entries with the hex
  // value stored in `val` so downstream code can detect them (hex strings
  // like "FF0000" vs scheme names like "accent1").
  // NOTE: Other color types (a:sysClr, a:prstClr, a:hslClr, a:scrgbClr)
  // are not yet handled and will be silently dropped.
  for (const srgbClrNode of children(clrLstNode, 'a:srgbClr')) {
    const val = attr(srgbClrNode, 'val');
    if (val) {
      const transforms = parseStyleColorTransforms(srgbClrNode);
      colors.push({
        val,
        transforms: transforms.length > 0 ? transforms : undefined,
      });
    }
  }

  // Also try wrapping element - some parsers may nest differently
  // Check for scheme colors at top level of the list node
  if (colors.length === 0) {
    const schemeClr = parseSchemeColor(clrLstNode);
    if (schemeClr) {
      colors.push(schemeClr);
    }
  }

  return { method, colors };
}
