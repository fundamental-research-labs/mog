/**
 * Unit tests for drawingml-helpers.ts
 *
 * Tests the shared DrawingML parsing helpers:
 * parseCatLst, parseSchemeColor, parseDmlColor, parseFill, parseLineProperties,
 * parseShapeProperties, parseRichText, parseEffectList, validateEnum,
 * parseStyleColorTransforms, parseShapeTransform
 */

import {
  parseCatLst,
  parseDmlColor,
  parseEffectList,
  parseFill,
  parseLineProperties,
  parseRichText,
  parseSchemeColor,
  parseShapeProperties,
  parseShapeTransform,
  parseStyleColorTransforms,
  validateEnum,
} from '../../src/parser/drawingml-helpers';
import type { XmlNode } from '../../src/parser/xml-helpers';

// =============================================================================
// parseCatLst()
// =============================================================================

describe('parseCatLst', () => {
  it('should parse categories with type and priority', () => {
    const catLst: XmlNode = {
      'dgm:cat': [
        { '@_type': 'urn:microsoft.com/office/list', '@_pri': 10100 },
        { '@_type': 'urn:microsoft.com/office/process', '@_pri': 10200 },
      ],
    };
    const result = parseCatLst(catLst);
    expect(result).toEqual([
      { type: 'urn:microsoft.com/office/list', pri: 10100 },
      { type: 'urn:microsoft.com/office/process', pri: 10200 },
    ]);
  });

  it('should return empty array for null input', () => {
    expect(parseCatLst(null)).toEqual([]);
  });

  it('should return empty array for undefined input', () => {
    expect(parseCatLst(undefined)).toEqual([]);
  });

  it('should return empty array for empty catLst', () => {
    expect(parseCatLst({})).toEqual([]);
  });

  it('should default priority to 0 when missing', () => {
    const catLst: XmlNode = {
      'dgm:cat': { '@_type': 'test' },
    };
    const result = parseCatLst(catLst);
    expect(result).toEqual([{ type: 'test', pri: 0 }]);
  });

  it('should skip categories without type', () => {
    const catLst: XmlNode = {
      'dgm:cat': [
        { '@_type': 'valid', '@_pri': 1 },
        { '@_pri': 2 }, // no type
      ],
    };
    const result = parseCatLst(catLst);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('valid');
  });

  it('should handle single category (non-array)', () => {
    const catLst: XmlNode = {
      'dgm:cat': { '@_type': 'single', '@_pri': 5 },
    };
    const result = parseCatLst(catLst);
    expect(result).toEqual([{ type: 'single', pri: 5 }]);
  });
});

// =============================================================================
// validateEnum()
// =============================================================================

describe('validateEnum', () => {
  const validSet = new Set<string>(['apple', 'banana', 'cherry']);

  it('should return value when it is in the valid set', () => {
    expect(validateEnum('apple', validSet, 'banana')).toBe('apple');
  });

  it('should return default when value is not in the valid set', () => {
    expect(validateEnum('durian', validSet, 'banana')).toBe('banana');
  });

  it('should return default when value is undefined', () => {
    expect(validateEnum(undefined, validSet, 'cherry')).toBe('cherry');
  });

  it('should handle empty string as a valid or invalid value', () => {
    const setWithEmpty = new Set<string>(['', 'a']);
    expect(validateEnum('', setWithEmpty, 'a')).toBe('');
  });

  it('should handle empty string as invalid when not in set', () => {
    expect(validateEnum('', validSet, 'apple')).toBe('apple');
  });
});

// =============================================================================
// parseSchemeColor()
// =============================================================================

