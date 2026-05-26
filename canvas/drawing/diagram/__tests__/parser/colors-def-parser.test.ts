/**
 * Tests for Diagram Colors Definition Parser
 */
import { parseColorsDef } from '../../src/parser/colors-def-parser';

describe('parseColorsDef', () => {
  // =========================================================================
  // Basic structure
  // =========================================================================

  it('should parse an empty colors definition', () => {
    const xml = { 'dgm:colorsDef': {} };
    const result = parseColorsDef(xml);
    expect(result.uniqueId).toBe('');
    expect(result.title).toBe('');
    expect(result.desc).toBe('');
    expect(result.categories).toEqual([]);
    expect(result.styleLabelMap.size).toBe(0);
  });

  it('should accept root element directly (no dgm:colorsDef wrapper)', () => {
    const xml = { '@_uniqueId': 'test-id' };
    const result = parseColorsDef(xml);
    expect(result.uniqueId).toBe('test-id');
  });

  // =========================================================================
  // Identity fields (uniqueId, title, desc)
  // =========================================================================

  it('should parse uniqueId attribute', () => {
    const xml = {
      'dgm:colorsDef': {
        '@_uniqueId': 'urn:microsoft.com/office/officeart/2005/8/colors/accent1_2',
      },
    };
    const result = parseColorsDef(xml);
    expect(result.uniqueId).toBe('urn:microsoft.com/office/officeart/2005/8/colors/accent1_2');
  });

  it('should parse title from dgm:title element', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:title': { '@_val': 'Colorful - Accent Colors' },
      },
    };
    const result = parseColorsDef(xml);
    expect(result.title).toBe('Colorful - Accent Colors');
  });

  it('should parse desc from dgm:desc element', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:desc': { '@_val': 'Colors 1 to 4 rotate in the accent colors.' },
      },
    };
    const result = parseColorsDef(xml);
    expect(result.desc).toBe('Colors 1 to 4 rotate in the accent colors.');
  });

  it('should default title to empty string when dgm:title has no val', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:title': {},
      },
    };
    const result = parseColorsDef(xml);
    expect(result.title).toBe('');
  });

  // =========================================================================
  // Categories
  // =========================================================================

  it('should parse categories from dgm:catLst', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:catLst': {
          'dgm:cat': { '@_type': 'mainScheme', '@_pri': 10100 },
        },
      },
    };
    const result = parseColorsDef(xml);
    expect(result.categories).toEqual([{ type: 'mainScheme', pri: 10100 }]);
  });

  it('should parse multiple categories', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:catLst': {
          'dgm:cat': [
            { '@_type': 'mainScheme', '@_pri': 10100 },
            { '@_type': 'accent', '@_pri': 10200 },
          ],
        },
      },
    };
    const result = parseColorsDef(xml);
    expect(result.categories).toHaveLength(2);
    expect(result.categories[0]).toEqual({ type: 'mainScheme', pri: 10100 });
    expect(result.categories[1]).toEqual({ type: 'accent', pri: 10200 });
  });

  it('should default category priority to 0', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:catLst': {
          'dgm:cat': { '@_type': 'mainScheme' },
        },
      },
    };
    const result = parseColorsDef(xml);
    expect(result.categories[0].pri).toBe(0);
  });

  it('should skip categories without type attribute', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:catLst': {
          'dgm:cat': [{ '@_pri': 100 }, { '@_type': 'mainScheme', '@_pri': 200 }],
        },
      },
    };
    const result = parseColorsDef(xml);
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].type).toBe('mainScheme');
  });

  it('should return empty categories when dgm:catLst is missing', () => {
    const xml = { 'dgm:colorsDef': {} };
    const result = parseColorsDef(xml);
    expect(result.categories).toEqual([]);
  });

  // =========================================================================
  // Style Label Parsing
  // =========================================================================

  it('should parse a single style label with empty color lists', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
        },
      },
    };
    const result = parseColorsDef(xml);
    expect(result.styleLabelMap.size).toBe(1);
    const label = result.styleLabelMap.get('node1');
    expect(label).toBeDefined();
    expect(label!.name).toBe('node1');
    // All color lists should have default empty values
    expect(label!.fillClrLst).toEqual({ method: 'repeat', colors: [] });
    expect(label!.linClrLst).toEqual({ method: 'repeat', colors: [] });
    expect(label!.effectClrLst).toEqual({ method: 'repeat', colors: [] });
    expect(label!.txLinClrLst).toEqual({ method: 'repeat', colors: [] });
    expect(label!.txFillClrLst).toEqual({ method: 'repeat', colors: [] });
    expect(label!.txEffectClrLst).toEqual({ method: 'repeat', colors: [] });
  });

  it('should skip style labels without a name attribute', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': { 'dgm:fillClrLst': {} },
      },
    };
    const result = parseColorsDef(xml);
    expect(result.styleLabelMap.size).toBe(0);
  });

  it('should parse multiple style labels', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': [{ '@_name': 'node1' }, { '@_name': 'node2' }, { '@_name': 'sibTrans2D1' }],
      },
    };
    const result = parseColorsDef(xml);
    expect(result.styleLabelMap.size).toBe(3);
    expect(result.styleLabelMap.has('node1')).toBe(true);
    expect(result.styleLabelMap.has('node2')).toBe(true);
    expect(result.styleLabelMap.has('sibTrans2D1')).toBe(true);
  });

  // =========================================================================
  // Color List Parsing
  // =========================================================================

  it('should parse fillClrLst with a single scheme color', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:fillClrLst': {
            '@_meth': 'repeat',
            'a:schemeClr': { '@_val': 'accent1' },
          },
        },
      },
    };
    const result = parseColorsDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.fillClrLst.method).toBe('repeat');
    expect(label.fillClrLst.colors).toHaveLength(1);
    expect(label.fillClrLst.colors[0].val).toBe('accent1');
  });

  it('should parse fillClrLst with multiple scheme colors', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:fillClrLst': {
            '@_meth': 'repeat',
            'a:schemeClr': [{ '@_val': 'accent1' }, { '@_val': 'accent2' }, { '@_val': 'accent3' }],
          },
        },
      },
    };
    const result = parseColorsDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.fillClrLst.colors).toHaveLength(3);
    expect(label.fillClrLst.colors[0].val).toBe('accent1');
    expect(label.fillClrLst.colors[1].val).toBe('accent2');
    expect(label.fillClrLst.colors[2].val).toBe('accent3');
  });

  it('should parse color list with span method', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:fillClrLst': {
            '@_meth': 'span',
            'a:schemeClr': { '@_val': 'accent1' },
          },
        },
      },
    };
    const result = parseColorsDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.fillClrLst.method).toBe('span');
  });

  it('should default color list method to repeat', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:fillClrLst': {
            'a:schemeClr': { '@_val': 'accent1' },
          },
        },
      },
    };
    const result = parseColorsDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.fillClrLst.method).toBe('repeat');
  });

  it('should parse all six color list types', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:fillClrLst': { 'a:schemeClr': { '@_val': 'accent1' } },
          'dgm:linClrLst': { 'a:schemeClr': { '@_val': 'accent2' } },
          'dgm:effectClrLst': { 'a:schemeClr': { '@_val': 'accent3' } },
          'dgm:txLinClrLst': { 'a:schemeClr': { '@_val': 'dk1' } },
          'dgm:txFillClrLst': { 'a:schemeClr': { '@_val': 'lt1' } },
          'dgm:txEffectClrLst': { 'a:schemeClr': { '@_val': 'dk2' } },
        },
      },
    };
    const result = parseColorsDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.fillClrLst.colors[0].val).toBe('accent1');
    expect(label.linClrLst.colors[0].val).toBe('accent2');
    expect(label.effectClrLst.colors[0].val).toBe('accent3');
    expect(label.txLinClrLst.colors[0].val).toBe('dk1');
    expect(label.txFillClrLst.colors[0].val).toBe('lt1');
    expect(label.txEffectClrLst.colors[0].val).toBe('dk2');
  });

  // =========================================================================
  // Color Transform Parsing
  // =========================================================================

  it('should parse color transforms with a: prefix', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:fillClrLst': {
            'a:schemeClr': {
              '@_val': 'accent1',
              'a:lumMod': { '@_val': 75000 },
              'a:lumOff': { '@_val': 25000 },
            },
          },
        },
      },
    };
    const result = parseColorsDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    const color = label.fillClrLst.colors[0];
    expect(color.transforms).toBeDefined();
    expect(color.transforms).toHaveLength(2);
    expect(color.transforms![0]).toEqual({ type: 'lumMod', val: 75000 });
    expect(color.transforms![1]).toEqual({ type: 'lumOff', val: 25000 });
  });

  it('should parse color transforms without prefix', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:fillClrLst': {
            'a:schemeClr': {
              '@_val': 'accent1',
              lumMod: { '@_val': 60000 },
            },
          },
        },
      },
    };
    const result = parseColorsDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    const color = label.fillClrLst.colors[0];
    expect(color.transforms).toBeDefined();
    expect(color.transforms![0]).toEqual({ type: 'lumMod', val: 60000 });
  });

  it('should parse tint transform', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:fillClrLst': {
            'a:schemeClr': {
              '@_val': 'accent1',
              'a:tint': { '@_val': 40000 },
            },
          },
        },
      },
    };
    const result = parseColorsDef(xml);
    const color = result.styleLabelMap.get('node1')!.fillClrLst.colors[0];
    expect(color.transforms![0]).toEqual({ type: 'tint', val: 40000 });
  });

  it('should parse shade transform', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:fillClrLst': {
            'a:schemeClr': {
              '@_val': 'accent1',
              'a:shade': { '@_val': 50000 },
            },
          },
        },
      },
    };
    const result = parseColorsDef(xml);
    const color = result.styleLabelMap.get('node1')!.fillClrLst.colors[0];
    expect(color.transforms![0]).toEqual({ type: 'shade', val: 50000 });
  });

  it('should parse satMod and satOff transforms', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:fillClrLst': {
            'a:schemeClr': {
              '@_val': 'accent1',
              'a:satMod': { '@_val': 120000 },
              'a:satOff': { '@_val': 10000 },
            },
          },
        },
      },
    };
    const result = parseColorsDef(xml);
    const color = result.styleLabelMap.get('node1')!.fillClrLst.colors[0];
    expect(color.transforms).toHaveLength(2);
    expect(color.transforms![0]).toEqual({ type: 'satMod', val: 120000 });
    expect(color.transforms![1]).toEqual({ type: 'satOff', val: 10000 });
  });

  it('should parse alpha transform', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:fillClrLst': {
            'a:schemeClr': {
              '@_val': 'accent1',
              'a:alpha': { '@_val': 50000 },
            },
          },
        },
      },
    };
    const result = parseColorsDef(xml);
    const color = result.styleLabelMap.get('node1')!.fillClrLst.colors[0];
    expect(color.transforms![0]).toEqual({ type: 'alpha', val: 50000 });
  });

  it('should parse comp transform (no value)', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:fillClrLst': {
            'a:schemeClr': {
              '@_val': 'accent1',
              'a:comp': {},
            },
          },
        },
      },
    };
    const result = parseColorsDef(xml);
    const color = result.styleLabelMap.get('node1')!.fillClrLst.colors[0];
    expect(color.transforms![0]).toEqual({ type: 'comp', val: undefined });
  });

  it('should parse inv and gray transforms', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:fillClrLst': {
            'a:schemeClr': {
              '@_val': 'accent1',
              'a:inv': {},
              'a:gray': {},
            },
          },
        },
      },
    };
    const result = parseColorsDef(xml);
    const color = result.styleLabelMap.get('node1')!.fillClrLst.colors[0];
    expect(color.transforms).toContainEqual({ type: 'inv', val: undefined });
    expect(color.transforms).toContainEqual({ type: 'gray', val: undefined });
  });

  it('should parse hueMod and hueOff transforms', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:fillClrLst': {
            'a:schemeClr': {
              '@_val': 'accent1',
              'a:hueMod': { '@_val': 200000 },
              'a:hueOff': { '@_val': 50000 },
            },
          },
        },
      },
    };
    const result = parseColorsDef(xml);
    const color = result.styleLabelMap.get('node1')!.fillClrLst.colors[0];
    expect(color.transforms).toContainEqual({ type: 'hueMod', val: 200000 });
    expect(color.transforms).toContainEqual({ type: 'hueOff', val: 50000 });
  });

  it('should set transforms to undefined when no transforms present', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:fillClrLst': {
            'a:schemeClr': { '@_val': 'accent1' },
          },
        },
      },
    };
    const result = parseColorsDef(xml);
    const color = result.styleLabelMap.get('node1')!.fillClrLst.colors[0];
    expect(color.transforms).toBeUndefined();
  });

  it('should skip scheme colors without val attribute', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:fillClrLst': {
            'a:schemeClr': [{ '@_val': 'accent1' }, {}, { '@_val': 'accent3' }],
          },
        },
      },
    };
    const result = parseColorsDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.fillClrLst.colors).toHaveLength(2);
    expect(label.fillClrLst.colors[0].val).toBe('accent1');
    expect(label.fillClrLst.colors[1].val).toBe('accent3');
  });

  // =========================================================================
  // Complete scenario
  // =========================================================================

  it('should parse a complete colors definition', () => {
    const xml = {
      'dgm:colorsDef': {
        '@_uniqueId': 'urn:microsoft.com/office/officeart/2005/8/colors/accent1_2',
        'dgm:title': { '@_val': 'Colorful Range - Accent Colors 2 to 3' },
        'dgm:desc': { '@_val': 'Colors range between Accent 2 and Accent 3.' },
        'dgm:catLst': {
          'dgm:cat': { '@_type': 'mainScheme', '@_pri': 10100 },
        },
        'dgm:styleLbl': [
          {
            '@_name': 'node1',
            'dgm:fillClrLst': {
              '@_meth': 'repeat',
              'a:schemeClr': [
                {
                  '@_val': 'accent2',
                  'a:shade': { '@_val': 80000 },
                },
                { '@_val': 'accent3' },
              ],
            },
            'dgm:linClrLst': {
              '@_meth': 'repeat',
              'a:schemeClr': { '@_val': 'lt1' },
            },
            'dgm:effectClrLst': {},
            'dgm:txLinClrLst': {},
            'dgm:txFillClrLst': {
              '@_meth': 'repeat',
              'a:schemeClr': { '@_val': 'lt1' },
            },
            'dgm:txEffectClrLst': {},
          },
          {
            '@_name': 'sibTrans2D1',
            'dgm:fillClrLst': {
              '@_meth': 'span',
              'a:schemeClr': {
                '@_val': 'accent2',
                'a:tint': { '@_val': 60000 },
              },
            },
            'dgm:linClrLst': {},
            'dgm:effectClrLst': {},
            'dgm:txLinClrLst': {},
            'dgm:txFillClrLst': {},
            'dgm:txEffectClrLst': {},
          },
        ],
      },
    };

    const result = parseColorsDef(xml);
    expect(result.uniqueId).toBe('urn:microsoft.com/office/officeart/2005/8/colors/accent1_2');
    expect(result.title).toBe('Colorful Range - Accent Colors 2 to 3');
    expect(result.desc).toBe('Colors range between Accent 2 and Accent 3.');
    expect(result.categories).toHaveLength(1);
    expect(result.styleLabelMap.size).toBe(2);

    // Check node1
    const node1 = result.styleLabelMap.get('node1')!;
    expect(node1.fillClrLst.method).toBe('repeat');
    expect(node1.fillClrLst.colors).toHaveLength(2);
    expect(node1.fillClrLst.colors[0].val).toBe('accent2');
    expect(node1.fillClrLst.colors[0].transforms).toHaveLength(1);
    expect(node1.fillClrLst.colors[0].transforms![0]).toEqual({
      type: 'shade',
      val: 80000,
    });
    expect(node1.fillClrLst.colors[1].val).toBe('accent3');
    expect(node1.linClrLst.colors[0].val).toBe('lt1');
    expect(node1.txFillClrLst.colors[0].val).toBe('lt1');

    // Check sibTrans2D1
    const sibTrans = result.styleLabelMap.get('sibTrans2D1')!;
    expect(sibTrans.fillClrLst.method).toBe('span');
    expect(sibTrans.fillClrLst.colors[0].val).toBe('accent2');
    expect(sibTrans.fillClrLst.colors[0].transforms![0]).toEqual({
      type: 'tint',
      val: 60000,
    });
  });

  // =========================================================================
  // Edge cases and robustness
  // =========================================================================

  it('should handle numeric attribute values parsed as numbers', () => {
    const xml = {
      'dgm:colorsDef': {
        '@_uniqueId': 'test-123',
        'dgm:catLst': {
          'dgm:cat': { '@_type': 'mainScheme', '@_pri': '10100' },
        },
      },
    };
    const result = parseColorsDef(xml);
    expect(result.categories[0].pri).toBe(10100);
  });

  it('should handle empty color list node (no colors)', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:fillClrLst': { '@_meth': 'span' },
        },
      },
    };
    const result = parseColorsDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.fillClrLst.method).toBe('span');
    expect(label.fillClrLst.colors).toEqual([]);
  });

  it('should handle duplicate style label names (last wins)', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': [
          {
            '@_name': 'node1',
            'dgm:fillClrLst': { 'a:schemeClr': { '@_val': 'accent1' } },
          },
          {
            '@_name': 'node1',
            'dgm:fillClrLst': { 'a:schemeClr': { '@_val': 'accent2' } },
          },
        ],
      },
    };
    const result = parseColorsDef(xml);
    expect(result.styleLabelMap.size).toBe(1);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.fillClrLst.colors[0].val).toBe('accent2');
  });

  it('should avoid duplicate transforms when both prefixed and unprefixed are present', () => {
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:fillClrLst': {
            'a:schemeClr': {
              '@_val': 'accent1',
              'a:lumMod': { '@_val': 75000 },
              lumMod: { '@_val': 75000 },
            },
          },
        },
      },
    };
    const result = parseColorsDef(xml);
    const color = result.styleLabelMap.get('node1')!.fillClrLst.colors[0];
    // Should deduplicate when both prefixed and unprefixed have same type+value
    const lumModTransforms = color.transforms!.filter((t) => t.type === 'lumMod');
    expect(lumModTransforms).toHaveLength(1);
  });

  it('should handle all style label names used in real OOXML files', () => {
    const labels = ['node0', 'node1', 'asst1', 'fgAcc1', 'bgAcc1', 'sibTrans2D1', 'parChTrans2D1'];
    const styleLblArray = labels.map((name) => ({
      '@_name': name,
      'dgm:fillClrLst': { 'a:schemeClr': { '@_val': 'accent1' } },
    }));
    const xml = {
      'dgm:colorsDef': {
        'dgm:styleLbl': styleLblArray,
      },
    };
    const result = parseColorsDef(xml);
    expect(result.styleLabelMap.size).toBe(labels.length);
    for (const name of labels) {
      expect(result.styleLabelMap.has(name)).toBe(true);
    }
  });
});
