/**
 * Tests for Diagram Style Definition Parser
 */
import { parseScene3D, parseStyleDef } from '../../src/parser/style-def-parser';

describe('parseStyleDef', () => {
  // =========================================================================
  // Basic structure
  // =========================================================================

  it('should parse an empty style definition', () => {
    const xml = { 'dgm:styleDef': {} };
    const result = parseStyleDef(xml);
    expect(result.uniqueId).toBe('');
    expect(result.title).toBe('');
    expect(result.desc).toBe('');
    expect(result.categories).toEqual([]);
    expect(result.scene3d).toBeUndefined();
    expect(result.styleLabelMap.size).toBe(0);
  });

  it('should accept root element directly (no dgm:styleDef wrapper)', () => {
    const xml = { '@_uniqueId': 'test-style-id' };
    const result = parseStyleDef(xml);
    expect(result.uniqueId).toBe('test-style-id');
  });

  // =========================================================================
  // Identity fields (uniqueId, title, desc)
  // =========================================================================

  it('should parse uniqueId attribute', () => {
    const xml = {
      'dgm:styleDef': {
        '@_uniqueId': 'urn:microsoft.com/office/officeart/2005/8/quickstyle/simple1',
      },
    };
    const result = parseStyleDef(xml);
    expect(result.uniqueId).toBe('urn:microsoft.com/office/officeart/2005/8/quickstyle/simple1');
  });

  it('should parse title from dgm:title element', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:title': { '@_val': 'Simple Fill' },
      },
    };
    const result = parseStyleDef(xml);
    expect(result.title).toBe('Simple Fill');
  });

  it('should parse desc from dgm:desc element', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:desc': { '@_val': 'Simple fill with no effects.' },
      },
    };
    const result = parseStyleDef(xml);
    expect(result.desc).toBe('Simple fill with no effects.');
  });

  it('should default title to empty string when dgm:title has no val', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:title': {},
      },
    };
    const result = parseStyleDef(xml);
    expect(result.title).toBe('');
  });

  // =========================================================================
  // Categories
  // =========================================================================

  it('should parse categories from dgm:catLst', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:catLst': {
          'dgm:cat': { '@_type': 'simple', '@_pri': 10100 },
        },
      },
    };
    const result = parseStyleDef(xml);
    expect(result.categories).toEqual([{ type: 'simple', pri: 10100 }]);
  });

  it('should parse multiple categories', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:catLst': {
          'dgm:cat': [
            { '@_type': 'simple', '@_pri': 10100 },
            { '@_type': '3D', '@_pri': 10200 },
          ],
        },
      },
    };
    const result = parseStyleDef(xml);
    expect(result.categories).toHaveLength(2);
  });

  it('should skip categories without type', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:catLst': {
          'dgm:cat': [{ '@_pri': 100 }, { '@_type': 'simple', '@_pri': 200 }],
        },
      },
    };
    const result = parseStyleDef(xml);
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].type).toBe('simple');
  });

  // =========================================================================
  // Scene3D Parsing
  // =========================================================================

  it('should parse top-level scene3d', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:scene3d': {
          'a:camera': { '@_prst': 'orthographicFront' },
          'a:lightRig': { '@_rig': 'threePt', '@_dir': 't' },
        },
      },
    };
    const result = parseStyleDef(xml);
    expect(result.scene3d).toBeDefined();
    expect(result.scene3d!.camera.prst).toBe('orthographicFront');
    expect(result.scene3d!.lightRig.rig).toBe('threePt');
    expect(result.scene3d!.lightRig.dir).toBe('t');
  });

  it('should parse scene3d camera with rotation', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:scene3d': {
          'a:camera': {
            '@_prst': 'perspectiveFront',
            '@_fov': 45000,
            'a:rot': { '@_lat': 1000, '@_lon': 2000, '@_rev': 3000 },
          },
          'a:lightRig': { '@_rig': 'balanced', '@_dir': 'tl' },
        },
      },
    };
    const result = parseStyleDef(xml);
    expect(result.scene3d!.camera.prst).toBe('perspectiveFront');
    expect(result.scene3d!.camera.fov).toBe(45000);
    expect(result.scene3d!.camera.rot).toEqual({ lat: 1000, lon: 2000, rev: 3000 });
  });

  it('should return undefined scene3d when camera is missing', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:scene3d': {
          'a:lightRig': { '@_rig': 'threePt', '@_dir': 't' },
        },
      },
    };
    const result = parseStyleDef(xml);
    expect(result.scene3d).toBeUndefined();
  });

  it('should return undefined scene3d when lightRig is missing', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:scene3d': {
          'a:camera': { '@_prst': 'orthographicFront' },
        },
      },
    };
    const result = parseStyleDef(xml);
    expect(result.scene3d).toBeUndefined();
  });

  it('should default camera preset to orthographicFront', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:scene3d': {
          'a:camera': {},
          'a:lightRig': { '@_rig': 'threePt', '@_dir': 't' },
        },
      },
    };
    const result = parseStyleDef(xml);
    expect(result.scene3d!.camera.prst).toBe('orthographicFront');
  });

  it('should default lightRig rig to threePt and dir to t', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:scene3d': {
          'a:camera': { '@_prst': 'orthographicFront' },
          'a:lightRig': {},
        },
      },
    };
    const result = parseStyleDef(xml);
    expect(result.scene3d!.lightRig.rig).toBe('threePt');
    expect(result.scene3d!.lightRig.dir).toBe('t');
  });

  // =========================================================================
  // Style Label Parsing
  // =========================================================================

  it('should parse a style label with style references', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:lnRef': { '@_idx': 2, 'a:schemeClr': { '@_val': 'accent1' } },
          'dgm:fillRef': { '@_idx': 1, 'a:schemeClr': { '@_val': 'accent2' } },
          'dgm:effectRef': { '@_idx': 0 },
          'dgm:fontRef': { '@_idx': 'minor', 'a:schemeClr': { '@_val': 'lt1' } },
        },
      },
    };
    const result = parseStyleDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.name).toBe('node1');
    expect(label.style.lnRef.idx).toBe(2);
    expect(label.style.lnRef.schemeClr).toBeDefined();
    expect(label.style.lnRef.schemeClr!.val).toBe('accent1');
    expect(label.style.fillRef.idx).toBe(1);
    expect(label.style.fillRef.schemeClr!.val).toBe('accent2');
    expect(label.style.effectRef.idx).toBe(0);
    expect(label.style.effectRef.schemeClr).toBeUndefined();
    expect(label.style.fontRef.idx).toBe('minor');
    expect(label.style.fontRef.schemeClr!.val).toBe('lt1');
  });

  it('should skip style labels without name attribute', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:styleLbl': {
          'dgm:lnRef': { '@_idx': 2 },
        },
      },
    };
    const result = parseStyleDef(xml);
    expect(result.styleLabelMap.size).toBe(0);
  });

  it('should parse multiple style labels', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:styleLbl': [
          {
            '@_name': 'node1',
            'dgm:lnRef': { '@_idx': 1 },
            'dgm:fillRef': { '@_idx': 1 },
            'dgm:effectRef': { '@_idx': 0 },
            'dgm:fontRef': { '@_idx': 'minor' },
          },
          {
            '@_name': 'sibTrans2D1',
            'dgm:lnRef': { '@_idx': 0 },
            'dgm:fillRef': { '@_idx': 1 },
            'dgm:effectRef': { '@_idx': 0 },
            'dgm:fontRef': { '@_idx': 'minor' },
          },
        ],
      },
    };
    const result = parseStyleDef(xml);
    expect(result.styleLabelMap.size).toBe(2);
    expect(result.styleLabelMap.has('node1')).toBe(true);
    expect(result.styleLabelMap.has('sibTrans2D1')).toBe(true);
  });

  it('should default style reference idx to 0 when missing', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
        },
      },
    };
    const result = parseStyleDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.style.lnRef.idx).toBe(0);
    expect(label.style.fillRef.idx).toBe(0);
    expect(label.style.effectRef.idx).toBe(0);
    expect(label.style.fontRef.idx).toBe('none');
  });

  it('should parse style references with a: prefix fallback', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'a:lnRef': { '@_idx': 3 },
          'a:fillRef': { '@_idx': 2 },
          'a:effectRef': { '@_idx': 1 },
          'a:fontRef': { '@_idx': 'major' },
        },
      },
    };
    const result = parseStyleDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.style.lnRef.idx).toBe(3);
    expect(label.style.fillRef.idx).toBe(2);
    expect(label.style.effectRef.idx).toBe(1);
    expect(label.style.fontRef.idx).toBe('major');
  });

  // =========================================================================
  // Per-label scene3d
  // =========================================================================

  it('should parse per-label scene3d from dgm:scene3d', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:scene3d': {
            'a:camera': { '@_prst': 'isometricTopUp' },
            'a:lightRig': { '@_rig': 'harsh', '@_dir': 'b' },
          },
        },
      },
    };
    const result = parseStyleDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.scene3d).toBeDefined();
    expect(label.scene3d!.camera.prst).toBe('isometricTopUp');
    expect(label.scene3d!.lightRig.rig).toBe('harsh');
  });

  it('should parse per-label scene3d from a:scene3d fallback', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'a:scene3d': {
            'a:camera': { '@_prst': 'perspectiveAbove' },
            'a:lightRig': { '@_rig': 'balanced', '@_dir': 'tl' },
          },
        },
      },
    };
    const result = parseStyleDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.scene3d).toBeDefined();
    expect(label.scene3d!.camera.prst).toBe('perspectiveAbove');
  });

  // =========================================================================
  // ShapeProperties3D (sp3d) Parsing
  // =========================================================================

  it('should parse sp3d with top bevel', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'a:sp3d': {
            'a:bevelT': { '@_w': 50800, '@_h': 25400, '@_prst': 'relaxedInset' },
          },
        },
      },
    };
    const result = parseStyleDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.sp3d).toBeDefined();
    expect(label.sp3d!.bevelT).toEqual({ w: 50800, h: 25400, prst: 'relaxedInset' });
  });

  it('should parse sp3d with bottom bevel', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'a:sp3d': {
            'a:bevelB': { '@_w': 38100, '@_h': 19050, '@_prst': 'circle' },
          },
        },
      },
    };
    const result = parseStyleDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.sp3d!.bevelB).toEqual({ w: 38100, h: 19050, prst: 'circle' });
  });

  it('should parse sp3d with extrusion properties', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'a:sp3d': {
            '@_extrusionH': 76200,
            'a:extrusionClr': {
              'a:schemeClr': { '@_val': 'accent1' },
            },
          },
        },
      },
    };
    const result = parseStyleDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.sp3d!.extrusionH).toBe(76200);
    expect(label.sp3d!.extrusionClr).toBeDefined();
    expect(label.sp3d!.extrusionClr!.val).toBe('accent1');
  });

  it('should parse sp3d with contour properties', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'a:sp3d': {
            '@_contourW': 12700,
            'a:contourClr': {
              'a:schemeClr': { '@_val': 'dk1' },
            },
          },
        },
      },
    };
    const result = parseStyleDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.sp3d!.contourW).toBe(12700);
    expect(label.sp3d!.contourClr!.val).toBe('dk1');
  });

  it('should parse sp3d with preset material', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'a:sp3d': {
            '@_prstMaterial': 'plastic',
          },
        },
      },
    };
    const result = parseStyleDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.sp3d!.prstMaterial).toBe('plastic');
  });

  it('should return undefined sp3d when a:sp3d is empty (no properties)', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'a:sp3d': {},
        },
      },
    };
    const result = parseStyleDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.sp3d).toBeUndefined();
  });

  // =========================================================================
  // Text Properties Parsing
  // =========================================================================

  it('should parse text properties from a:p/a:pPr/a:defRPr path', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:txPr': {
            'a:bodyPr': { '@_anchor': 'ctr' },
            'a:p': {
              'a:pPr': {
                'a:defRPr': {
                  '@_sz': 1200,
                  '@_b': '1',
                  '@_i': '0',
                  'a:latin': { '@_typeface': 'Calibri' },
                },
              },
            },
          },
        },
      },
    };
    const result = parseStyleDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.txPr).toBeDefined();
    expect(label.txPr!.bodyPr).toEqual({
      anchor: 'ctr',
      horzOverflow: undefined,
      vertOverflow: undefined,
    });
    expect(label.txPr!.defRPr).toEqual({
      sz: 1200,
      b: true,
      i: false,
      latin: 'Calibri',
    });
  });

  it('should parse text properties from a:lstStyle/a:defPPr path', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:txPr': {
            'a:lstStyle': {
              'a:defPPr': {
                'a:defRPr': {
                  '@_sz': 1800,
                  '@_b': '0',
                },
              },
            },
          },
        },
      },
    };
    const result = parseStyleDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.txPr).toBeDefined();
    expect(label.txPr!.defRPr).toBeDefined();
    expect(label.txPr!.defRPr!.sz).toBe(1800);
    expect(label.txPr!.defRPr!.b).toBe(false);
  });

  it('should prefer a:p path over a:lstStyle path', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:txPr': {
            'a:p': {
              'a:pPr': {
                'a:defRPr': { '@_sz': 1200 },
              },
            },
            'a:lstStyle': {
              'a:defPPr': {
                'a:defRPr': { '@_sz': 2400 },
              },
            },
          },
        },
      },
    };
    const result = parseStyleDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    // The a:p path should win since lstStyle is only used as fallback
    expect(label.txPr!.defRPr!.sz).toBe(1200);
  });

  it('should return undefined txPr when dgm:txPr is not present', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:styleLbl': { '@_name': 'node1' },
      },
    };
    const result = parseStyleDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.txPr).toBeUndefined();
  });

  // =========================================================================
  // Style reference scheme colors with transforms
  // =========================================================================

  it('should parse scheme color transforms on style references', () => {
    const xml = {
      'dgm:styleDef': {
        'dgm:styleLbl': {
          '@_name': 'node1',
          'dgm:fillRef': {
            '@_idx': 1,
            'a:schemeClr': {
              '@_val': 'accent1',
              'a:tint': { '@_val': 40000 },
              'a:lumMod': { '@_val': 75000 },
            },
          },
        },
      },
    };
    const result = parseStyleDef(xml);
    const label = result.styleLabelMap.get('node1')!;
    expect(label.style.fillRef.schemeClr).toBeDefined();
    expect(label.style.fillRef.schemeClr!.val).toBe('accent1');
    expect(label.style.fillRef.schemeClr!.transforms).toBeDefined();
    expect(label.style.fillRef.schemeClr!.transforms).toContainEqual({
      type: 'tint',
      val: 40000,
    });
  });

  // =========================================================================
  // Complete scenario
  // =========================================================================

  it('should parse a complete style definition', () => {
    const xml = {
      'dgm:styleDef': {
        '@_uniqueId': 'urn:microsoft.com/office/officeart/2005/8/quickstyle/3d1',
        'dgm:title': { '@_val': '3D Polished' },
        'dgm:desc': { '@_val': 'Polished 3D style with bevels.' },
        'dgm:catLst': {
          'dgm:cat': { '@_type': '3D', '@_pri': 10300 },
        },
        'dgm:scene3d': {
          'a:camera': { '@_prst': 'perspectiveFront', '@_fov': 60000 },
          'a:lightRig': { '@_rig': 'balanced', '@_dir': 't' },
        },
        'dgm:styleLbl': [
          {
            '@_name': 'node1',
            'dgm:lnRef': { '@_idx': 2, 'a:schemeClr': { '@_val': 'accent1' } },
            'dgm:fillRef': { '@_idx': 3, 'a:schemeClr': { '@_val': 'accent1' } },
            'dgm:effectRef': { '@_idx': 1 },
            'dgm:fontRef': { '@_idx': 'minor', 'a:schemeClr': { '@_val': 'lt1' } },
            'a:sp3d': {
              '@_prstMaterial': 'plastic',
              'a:bevelT': { '@_w': 50800, '@_h': 38100, '@_prst': 'relaxedInset' },
            },
            'dgm:txPr': {
              'a:bodyPr': { '@_anchor': 'ctr' },
              'a:p': {
                'a:pPr': {
                  'a:defRPr': { '@_sz': 1200, '@_b': '1' },
                },
              },
            },
          },
          {
            '@_name': 'sibTrans2D1',
            'dgm:lnRef': { '@_idx': 0 },
            'dgm:fillRef': { '@_idx': 1, 'a:schemeClr': { '@_val': 'accent1' } },
            'dgm:effectRef': { '@_idx': 0 },
            'dgm:fontRef': { '@_idx': 'minor' },
          },
        ],
      },
    };

    const result = parseStyleDef(xml);
    expect(result.uniqueId).toBe('urn:microsoft.com/office/officeart/2005/8/quickstyle/3d1');
    expect(result.title).toBe('3D Polished');
    expect(result.desc).toBe('Polished 3D style with bevels.');
    expect(result.categories).toHaveLength(1);
    expect(result.scene3d).toBeDefined();
    expect(result.scene3d!.camera.fov).toBe(60000);
    expect(result.styleLabelMap.size).toBe(2);

    // Check node1
    const node1 = result.styleLabelMap.get('node1')!;
    expect(node1.style.lnRef.idx).toBe(2);
    expect(node1.style.fillRef.idx).toBe(3);
    expect(node1.style.effectRef.idx).toBe(1);
    expect(node1.style.fontRef.idx).toBe('minor');
    expect(node1.sp3d).toBeDefined();
    expect(node1.sp3d!.prstMaterial).toBe('plastic');
    expect(node1.sp3d!.bevelT!.w).toBe(50800);
    expect(node1.txPr).toBeDefined();
    expect(node1.txPr!.defRPr!.sz).toBe(1200);

    // Check sibTrans2D1
    const sibTrans = result.styleLabelMap.get('sibTrans2D1')!;
    expect(sibTrans.style.lnRef.idx).toBe(0);
    expect(sibTrans.style.fillRef.idx).toBe(1);
    expect(sibTrans.sp3d).toBeUndefined();
    expect(sibTrans.txPr).toBeUndefined();
  });
});