describe('parseSchemeColor', () => {
  it('should parse a scheme color with val', () => {
    const node: XmlNode = {
      'a:schemeClr': { '@_val': 'accent1' },
    };
    const result = parseSchemeColor(node);
    expect(result).toEqual({ val: 'accent1', transforms: undefined });
  });

  it('should parse scheme color with transforms', () => {
    const node: XmlNode = {
      'a:schemeClr': {
        '@_val': 'accent1',
        'a:lumMod': { '@_val': 60000 },
        'a:lumOff': { '@_val': 40000 },
      },
    };
    const result = parseSchemeColor(node);
    expect(result).toBeDefined();
    expect(result!.val).toBe('accent1');
    expect(result!.transforms).toHaveLength(2);
    expect(result!.transforms![0]).toEqual({ type: 'lumMod', val: 60000 });
    expect(result!.transforms![1]).toEqual({ type: 'lumOff', val: 40000 });
  });

  it('should return undefined for null node', () => {
    expect(parseSchemeColor(null)).toBeUndefined();
  });

  it('should return undefined when no schemeClr child', () => {
    expect(parseSchemeColor({})).toBeUndefined();
  });

  it('should return undefined when schemeClr has no val', () => {
    const node: XmlNode = { 'a:schemeClr': {} };
    expect(parseSchemeColor(node)).toBeUndefined();
  });
});

// =============================================================================
// parseStyleColorTransforms()
// =============================================================================

describe('parseStyleColorTransforms', () => {
  it('should parse color transforms in document order', () => {
    const schemeClrNode: XmlNode = {
      '@_val': 'accent1',
      'a:shade': { '@_val': 80000 },
      'a:tint': { '@_val': 50000 },
    };
    const result = parseStyleColorTransforms(schemeClrNode);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('shade');
    expect(result[1].type).toBe('tint');
  });

  it('should return empty array for no transforms', () => {
    const schemeClrNode: XmlNode = { '@_val': 'accent1' };
    const result = parseStyleColorTransforms(schemeClrNode);
    expect(result).toEqual([]);
  });

  it('should handle transforms without prefix', () => {
    const schemeClrNode: XmlNode = {
      '@_val': 'accent1',
      lumMod: { '@_val': 75000 },
    };
    const result = parseStyleColorTransforms(schemeClrNode);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('lumMod');
  });

  it('should deduplicate prefixed and non-prefixed variants', () => {
    const schemeClrNode: XmlNode = {
      '@_val': 'accent1',
      'a:tint': { '@_val': 50000 },
      tint: { '@_val': 60000 }, // duplicate - should be skipped
    };
    const result = parseStyleColorTransforms(schemeClrNode);
    expect(result).toHaveLength(1);
    expect(result[0].val).toBe(50000);
  });
});

// =============================================================================
// parseDmlColor()
// =============================================================================

describe('parseDmlColor', () => {
  it('should parse scheme color', () => {
    const node: XmlNode = {
      'a:schemeClr': { '@_val': 'accent1' },
    };
    const result = parseDmlColor(node);
    expect(result).toBeDefined();
    expect(result!.type).toBe('scheme');
    expect(result!.value).toBe('accent1');
  });

  it('should parse sRGB color', () => {
    const node: XmlNode = {
      'a:srgbClr': { '@_val': 'FF0000' },
    };
    const result = parseDmlColor(node);
    expect(result).toBeDefined();
    expect(result!.type).toBe('srgb');
    expect(result!.value).toBe('FF0000');
  });

  it('should parse system color with lastColor', () => {
    const node: XmlNode = {
      'a:sysClr': { '@_val': 'windowText', '@_lastClr': '000000' },
    };
    const result = parseDmlColor(node);
    expect(result).toBeDefined();
    expect(result!.type).toBe('system');
    expect(result!.value).toBe('windowText');
    expect((result as any).lastColor).toBe('000000');
  });

  it('should parse preset color', () => {
    const node: XmlNode = {
      'a:prstClr': { '@_val': 'red' },
    };
    const result = parseDmlColor(node);
    expect(result).toBeDefined();
    expect(result!.type).toBe('preset');
    expect(result!.value).toBe('red');
  });

  it('should return undefined for null node', () => {
    expect(parseDmlColor(null)).toBeUndefined();
  });

  it('should return undefined for empty node', () => {
    expect(parseDmlColor({})).toBeUndefined();
  });

  it('should parse color with transforms', () => {
    const node: XmlNode = {
      'a:schemeClr': {
        '@_val': 'dk1',
        'a:alpha': { '@_val': 50000 },
      },
    };
    const result = parseDmlColor(node);
    expect(result!.transforms).toBeDefined();
    expect(result!.transforms).toHaveLength(1);
    expect(result!.transforms![0].type).toBe('alpha');
  });

  it('should prioritize scheme color over other types', () => {
    const node: XmlNode = {
      'a:schemeClr': { '@_val': 'accent1' },
      'a:srgbClr': { '@_val': 'FF0000' },
    };
    const result = parseDmlColor(node);
    expect(result!.type).toBe('scheme');
  });
});

