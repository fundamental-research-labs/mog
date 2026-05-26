/**
 * Tests for Diagram Data Model Parser
 */
import { parseDataModel } from '../../src/parser/data-model-parser';

describe('parseDataModel', () => {
  // =========================================================================
  // Basic structure
  // =========================================================================

  it('should parse an empty data model', () => {
    const xml = { 'dgm:dataModel': {} };
    const result = parseDataModel(xml);
    expect(result.points).toEqual([]);
    expect(result.connections).toEqual([]);
    expect(result.background).toBeUndefined();
    expect(result.whole).toBeUndefined();
  });

  it('should accept root element directly (no dgm:dataModel wrapper)', () => {
    const xml = { 'dgm:ptLst': {}, 'dgm:cxnLst': {} };
    const result = parseDataModel(xml);
    expect(result.points).toEqual([]);
    expect(result.connections).toEqual([]);
  });

  // =========================================================================
  // Point Parsing
  // =========================================================================

  it('should parse a single doc point', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:ptLst': {
          'dgm:pt': { '@_modelId': '0', '@_type': 'doc' },
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.points).toHaveLength(1);
    expect(result.points[0].modelId).toBe('0');
    expect(result.points[0].type).toBe('doc');
  });

  it('should default point type to node when type attribute is missing', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:ptLst': {
          'dgm:pt': { '@_modelId': '1' },
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.points[0].type).toBe('node');
  });

  it('should parse multiple points from array', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:ptLst': {
          'dgm:pt': [
            { '@_modelId': '0', '@_type': 'doc' },
            { '@_modelId': '1', '@_type': 'node' },
            { '@_modelId': '2', '@_type': 'asst' },
            { '@_modelId': '3', '@_type': 'parTrans' },
            { '@_modelId': '4', '@_type': 'sibTrans' },
            { '@_modelId': '5', '@_type': 'pres' },
          ],
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.points).toHaveLength(6);
    expect(result.points[0].type).toBe('doc');
    expect(result.points[1].type).toBe('node');
    expect(result.points[2].type).toBe('asst');
    expect(result.points[3].type).toBe('parTrans');
    expect(result.points[4].type).toBe('sibTrans');
    expect(result.points[5].type).toBe('pres');
  });

  it('should handle invalid point type by defaulting to node', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:ptLst': {
          'dgm:pt': { '@_modelId': '1', '@_type': 'invalidType' },
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.points[0].type).toBe('node');
  });

  it('should skip points without modelId', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:ptLst': {
          'dgm:pt': [
            { '@_type': 'node' }, // Missing modelId
            { '@_modelId': '1', '@_type': 'node' },
          ],
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.points).toHaveLength(1);
    expect(result.points[0].modelId).toBe('1');
  });

  it('should parse point cxnId for transition points', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:ptLst': {
          'dgm:pt': { '@_modelId': '3', '@_type': 'parTrans', '@_cxnId': '10' },
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.points[0].cxnId).toBe('10');
  });

  // =========================================================================
  // Rich Text Parsing
  // =========================================================================

  it('should parse point rich text', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:ptLst': {
          'dgm:pt': {
            '@_modelId': '1',
            '@_type': 'node',
            'dgm:t': {
              'a:bodyPr': { '@_anchor': 'ctr' },
              'a:p': {
                'a:r': { 'a:t': { '#text': 'Hello World' } },
              },
            },
          },
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.points[0].text).toBeDefined();
    expect(result.points[0].text!.bodyProperties.anchor).toBe('ctr');
    expect(result.points[0].text!.paragraphs).toHaveLength(1);
    expect(result.points[0].text!.paragraphs[0].runs).toHaveLength(1);
    expect(result.points[0].text!.paragraphs[0].runs[0].text).toBe('Hello World');
  });

  it('should parse multiple paragraphs', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:ptLst': {
          'dgm:pt': {
            '@_modelId': '1',
            'dgm:t': {
              'a:bodyPr': {},
              'a:p': [
                { 'a:r': { 'a:t': { '#text': 'Line 1' } } },
                { 'a:r': { 'a:t': { '#text': 'Line 2' } } },
              ],
            },
          },
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.points[0].text!.paragraphs).toHaveLength(2);
    expect(result.points[0].text!.paragraphs[0].runs[0].text).toBe('Line 1');
    expect(result.points[0].text!.paragraphs[1].runs[0].text).toBe('Line 2');
  });

  it('should parse text run properties (bold, italic, font)', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:ptLst': {
          'dgm:pt': {
            '@_modelId': '1',
            'dgm:t': {
              'a:bodyPr': {},
              'a:p': {
                'a:r': {
                  'a:rPr': {
                    '@_b': 1,
                    '@_i': 1,
                    '@_sz': 1200,
                    '@_u': 'sng',
                    'a:latin': { '@_typeface': 'Calibri' },
                  },
                  'a:t': { '#text': 'Styled' },
                },
              },
            },
          },
        },
      },
    };
    const result = parseDataModel(xml);
    const run = result.points[0].text!.paragraphs[0].runs[0];
    expect(run.properties?.bold).toBe(true);
    expect(run.properties?.italic).toBe(true);
    expect(run.properties?.fontSize).toBe(1200);
    expect(run.properties?.underline).toBe('sng');
    expect(run.properties?.fontFamily).toBe('Calibri');
  });

  // =========================================================================
  // Property Set Parsing
  // =========================================================================

  it('should parse property set', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:ptLst': {
          'dgm:pt': {
            '@_modelId': '1',
            'dgm:prSet': {
              '@_phldr': '1',
              '@_phldrT': 'Click to add text',
              '@_custT': '0',
              '@_presName': 'node1',
              '@_presStyleLbl': 'node1',
              '@_presStyleIdx': 0,
              '@_presStyleCnt': 3,
            },
          },
        },
      },
    };
    const result = parseDataModel(xml);
    const props = result.points[0].properties!;
    expect(props.phldr).toBe(true);
    expect(props.phldrT).toBe('Click to add text');
    expect(props.custT).toBe(false);
    expect(props.presName).toBe('node1');
    expect(props.presStyleLbl).toBe('node1');
    expect(props.presStyleIdx).toBe(0);
    expect(props.presStyleCnt).toBe(3);
  });

  it('should parse custom angle and size properties', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:ptLst': {
          'dgm:pt': {
            '@_modelId': '1',
            'dgm:prSet': {
              '@_custAng': 45,
              '@_custSzX': 200,
              '@_custSzY': 150,
              '@_custFlipVert': '1',
              '@_custFlipHor': '0',
            },
          },
        },
      },
    };
    const result = parseDataModel(xml);
    const props = result.points[0].properties!;
    expect(props.custAng).toBe(45);
    expect(props.custSzX).toBe(200);
    expect(props.custSzY).toBe(150);
    expect(props.custFlipVert).toBe(true);
    expect(props.custFlipHor).toBe(false);
  });

  it('should parse layout and style IDs', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:ptLst': {
          'dgm:pt': {
            '@_modelId': '1',
            'dgm:prSet': {
              '@_loTypeId': 'urn:layout',
              '@_loCatId': 'list',
              '@_qsTypeId': 'urn:style',
              '@_qsCatId': 'simple',
              '@_csTypeId': 'urn:colors',
              '@_csCatId': 'accent1',
              '@_presAssocID': '42',
            },
          },
        },
      },
    };
    const result = parseDataModel(xml);
    const props = result.points[0].properties!;
    expect(props.loTypeId).toBe('urn:layout');
    expect(props.loCatId).toBe('list');
    expect(props.qsTypeId).toBe('urn:style');
    expect(props.qsCatId).toBe('simple');
    expect(props.csTypeId).toBe('urn:colors');
    expect(props.csCatId).toBe('accent1');
    expect(props.presAssocID).toBe('42');
  });

  // =========================================================================
  // Shape Properties Parsing
  // =========================================================================

  it('should parse shape properties with preset geometry', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:ptLst': {
          'dgm:pt': {
            '@_modelId': '1',
            'dgm:spPr': {
              'a:prstGeom': { '@_prst': 'roundRect' },
            },
          },
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.points[0].shapeProperties).toBeDefined();
    expect(result.points[0].shapeProperties!.presetGeometry).toBe('roundRect');
  });

  it('should parse shape transform (xfrm)', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:ptLst': {
          'dgm:pt': {
            '@_modelId': '1',
            'dgm:spPr': {
              'a:xfrm': {
                'a:off': { '@_x': 100, '@_y': 200 },
                'a:ext': { '@_cx': 300, '@_cy': 400 },
                '@_rot': 5400000,
                '@_flipH': '1',
              },
            },
          },
        },
      },
    };
    const result = parseDataModel(xml);
    const xfrm = result.points[0].shapeProperties!.xfrm!;
    expect(xfrm.offset).toEqual({ x: 100, y: 200 });
    expect(xfrm.extent).toEqual({ cx: 300, cy: 400 });
    expect(xfrm.rotation).toBe(5400000);
    expect(xfrm.flipH).toBe(true);
  });

  it('should parse solid fill', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:ptLst': {
          'dgm:pt': {
            '@_modelId': '1',
            'dgm:spPr': {
              'a:solidFill': {
                'a:schemeClr': {
                  '@_val': 'accent1',
                  'a:lumMod': { '@_val': 75000 },
                },
              },
            },
          },
        },
      },
    };
    const result = parseDataModel(xml);
    const fill = result.points[0].shapeProperties!.fill!;
    expect(fill.type).toBe('solid');
    if (fill.type === 'solid') {
      expect(fill.color.type).toBe('scheme');
      if (fill.color.type === 'scheme') {
        expect(fill.color.value).toBe('accent1');
        expect(fill.color.transforms).toHaveLength(1);
        expect(fill.color.transforms![0].type).toBe('lumMod');
        expect(fill.color.transforms![0].value).toBe(75000);
      }
    }
  });

  // =========================================================================
  // Connection Parsing
  // =========================================================================

  it('should parse connections', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:cxnLst': {
          'dgm:cxn': [
            {
              '@_modelId': '10',
              '@_type': 'parOf',
              '@_srcId': '0',
              '@_destId': '1',
              '@_srcOrd': 0,
              '@_destOrd': 0,
            },
            {
              '@_modelId': '11',
              '@_type': 'parOf',
              '@_srcId': '0',
              '@_destId': '2',
              '@_srcOrd': 1,
              '@_destOrd': 0,
            },
          ],
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.connections).toHaveLength(2);
    expect(result.connections[0].modelId).toBe('10');
    expect(result.connections[0].type).toBe('parOf');
    expect(result.connections[0].srcId).toBe('0');
    expect(result.connections[0].destId).toBe('1');
    expect(result.connections[0].srcOrd).toBe(0);
    expect(result.connections[0].destOrd).toBe(0);
    expect(result.connections[1].srcOrd).toBe(1);
  });

  it('should parse presOf connection type', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:cxnLst': {
          'dgm:cxn': {
            '@_modelId': '20',
            '@_type': 'presOf',
            '@_srcId': '1',
            '@_destId': '5',
            '@_srcOrd': 0,
            '@_destOrd': 0,
            '@_presId': 'urn:test',
          },
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.connections[0].type).toBe('presOf');
    expect(result.connections[0].presId).toBe('urn:test');
  });

  it('should parse connection with parTransId and sibTransId', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:cxnLst': {
          'dgm:cxn': {
            '@_modelId': '10',
            '@_type': 'parOf',
            '@_srcId': '0',
            '@_destId': '1',
            '@_srcOrd': 0,
            '@_destOrd': 0,
            '@_parTransId': '3',
            '@_sibTransId': '4',
          },
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.connections[0].parTransId).toBe('3');
    expect(result.connections[0].sibTransId).toBe('4');
  });

  it('should default connection type to parOf', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:cxnLst': {
          'dgm:cxn': {
            '@_modelId': '10',
            '@_srcId': '0',
            '@_destId': '1',
            '@_srcOrd': 0,
            '@_destOrd': 0,
          },
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.connections[0].type).toBe('parOf');
  });

  it('should handle invalid connection type as unknownRelationship', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:cxnLst': {
          'dgm:cxn': {
            '@_modelId': '10',
            '@_type': 'badType',
            '@_srcId': '0',
            '@_destId': '1',
            '@_srcOrd': 0,
            '@_destOrd': 0,
          },
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.connections[0].type).toBe('unknownRelationship');
  });

  it('should skip connections without required fields', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:cxnLst': {
          'dgm:cxn': [
            { '@_modelId': '10', '@_srcId': '0' }, // Missing destId
            { '@_modelId': '11', '@_srcId': '0', '@_destId': '1', '@_srcOrd': 0, '@_destOrd': 0 },
          ],
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0].modelId).toBe('11');
  });

  // =========================================================================
  // Background Parsing
  // =========================================================================

  it('should parse background with solid fill', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:bg': {
          'a:solidFill': {
            'a:srgbClr': { '@_val': 'FF0000' },
          },
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.background).toBeDefined();
    expect(result.background!.fill).toBeDefined();
    expect(result.background!.fill!.type).toBe('solid');
  });

  it('should parse background with no fill', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:bg': {
          'a:noFill': {},
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.background!.fill!.type).toBe('none');
  });

  // =========================================================================
  // Whole-Document Formatting
  // =========================================================================

  it('should parse whole-document line formatting', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:whole': {
          'a:ln': {
            '@_w': 12700,
            'a:solidFill': {
              'a:schemeClr': { '@_val': 'dk1' },
            },
          },
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.whole).toBeDefined();
    expect(result.whole!.line).toBeDefined();
    expect(result.whole!.line!.width).toBe(12700);
    expect(result.whole!.line!.fill).toBeDefined();
  });

  // =========================================================================
  // Complex / Round-Trip Scenarios
  // =========================================================================

  it('should parse a complete 3-node Diagram data model', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:ptLst': {
          'dgm:pt': [
            { '@_modelId': '0', '@_type': 'doc' },
            {
              '@_modelId': '1',
              '@_type': 'node',
              'dgm:t': {
                'a:bodyPr': {},
                'a:p': { 'a:r': { 'a:t': { '#text': 'Item A' } } },
              },
              'dgm:prSet': { '@_presName': 'node' },
            },
            {
              '@_modelId': '2',
              '@_type': 'node',
              'dgm:t': {
                'a:bodyPr': {},
                'a:p': { 'a:r': { 'a:t': { '#text': 'Item B' } } },
              },
            },
            {
              '@_modelId': '3',
              '@_type': 'node',
              'dgm:t': {
                'a:bodyPr': {},
                'a:p': { 'a:r': { 'a:t': { '#text': 'Item C' } } },
              },
            },
            { '@_modelId': '10', '@_type': 'parTrans', '@_cxnId': '100' },
            { '@_modelId': '11', '@_type': 'sibTrans' },
          ],
        },
        'dgm:cxnLst': {
          'dgm:cxn': [
            {
              '@_modelId': '100',
              '@_type': 'parOf',
              '@_srcId': '0',
              '@_destId': '1',
              '@_srcOrd': 0,
              '@_destOrd': 0,
            },
            {
              '@_modelId': '101',
              '@_type': 'parOf',
              '@_srcId': '0',
              '@_destId': '2',
              '@_srcOrd': 1,
              '@_destOrd': 0,
            },
            {
              '@_modelId': '102',
              '@_type': 'parOf',
              '@_srcId': '0',
              '@_destId': '3',
              '@_srcOrd': 2,
              '@_destOrd': 0,
            },
          ],
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.points).toHaveLength(6);
    expect(result.connections).toHaveLength(3);
    expect(result.points.filter((p) => p.type === 'node')).toHaveLength(3);
    expect(result.points.find((p) => p.modelId === '1')!.text!.paragraphs[0].runs[0].text).toBe(
      'Item A',
    );
    expect(result.points.find((p) => p.modelId === '10')!.cxnId).toBe('100');
  });

  it('should handle completely empty ptLst and cxnLst', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:ptLst': {},
        'dgm:cxnLst': {},
      },
    };
    const result = parseDataModel(xml);
    expect(result.points).toEqual([]);
    expect(result.connections).toEqual([]);
  });

  it('should parse norm and nonNorm point types', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:ptLst': {
          'dgm:pt': [
            { '@_modelId': '1', '@_type': 'norm' },
            { '@_modelId': '2', '@_type': 'nonNorm' },
            { '@_modelId': '3', '@_type': 'nonAsst' },
          ],
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.points[0].type).toBe('norm');
    expect(result.points[1].type).toBe('nonNorm');
    expect(result.points[2].type).toBe('nonAsst');
  });

  it('should parse presParOf connection type', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:cxnLst': {
          'dgm:cxn': {
            '@_modelId': '30',
            '@_type': 'presParOf',
            '@_srcId': '5',
            '@_destId': '6',
            '@_srcOrd': 0,
            '@_destOrd': 0,
          },
        },
      },
    };
    const result = parseDataModel(xml);
    expect(result.connections[0].type).toBe('presParOf');
  });

  it('should parse gradient fill', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:ptLst': {
          'dgm:pt': {
            '@_modelId': '1',
            'dgm:spPr': {
              'a:gradFill': {
                'a:gsLst': {
                  'a:gs': [
                    { '@_pos': 0, 'a:srgbClr': { '@_val': 'FF0000' } },
                    { '@_pos': 100000, 'a:srgbClr': { '@_val': '0000FF' } },
                  ],
                },
                'a:lin': { '@_ang': 5400000 },
              },
            },
          },
        },
      },
    };
    const result = parseDataModel(xml);
    const fill = result.points[0].shapeProperties!.fill!;
    expect(fill.type).toBe('gradient');
    if (fill.type === 'gradient') {
      expect(fill.stops).toHaveLength(2);
      expect(fill.stops[0].position).toBe(0);
      expect(fill.stops[1].position).toBe(100000);
      expect(fill.linear?.angle).toBe(5400000);
    }
  });

  it('should parse body properties with auto-fit', () => {
    const xml = {
      'dgm:dataModel': {
        'dgm:ptLst': {
          'dgm:pt': {
            '@_modelId': '1',
            'dgm:t': {
              'a:bodyPr': {
                '@_wrap': 'square',
                '@_lIns': 91440,
                '@_tIns': 45720,
                'a:normAutofit': { '@_fontScale': 80000 },
              },
              'a:p': { 'a:r': { 'a:t': { '#text': 'text' } } },
            },
          },
        },
      },
    };
    const result = parseDataModel(xml);
    const bodyProps = result.points[0].text!.bodyProperties;
    expect(bodyProps.wrap).toBe('square');
    expect(bodyProps.lIns).toBe(91440);
    expect(bodyProps.tIns).toBe(45720);
    expect(bodyProps.autoFit).toEqual({ type: 'normalAutoFit', fontScale: 80000 });
  });
});