// =========================================================================
// parseScene3D (exported helper)
// =========================================================================

describe('parseScene3D', () => {
  it('should return undefined for undefined input', () => {
    expect(parseScene3D(undefined)).toBeUndefined();
  });

  it('should return undefined when camera is missing', () => {
    const node = { 'a:lightRig': { '@_rig': 'threePt', '@_dir': 't' } };
    expect(parseScene3D(node)).toBeUndefined();
  });

  it('should return undefined when lightRig is missing', () => {
    const node = { 'a:camera': { '@_prst': 'orthographicFront' } };
    expect(parseScene3D(node)).toBeUndefined();
  });

  it('should parse camera rotation defaults to 0', () => {
    const node = {
      'a:camera': {
        '@_prst': 'orthographicFront',
        'a:rot': {},
      },
      'a:lightRig': { '@_rig': 'threePt', '@_dir': 't' },
    };
    const result = parseScene3D(node);
    expect(result!.camera.rot).toEqual({ lat: 0, lon: 0, rev: 0 });
  });

  it('should omit fov when not specified', () => {
    const node = {
      'a:camera': { '@_prst': 'orthographicFront' },
      'a:lightRig': { '@_rig': 'threePt', '@_dir': 't' },
    };
    const result = parseScene3D(node);
    expect(result!.camera.fov).toBeUndefined();
  });

  it('should omit rot when not specified', () => {
    const node = {
      'a:camera': { '@_prst': 'orthographicFront' },
      'a:lightRig': { '@_rig': 'threePt', '@_dir': 't' },
    };
    const result = parseScene3D(node);
    expect(result!.camera.rot).toBeUndefined();
  });
});