// =============================================================================
// parseFill()
// =============================================================================

describe('parseFill', () => {
  it('should parse noFill', () => {
    const node: XmlNode = { 'a:noFill': {} };
    const result = parseFill(node);
    expect(result).toEqual({ type: 'none' });
  });

  it('should parse solidFill', () => {
    const node: XmlNode = {
      'a:solidFill': {
        'a:srgbClr': { '@_val': 'FF0000' },
      },
    };
    const result = parseFill(node);
    expect(result).toBeDefined();
    expect(result!.type).toBe('solid');
  });

  it('should parse gradientFill with stops', () => {
    const node: XmlNode = {
      'a:gradFill': {
        'a:gsLst': {
          'a:gs': [
            { '@_pos': 0, 'a:srgbClr': { '@_val': 'FF0000' } },
            { '@_pos': 100000, 'a:srgbClr': { '@_val': '0000FF' } },
          ],
        },
        'a:lin': { '@_ang': 5400000, '@_scaled': true },
      },
    };
    const result = parseFill(node);
    expect(result).toBeDefined();
    expect(result!.type).toBe('gradient');
    if (result && result.type === 'gradient') {
      expect(result.stops).toHaveLength(2);
      expect(result.linear).toBeDefined();
      expect(result.linear!.angle).toBe(5400000);
    }
  });

  it('should parse patternFill', () => {
    const node: XmlNode = {
      'a:pattFill': {
        '@_prst': 'dkDnDiag',
        'a:fgClr': { 'a:srgbClr': { '@_val': 'FF0000' } },
        'a:bgClr': { 'a:srgbClr': { '@_val': '0000FF' } },
      },
    };
    const result = parseFill(node);
    expect(result!.type).toBe('pattern');
  });

  it('should parse blipFill', () => {
    const node: XmlNode = {
      'a:blipFill': {
        'a:blip': { '@_r:embed': 'rId1' },
        'a:stretch': {},
      },
    };
    const result = parseFill(node);
    expect(result).toBeDefined();
    expect(result!.type).toBe('blip');
    if (result && result.type === 'blip') {
      expect(result.stretch).toBe(true);
    }
  });

  it('should return undefined for null node', () => {
    expect(parseFill(null)).toBeUndefined();
  });

  it('should return undefined for empty node', () => {
    expect(parseFill({})).toBeUndefined();
  });
});

// =============================================================================
// parseLineProperties()
// =============================================================================

describe('parseLineProperties', () => {
  it('should parse line width', () => {
    const ln: XmlNode = { '@_w': 12700 };
    const result = parseLineProperties(ln);
    expect(result).toBeDefined();
    expect(result!.width).toBe(12700);
  });

  it('should parse line with cap and compound', () => {
    const ln: XmlNode = { '@_w': 9525, '@_cap': 'rnd', '@_cmpd': 'dbl' };
    const result = parseLineProperties(ln);
    expect(result!.cap).toBe('rnd');
    expect(result!.compound).toBe('dbl');
  });

  it('should reject invalid cap values', () => {
    const ln: XmlNode = { '@_w': 9525, '@_cap': 'invalid' };
    const result = parseLineProperties(ln);
    expect(result!.cap).toBeUndefined();
  });

  it('should reject invalid compound values', () => {
    const ln: XmlNode = { '@_w': 9525, '@_cmpd': 'invalid' };
    const result = parseLineProperties(ln);
    expect(result!.compound).toBeUndefined();
  });

  it('should parse dash style', () => {
    const ln: XmlNode = {
      '@_w': 9525,
      'a:prstDash': { '@_val': 'dash' },
    };
    const result = parseLineProperties(ln);
    expect(result!.dash).toBe('dash');
  });

  it('should reject invalid dash style', () => {
    const ln: XmlNode = {
      '@_w': 9525,
      'a:prstDash': { '@_val': 'invalid' },
    };
    const result = parseLineProperties(ln);
    expect(result!.dash).toBeUndefined();
  });

  it('should parse join types', () => {
    const ln: XmlNode = { '@_w': 9525, 'a:round': {} };
    expect(parseLineProperties(ln)!.join).toBe('round');

    const ln2: XmlNode = { '@_w': 9525, 'a:bevel': {} };
    expect(parseLineProperties(ln2)!.join).toBe('bevel');

    const ln3: XmlNode = { '@_w': 9525, 'a:miter': {} };
    expect(parseLineProperties(ln3)!.join).toBe('miter');
  });

  it('should return undefined for null input', () => {
    expect(parseLineProperties(null)).toBeUndefined();
  });

  it('should return undefined for empty line element', () => {
    expect(parseLineProperties({})).toBeUndefined();
  });
});

// =============================================================================
// parseShapeTransform()
// =============================================================================

describe('parseShapeTransform', () => {
  it('should parse offset and extent', () => {
    const xfrm: XmlNode = {
      'a:off': { '@_x': 100, '@_y': 200 },
      'a:ext': { '@_cx': 300, '@_cy': 400 },
    };
    const result = parseShapeTransform(xfrm);
    expect(result).toBeDefined();
    expect(result!.offset).toEqual({ x: 100, y: 200 });
    expect(result!.extent).toEqual({ cx: 300, cy: 400 });
  });

  it('should parse rotation and flip', () => {
    const xfrm: XmlNode = {
      '@_rot': 5400000,
      '@_flipH': true,
      '@_flipV': false,
      'a:off': { '@_x': 0, '@_y': 0 },
      'a:ext': { '@_cx': 100, '@_cy': 100 },
    };
    const result = parseShapeTransform(xfrm);
    expect(result!.rotation).toBe(5400000);
    expect(result!.flipH).toBe(true);
    expect(result!.flipV).toBe(false);
  });

  it('should return undefined for null input', () => {
    expect(parseShapeTransform(null)).toBeUndefined();
  });

  it('should return undefined for empty node', () => {
    expect(parseShapeTransform({})).toBeUndefined();
  });
});

// =============================================================================
// parseShapeProperties()
// =============================================================================

describe('parseShapeProperties', () => {
  it('should parse preset geometry', () => {
    const spPr: XmlNode = {
      'a:prstGeom': { '@_prst': 'roundRect' },
    };
    const result = parseShapeProperties(spPr);
    expect(result).toBeDefined();
    expect(result!.presetGeometry).toBe('roundRect');
  });

  it('should parse adjustment values', () => {
    const spPr: XmlNode = {
      'a:prstGeom': {
        '@_prst': 'roundRect',
        'a:avLst': {
          'a:gd': { '@_name': 'adj', '@_fmla': 'val 16667' },
        },
      },
    };
    const result = parseShapeProperties(spPr);
    expect(result!.adjustValues).toEqual({ adj: 16667 });
  });

  it('should return undefined for null input', () => {
    expect(parseShapeProperties(null)).toBeUndefined();
  });

  it('should return undefined for empty node', () => {
    expect(parseShapeProperties({})).toBeUndefined();
  });
});

// =============================================================================
// parseEffectList()
// =============================================================================

describe('parseEffectList', () => {
  it('should parse outer shadow', () => {
    const effectLst: XmlNode = {
      'a:outerShdw': {
        '@_blurRad': 50800,
        '@_dist': 38100,
        '@_dir': 5400000,
        'a:srgbClr': { '@_val': '000000' },
      },
    };
    const result = parseEffectList(effectLst);
    expect(result).toBeDefined();
    expect(result!.outerShadow).toBeDefined();
    expect(result!.outerShadow!.blurRadius).toBe(50800);
    expect(result!.outerShadow!.distance).toBe(38100);
  });

  it('should parse glow effect', () => {
    const effectLst: XmlNode = {
      'a:glow': {
        '@_rad': 63500,
        'a:srgbClr': { '@_val': 'FFFF00' },
      },
    };
    const result = parseEffectList(effectLst);
    expect(result!.glow).toBeDefined();
    expect(result!.glow!.radius).toBe(63500);
  });

  it('should return undefined for null input', () => {
    expect(parseEffectList(null)).toBeUndefined();
  });

  it('should return undefined for empty effect list', () => {
    expect(parseEffectList({})).toBeUndefined();
  });
});

// =============================================================================
// parseRichText()
// =============================================================================

describe('parseRichText', () => {
  it('should parse body properties and paragraphs', () => {
    const textElem: XmlNode = {
      'a:bodyPr': { '@_anchor': 'ctr' },
      'a:p': {
        'a:r': {
          'a:t': { '#text': 'Hello' },
        },
      },
    };
    const result = parseRichText(textElem);
    expect(result).toBeDefined();
    expect(result!.bodyProperties.anchor).toBe('ctr');
    expect(result!.paragraphs).toHaveLength(1);
    expect(result!.paragraphs[0].runs[0].text).toBe('Hello');
  });

  it('should parse multiple paragraphs', () => {
    const textElem: XmlNode = {
      'a:bodyPr': {},
      'a:p': [
        { 'a:r': { 'a:t': { '#text': 'First' } } },
        { 'a:r': { 'a:t': { '#text': 'Second' } } },
      ],
    };
    const result = parseRichText(textElem);
    expect(result!.paragraphs).toHaveLength(2);
  });

  it('should parse text run properties', () => {
    const textElem: XmlNode = {
      'a:bodyPr': {},
      'a:p': {
        'a:r': {
          'a:rPr': {
            '@_b': true,
            '@_i': true,
            '@_sz': 1200,
            '@_u': 'sng',
            '@_strike': 'sngStrike',
            '@_cap': 'small',
          },
          'a:t': { '#text': 'Styled' },
        },
      },
    };
    const result = parseRichText(textElem);
    const props = result!.paragraphs[0].runs[0].properties!;
    expect(props.bold).toBe(true);
    expect(props.italic).toBe(true);
    expect(props.fontSize).toBe(1200);
    expect(props.underline).toBe('sng');
    expect(props.strikethrough).toBe('sngStrike');
    expect(props.cap).toBe('small');
  });

  it('should reject invalid underline values', () => {
    const textElem: XmlNode = {
      'a:bodyPr': {},
      'a:p': {
        'a:r': {
          'a:rPr': { '@_u': 'invalidUnderline' },
          'a:t': { '#text': 'Test' },
        },
      },
    };
    const result = parseRichText(textElem);
    const props = result!.paragraphs[0].runs[0].properties;
    // Invalid underline should not be set
    expect(props?.underline).toBeUndefined();
  });

  it('should reject invalid strikethrough values', () => {
    const textElem: XmlNode = {
      'a:bodyPr': {},
      'a:p': {
        'a:r': {
          'a:rPr': { '@_strike': 'invalidStrike' },
          'a:t': { '#text': 'Test' },
        },
      },
    };
    const result = parseRichText(textElem);
    const props = result!.paragraphs[0].runs[0].properties;
    expect(props?.strikethrough).toBeUndefined();
  });

  it('should reject invalid cap values', () => {
    const textElem: XmlNode = {
      'a:bodyPr': {},
      'a:p': {
        'a:r': {
          'a:rPr': { '@_cap': 'invalidCap' },
          'a:t': { '#text': 'Test' },
        },
      },
    };
    const result = parseRichText(textElem);
    const props = result!.paragraphs[0].runs[0].properties;
    expect(props?.cap).toBeUndefined();
  });

  it('should return undefined for null input', () => {
    expect(parseRichText(null)).toBeUndefined();
  });

  it('should return undefined for empty element', () => {
    expect(parseRichText({})).toBeUndefined();
  });
});
