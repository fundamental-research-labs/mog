/**
 * Tests for Diagram Drawing Cache Parser
 */
import { parseDiagramDrawing } from '../../src/parser/drawing-parser';

describe('parseDiagramDrawing', () => {
  // =========================================================================
  // Basic structure
  // =========================================================================

  it('should parse an empty drawing', () => {
    const xml = { 'dsp:drawing': {} };
    const result = parseDiagramDrawing(xml);
    expect(result.shapeTree).toEqual([]);
  });

  it('should accept root element directly (no dsp:drawing wrapper)', () => {
    const xml = { 'dsp:spTree': {} };
    const result = parseDiagramDrawing(xml);
    expect(result.shapeTree).toEqual([]);
  });

  it('should parse an empty shape tree', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {},
      },
    };
    const result = parseDiagramDrawing(xml);
    expect(result.shapeTree).toEqual([]);
  });

  // =========================================================================
  // Individual Shape Parsing (dsp:sp)
  // =========================================================================

  it('should parse a single shape with modelId', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': { '@_modelId': 'abc-123' },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    expect(result.shapeTree).toHaveLength(1);
    expect(result.shapeTree[0]).toEqual({ modelId: 'abc-123' });
  });

  it('should parse multiple shapes', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': [
            { '@_modelId': 'shape-1' },
            { '@_modelId': 'shape-2' },
            { '@_modelId': 'shape-3' },
          ],
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    expect(result.shapeTree).toHaveLength(3);
  });

  it('should parse shape without modelId (decorative shape)', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {},
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    expect(result.shapeTree).toHaveLength(1);
    expect((result.shapeTree[0] as any).modelId).toBeUndefined();
  });

  // =========================================================================
  // Non-Visual Shape Properties
  // =========================================================================

  it('should parse non-visual shape properties', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:nvSpPr': {
              'dsp:cNvPr': {
                '@_id': 5,
                '@_name': 'Rectangle 1',
                '@_hidden': '1',
                '@_title': 'Main Node',
                '@_descr': 'The primary content node',
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.nvSpPr).toBeDefined();
    expect(shape.nvSpPr.id).toBe(5);
    expect(shape.nvSpPr.name).toBe('Rectangle 1');
    expect(shape.nvSpPr.hidden).toBe(true);
    expect(shape.nvSpPr.title).toBe('Main Node');
    expect(shape.nvSpPr.descr).toBe('The primary content node');
  });

  it('should parse non-visual properties with a:cNvPr fallback', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:nvSpPr': {
              'a:cNvPr': { '@_id': 3, '@_name': 'Fallback Shape' },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.nvSpPr.id).toBe(3);
    expect(shape.nvSpPr.name).toBe('Fallback Shape');
  });

  it('should return empty nvSpPr when cNvPr is missing', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:nvSpPr': {},
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.nvSpPr).toEqual({});
  });

  // =========================================================================
  // Cached Shape Properties
  // =========================================================================

  it('should parse shape properties with transform', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:spPr': {
              'a:xfrm': {
                'a:off': { '@_x': 100000, '@_y': 200000 },
                'a:ext': { '@_cx': 500000, '@_cy': 300000 },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.shapeProperties).toBeDefined();
    expect(shape.shapeProperties.xfrm).toBeDefined();
    expect(shape.shapeProperties.xfrm.offset).toEqual({ x: 100000, y: 200000 });
    expect(shape.shapeProperties.xfrm.extent).toEqual({ cx: 500000, cy: 300000 });
  });

  it('should parse shape properties with rotation and flip', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:spPr': {
              'a:xfrm': {
                '@_rot': 5400000,
                '@_flipH': '1',
                '@_flipV': '0',
                'a:off': { '@_x': 0, '@_y': 0 },
                'a:ext': { '@_cx': 100000, '@_cy': 100000 },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.shapeProperties.xfrm.rotation).toBe(5400000);
    expect(shape.shapeProperties.xfrm.flipH).toBe(true);
    expect(shape.shapeProperties.xfrm.flipV).toBe(false);
  });

  it('should parse shape properties with preset geometry', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:spPr': {
              'a:prstGeom': { '@_prst': 'roundRect' },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.shapeProperties.presetGeometry).toBe('roundRect');
  });

  it('should parse shape properties with solid fill', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:spPr': {
              'a:solidFill': {
                'a:schemeClr': { '@_val': 'accent1' },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.shapeProperties.fill).toBeDefined();
    expect(shape.shapeProperties.fill.type).toBe('solid');
    expect(shape.shapeProperties.fill.color.type).toBe('scheme');
    expect(shape.shapeProperties.fill.color.value).toBe('accent1');
  });

  it('should parse shape properties with line', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:spPr': {
              'a:ln': {
                '@_w': 12700,
                'a:solidFill': {
                  'a:srgbClr': { '@_val': 'FF0000' },
                },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.shapeProperties.line).toBeDefined();
    expect(shape.shapeProperties.line.width).toBe(12700);
    expect(shape.shapeProperties.line.fill.type).toBe('solid');
  });

  it('should parse spPr with a:spPr fallback', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'a:spPr': {
              'a:prstGeom': { '@_prst': 'ellipse' },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.shapeProperties.presetGeometry).toBe('ellipse');
  });

  // =========================================================================
  // Custom Geometry
  // =========================================================================

  it('should parse custom geometry with path list', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:spPr': {
              'a:custGeom': {
                'a:pathLst': {
                  'a:path': {
                    '@_w': 100000,
                    '@_h': 100000,
                    'a:moveTo': { 'a:pt': { '@_x': '0', '@_y': '0' } },
                    'a:lnTo': { 'a:pt': { '@_x': '100000', '@_y': '100000' } },
                    'a:close': {},
                  },
                },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.shapeProperties.customGeometry).toBeDefined();
    expect(shape.shapeProperties.customGeometry.pathLst).toHaveLength(1);
    const path = shape.shapeProperties.customGeometry.pathLst[0];
    expect(path.w).toBe(100000);
    expect(path.h).toBe(100000);
    expect(path.commands).toHaveLength(3);
    expect(path.commands[0]).toEqual({ type: 'moveTo', x: '0', y: '0' });
    expect(path.commands[1]).toEqual({ type: 'lineTo', x: '100000', y: '100000' });
    expect(path.commands[2]).toEqual({ type: 'close' });
  });

  it('should parse custom geometry with cubicBezTo commands', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:spPr': {
              'a:custGeom': {
                'a:pathLst': {
                  'a:path': {
                    'a:cubicBezTo': {
                      'a:pt': [
                        { '@_x': '10', '@_y': '20' },
                        { '@_x': '30', '@_y': '40' },
                        { '@_x': '50', '@_y': '60' },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    const cmd = shape.shapeProperties.customGeometry.pathLst[0].commands[0];
    expect(cmd).toEqual({
      type: 'cubicBezTo',
      x1: '10',
      y1: '20',
      x2: '30',
      y2: '40',
      x3: '50',
      y3: '60',
    });
  });

  it('should parse custom geometry with quadBezTo commands', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:spPr': {
              'a:custGeom': {
                'a:pathLst': {
                  'a:path': {
                    'a:quadBezTo': {
                      'a:pt': [
                        { '@_x': '10', '@_y': '20' },
                        { '@_x': '30', '@_y': '40' },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    const cmd = shape.shapeProperties.customGeometry.pathLst[0].commands[0];
    expect(cmd).toEqual({
      type: 'quadBezTo',
      x1: '10',
      y1: '20',
      x2: '30',
      y2: '40',
    });
  });

  it('should parse custom geometry with arcTo commands', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:spPr': {
              'a:custGeom': {
                'a:pathLst': {
                  'a:path': {
                    'a:arcTo': {
                      '@_wR': '50000',
                      '@_hR': '50000',
                      '@_stAng': '0',
                      '@_swAng': '5400000',
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    const cmd = shape.shapeProperties.customGeometry.pathLst[0].commands[0];
    expect(cmd).toEqual({
      type: 'arcTo',
      wR: '50000',
      hR: '50000',
      stAng: '0',
      swAng: '5400000',
    });
  });

  it('should parse custom geometry path with fill and stroke attributes', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:spPr': {
              'a:custGeom': {
                'a:pathLst': {
                  'a:path': {
                    '@_w': 200000,
                    '@_h': 150000,
                    '@_fill': 'none',
                    '@_stroke': '0',
                  },
                },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    const path = shape.shapeProperties.customGeometry.pathLst[0];
    expect(path.w).toBe(200000);
    expect(path.h).toBe(150000);
    expect(path.fill).toBe('none');
    expect(path.stroke).toBe(false);
  });

  it('should parse custom geometry with adjustment values', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:spPr': {
              'a:custGeom': {
                'a:avLst': {
                  'a:gd': [
                    { '@_name': 'adj1', '@_fmla': 'val 25000' },
                    { '@_name': 'adj2', '@_fmla': 'val 50000' },
                  ],
                },
                'a:pathLst': {},
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.shapeProperties.customGeometry.avLst).toEqual({
      adj1: 25000,
      adj2: 50000,
    });
  });

  it('should parse custom geometry with guide list', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:spPr': {
              'a:custGeom': {
                'a:gdLst': {
                  'a:gd': [
                    { '@_name': 'g0', '@_fmla': '*/ w 1 2' },
                    { '@_name': 'g1', '@_fmla': '*/ h 1 2' },
                  ],
                },
                'a:pathLst': {},
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.shapeProperties.customGeometry.gdLst).toEqual([
      { name: 'g0', formula: '*/ w 1 2' },
      { name: 'g1', formula: '*/ h 1 2' },
    ]);
  });

  it('should parse custom geometry with connection sites', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:spPr': {
              'a:custGeom': {
                'a:cxnLst': {
                  'a:cxn': {
                    '@_ang': '0',
                    'a:pos': { '@_x': '50000', '@_y': '0' },
                  },
                },
                'a:pathLst': {},
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.shapeProperties.customGeometry.cxnLst).toEqual([
      { angle: '0', x: '50000', y: '0' },
    ]);
  });

  // =========================================================================
  // Text Body
  // =========================================================================

  it('should parse text body with paragraphs and runs', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:txBody': {
              'a:bodyPr': { '@_anchor': 'ctr', '@_wrap': 'square' },
              'a:p': {
                'a:r': { 'a:t': { '#text': 'Hello World' } },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.textBody).toBeDefined();
    expect(shape.textBody.bodyProperties.anchor).toBe('ctr');
    expect(shape.textBody.paragraphs).toHaveLength(1);
    expect(shape.textBody.paragraphs[0].runs).toHaveLength(1);
    expect(shape.textBody.paragraphs[0].runs[0].text).toBe('Hello World');
  });

  it('should parse text body with a:txBody fallback', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'a:txBody': {
              'a:bodyPr': {},
              'a:p': {
                'a:r': { 'a:t': { '#text': 'Fallback text' } },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.textBody).toBeDefined();
    expect(shape.textBody.paragraphs[0].runs[0].text).toBe('Fallback text');
  });

  it('should parse text body with run properties', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:txBody': {
              'a:bodyPr': {},
              'a:p': {
                'a:r': {
                  'a:rPr': {
                    '@_b': '1',
                    '@_i': '1',
                    '@_sz': 1400,
                    'a:latin': { '@_typeface': 'Arial' },
                  },
                  'a:t': { '#text': 'Bold Italic' },
                },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    const run = shape.textBody.paragraphs[0].runs[0];
    expect(run.text).toBe('Bold Italic');
    expect(run.properties).toBeDefined();
    expect(run.properties.bold).toBe(true);
    expect(run.properties.italic).toBe(true);
    expect(run.properties.fontSize).toBe(1400);
    expect(run.properties.fontFamily).toBe('Arial');
  });

  // =========================================================================
  // Shape Style
  // =========================================================================

  it('should parse shape style with theme references', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:style': {
              'a:lnRef': {
                '@_idx': 2,
                'a:schemeClr': { '@_val': 'accent1' },
              },
              'a:fillRef': {
                '@_idx': 1,
                'a:schemeClr': { '@_val': 'accent2' },
              },
              'a:effectRef': { '@_idx': 0 },
              'a:fontRef': {
                '@_idx': 'minor',
                'a:schemeClr': { '@_val': 'dk1' },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.style).toBeDefined();
    expect(shape.style.lnRef.idx).toBe(2);
    expect(shape.style.lnRef.color).toBeDefined();
    expect(shape.style.lnRef.color.type).toBe('scheme');
    expect(shape.style.lnRef.color.value).toBe('accent1');
    expect(shape.style.fillRef.idx).toBe(1);
    expect(shape.style.effectRef.idx).toBe(0);
    expect(shape.style.fontRef.idx).toBe('minor');
    expect(shape.style.fontRef.color.type).toBe('scheme');
  });

  it('should parse style with a:style fallback', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'a:style': {
              'a:lnRef': { '@_idx': 1 },
              'a:fillRef': { '@_idx': 1 },
              'a:effectRef': { '@_idx': 0 },
              'a:fontRef': { '@_idx': 'minor' },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.style).toBeDefined();
    expect(shape.style.lnRef.idx).toBe(1);
  });

  it('should default theme ref idx to 0 when missing', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:style': {
              'a:lnRef': {},
              'a:fillRef': {},
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.style.lnRef.idx).toBe(0);
    expect(shape.style.fillRef.idx).toBe(0);
  });

  it('should default font ref idx to none when missing', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:style': {
              'a:fontRef': {},
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.style.fontRef.idx).toBe('none');
  });

  // =========================================================================
  // Group Shape Parsing (dsp:grpSp)
  // =========================================================================

  it('should parse a group shape', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:grpSp': {
            'dsp:sp': [{ '@_modelId': 'child-1' }, { '@_modelId': 'child-2' }],
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    expect(result.shapeTree).toHaveLength(1);
    const group = result.shapeTree[0] as any;
    expect(group.shapes).toBeDefined();
    expect(group.shapes).toHaveLength(2);
  });

  it('should parse group shape non-visual properties', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:grpSp': {
            'dsp:nvGrpSpPr': {
              'dsp:cNvPr': { '@_id': 10, '@_name': 'Group 1' },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const group = result.shapeTree[0] as any;
    expect(group.nvGrpSpPr).toBeDefined();
    expect(group.nvGrpSpPr.id).toBe(10);
    expect(group.nvGrpSpPr.name).toBe('Group 1');
  });

  it('should parse group shape properties with transform', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:grpSp': {
            'dsp:grpSpPr': {
              'a:xfrm': {
                'a:off': { '@_x': 0, '@_y': 0 },
                'a:ext': { '@_cx': 1000000, '@_cy': 500000 },
                'a:chOff': { '@_x': 100, '@_y': 200 },
                'a:chExt': { '@_cx': 800000, '@_cy': 400000 },
                '@_rot': 900000,
                '@_flipH': '1',
                '@_flipV': '0',
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const group = result.shapeTree[0] as any;
    expect(group.groupShapeProperties).toBeDefined();
    expect(group.groupShapeProperties.xfrm).toBeDefined();
    expect(group.groupShapeProperties.xfrm.offset).toEqual({ x: 0, y: 0 });
    expect(group.groupShapeProperties.xfrm.extent).toEqual({ cx: 1000000, cy: 500000 });
    expect(group.groupShapeProperties.xfrm.childOffset).toEqual({ x: 100, y: 200 });
    expect(group.groupShapeProperties.xfrm.childExtent).toEqual({ cx: 800000, cy: 400000 });
    expect(group.groupShapeProperties.xfrm.rotation).toBe(900000);
    expect(group.groupShapeProperties.xfrm.flipH).toBe(true);
    expect(group.groupShapeProperties.xfrm.flipV).toBe(false);
  });

  it('should parse group shape properties with a:grpSpPr fallback', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:grpSp': {
            'a:grpSpPr': {
              'a:xfrm': {
                'a:off': { '@_x': 50, '@_y': 50 },
                'a:ext': { '@_cx': 200000, '@_cy': 200000 },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const group = result.shapeTree[0] as any;
    expect(group.groupShapeProperties.xfrm.offset).toEqual({ x: 50, y: 50 });
  });

  it('should parse group shape properties with fill and line', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:grpSp': {
            'dsp:grpSpPr': {
              'a:solidFill': {
                'a:srgbClr': { '@_val': '00FF00' },
              },
              'a:ln': {
                '@_w': 9525,
                'a:solidFill': {
                  'a:srgbClr': { '@_val': '000000' },
                },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const group = result.shapeTree[0] as any;
    expect(group.groupShapeProperties.fill).toBeDefined();
    expect(group.groupShapeProperties.fill.type).toBe('solid');
    expect(group.groupShapeProperties.line).toBeDefined();
    expect(group.groupShapeProperties.line.width).toBe(9525);
  });

  it('should parse nested group shapes', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:grpSp': {
            'dsp:sp': { '@_modelId': 'shape-in-group' },
            'dsp:grpSp': {
              'dsp:sp': { '@_modelId': 'shape-in-nested-group' },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    expect(result.shapeTree).toHaveLength(1);
    const outerGroup = result.shapeTree[0] as any;
    expect(outerGroup.shapes).toHaveLength(2); // shape + nested group
    const nestedGroup = outerGroup.shapes[1];
    expect(nestedGroup.shapes).toHaveLength(1);
  });

  // =========================================================================
  // Mixed shape tree
  // =========================================================================

  it('should parse shape tree with both shapes and groups', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': [{ '@_modelId': 'standalone-1' }, { '@_modelId': 'standalone-2' }],
          'dsp:grpSp': {
            'dsp:sp': { '@_modelId': 'grouped-1' },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    // Shapes come first, then groups (based on parser implementation)
    expect(result.shapeTree).toHaveLength(3);
  });

  // =========================================================================
  // Complete scenario
  // =========================================================================

  it('should parse a complete drawing with all elements', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': [
            {
              '@_modelId': 'node-1',
              'dsp:nvSpPr': {
                'dsp:cNvPr': { '@_id': 1, '@_name': 'Rectangle 1' },
              },
              'dsp:spPr': {
                'a:xfrm': {
                  'a:off': { '@_x': 100000, '@_y': 100000 },
                  'a:ext': { '@_cx': 400000, '@_cy': 200000 },
                },
                'a:prstGeom': { '@_prst': 'roundRect' },
                'a:solidFill': {
                  'a:schemeClr': { '@_val': 'accent1' },
                },
                'a:ln': {
                  '@_w': 12700,
                  'a:solidFill': {
                    'a:schemeClr': { '@_val': 'accent1' },
                  },
                },
              },
              'dsp:txBody': {
                'a:bodyPr': { '@_anchor': 'ctr' },
                'a:p': {
                  'a:r': {
                    'a:rPr': { '@_b': '1', '@_sz': 1200 },
                    'a:t': { '#text': 'Node 1' },
                  },
                },
              },
              'dsp:style': {
                'a:lnRef': { '@_idx': 2 },
                'a:fillRef': { '@_idx': 1 },
                'a:effectRef': { '@_idx': 0 },
                'a:fontRef': { '@_idx': 'minor' },
              },
            },
            {
              '@_modelId': 'connector-1',
              'dsp:spPr': {
                'a:xfrm': {
                  'a:off': { '@_x': 500000, '@_y': 180000 },
                  'a:ext': { '@_cx': 100000, '@_cy': 40000 },
                },
                'a:prstGeom': { '@_prst': 'rightArrow' },
              },
            },
          ],
          'dsp:grpSp': {
            'dsp:nvGrpSpPr': {
              'dsp:cNvPr': { '@_id': 10, '@_name': 'Background Group' },
            },
            'dsp:grpSpPr': {
              'a:xfrm': {
                'a:off': { '@_x': 0, '@_y': 0 },
                'a:ext': { '@_cx': 1200000, '@_cy': 800000 },
              },
            },
            'dsp:sp': {
              '@_modelId': 'bg-shape',
              'dsp:spPr': {
                'a:prstGeom': { '@_prst': 'rect' },
                'a:noFill': {},
              },
            },
          },
        },
      },
    };

    const result = parseDiagramDrawing(xml);

    // 2 individual shapes + 1 group
    expect(result.shapeTree).toHaveLength(3);

    // Check node shape
    const node = result.shapeTree[0] as any;
    expect(node.modelId).toBe('node-1');
    expect(node.nvSpPr.name).toBe('Rectangle 1');
    expect(node.shapeProperties.xfrm.offset).toEqual({ x: 100000, y: 100000 });
    expect(node.shapeProperties.presetGeometry).toBe('roundRect');
    expect(node.shapeProperties.fill.type).toBe('solid');
    expect(node.textBody.paragraphs[0].runs[0].text).toBe('Node 1');
    expect(node.style.lnRef.idx).toBe(2);

    // Check connector shape
    const connector = result.shapeTree[1] as any;
    expect(connector.modelId).toBe('connector-1');
    expect(connector.shapeProperties.presetGeometry).toBe('rightArrow');

    // Check group
    const group = result.shapeTree[2] as any;
    expect(group.nvGrpSpPr.name).toBe('Background Group');
    expect(group.shapes).toHaveLength(1);
    expect(group.shapes[0].modelId).toBe('bg-shape');
    expect(group.shapes[0].shapeProperties.fill.type).toBe('none');
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  it('should handle custom geometry with only pathLst (no av/gd/cxn)', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:spPr': {
              'a:custGeom': {
                'a:pathLst': {
                  'a:path': {
                    'a:moveTo': { 'a:pt': { '@_x': '0', '@_y': '0' } },
                  },
                },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.shapeProperties.customGeometry.avLst).toBeUndefined();
    expect(shape.shapeProperties.customGeometry.gdLst).toBeUndefined();
    expect(shape.shapeProperties.customGeometry.cxnLst).toBeUndefined();
    expect(shape.shapeProperties.customGeometry.pathLst).toHaveLength(1);
  });

  it('should parse custom geometry even when base spPr has no other content', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:spPr': {
              'a:custGeom': {
                'a:pathLst': {
                  'a:path': {
                    'a:moveTo': { 'a:pt': { '@_x': '0', '@_y': '0' } },
                    'a:close': {},
                  },
                },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.shapeProperties).toBeDefined();
    expect(shape.shapeProperties.customGeometry).toBeDefined();
  });

  it('should handle multiple paths in pathLst', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:spPr': {
              'a:custGeom': {
                'a:pathLst': {
                  'a:path': [
                    {
                      '@_w': 100,
                      '@_h': 100,
                      'a:moveTo': { 'a:pt': { '@_x': '0', '@_y': '0' } },
                      'a:close': {},
                    },
                    {
                      '@_w': 200,
                      '@_h': 200,
                      'a:moveTo': { 'a:pt': { '@_x': '50', '@_y': '50' } },
                      'a:close': {},
                    },
                  ],
                },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const shape = result.shapeTree[0] as any;
    expect(shape.shapeProperties.customGeometry.pathLst).toHaveLength(2);
    expect(shape.shapeProperties.customGeometry.pathLst[0].w).toBe(100);
    expect(shape.shapeProperties.customGeometry.pathLst[1].w).toBe(200);
  });

  // =========================================================================
  // Document Order Preservation - Shape Tree (Bug 2)
  // =========================================================================

  it('should preserve z-order: group before shapes in document order', () => {
    // XML has group first, then shapes
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:grpSp': {
            'dsp:sp': { '@_modelId': 'grouped-shape' },
          },
          'dsp:sp': [{ '@_modelId': 'shape-1' }, { '@_modelId': 'shape-2' }],
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    expect(result.shapeTree).toHaveLength(3);
    // Group should come first (document order), then the two shapes
    const first = result.shapeTree[0] as any;
    expect(first.shapes).toBeDefined(); // it's a group
    expect(first.shapes[0].modelId).toBe('grouped-shape');

    const second = result.shapeTree[1] as any;
    expect(second.modelId).toBe('shape-1');

    const third = result.shapeTree[2] as any;
    expect(third.modelId).toBe('shape-2');
  });

  it('should preserve z-order: interleaved shapes and groups', () => {
    // XML has: sp(A), grp(B), sp(C) - but fast-xml-parser will group
    // same-type siblings under one key. Since sp appears twice as an array,
    // they share one key. The key order is: dsp:sp (first seen), dsp:grpSp.
    // So sp[A,C] come before grp[B] in key order.
    // This is a known limitation: fast-xml-parser groups same-name siblings.
    // True interleaving of same-name elements would require preserveOrder mode.
    // However, different-name elements DO preserve order.
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:grpSp': [
            { 'dsp:sp': { '@_modelId': 'g1-child' } },
            { 'dsp:sp': { '@_modelId': 'g2-child' } },
          ],
          'dsp:sp': { '@_modelId': 'standalone' },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    expect(result.shapeTree).toHaveLength(3);
    // Groups first (they appear first in key order), then shape
    const first = result.shapeTree[0] as any;
    expect(first.shapes).toBeDefined();
    expect(first.shapes[0].modelId).toBe('g1-child');

    const second = result.shapeTree[1] as any;
    expect(second.shapes).toBeDefined();
    expect(second.shapes[0].modelId).toBe('g2-child');

    const third = result.shapeTree[2] as any;
    expect(third.modelId).toBe('standalone');
  });

  // =========================================================================
  // Document Order Preservation - Geometry Path (Bug 3)
  // =========================================================================

  it('should preserve geometry path command order: lineTo before moveTo', () => {
    // Unusual but valid: lineTo appears before moveTo in the XML
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:spPr': {
              'a:custGeom': {
                'a:pathLst': {
                  'a:path': {
                    'a:lnTo': { 'a:pt': { '@_x': '100', '@_y': '100' } },
                    'a:moveTo': { 'a:pt': { '@_x': '0', '@_y': '0' } },
                    'a:close': {},
                  },
                },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const cmds = (result.shapeTree[0] as any).shapeProperties.customGeometry.pathLst[0].commands;
    expect(cmds).toHaveLength(3);
    expect(cmds[0].type).toBe('lineTo');
    expect(cmds[1].type).toBe('moveTo');
    expect(cmds[2].type).toBe('close');
  });

  it('should preserve geometry path command order: moveTo -> arcTo -> lineTo -> close', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:spPr': {
              'a:custGeom': {
                'a:pathLst': {
                  'a:path': {
                    'a:moveTo': { 'a:pt': { '@_x': '0', '@_y': '0' } },
                    'a:arcTo': { '@_wR': '50', '@_hR': '50', '@_stAng': '0', '@_swAng': '90' },
                    'a:lnTo': { 'a:pt': { '@_x': '100', '@_y': '100' } },
                    'a:close': {},
                  },
                },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const cmds = (result.shapeTree[0] as any).shapeProperties.customGeometry.pathLst[0].commands;
    expect(cmds).toHaveLength(4);
    expect(cmds[0].type).toBe('moveTo');
    expect(cmds[1].type).toBe('arcTo');
    expect(cmds[2].type).toBe('lineTo');
    expect(cmds[3].type).toBe('close');
  });

  it('should preserve geometry path command order: moveTo -> cubicBezTo -> quadBezTo -> close', () => {
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:spPr': {
              'a:custGeom': {
                'a:pathLst': {
                  'a:path': {
                    'a:moveTo': { 'a:pt': { '@_x': '0', '@_y': '0' } },
                    'a:cubicBezTo': {
                      'a:pt': [
                        { '@_x': '10', '@_y': '20' },
                        { '@_x': '30', '@_y': '40' },
                        { '@_x': '50', '@_y': '60' },
                      ],
                    },
                    'a:quadBezTo': {
                      'a:pt': [
                        { '@_x': '70', '@_y': '80' },
                        { '@_x': '90', '@_y': '100' },
                      ],
                    },
                    'a:close': {},
                  },
                },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const cmds = (result.shapeTree[0] as any).shapeProperties.customGeometry.pathLst[0].commands;
    expect(cmds).toHaveLength(4);
    expect(cmds[0].type).toBe('moveTo');
    expect(cmds[1].type).toBe('cubicBezTo');
    expect(cmds[2].type).toBe('quadBezTo');
    expect(cmds[3].type).toBe('close');
  });

  it('should preserve geometry path command order: close before lineTo', () => {
    // Multiple subpaths: moveTo -> close -> lineTo
    const xml = {
      'dsp:drawing': {
        'dsp:spTree': {
          'dsp:sp': {
            'dsp:spPr': {
              'a:custGeom': {
                'a:pathLst': {
                  'a:path': {
                    'a:moveTo': { 'a:pt': { '@_x': '0', '@_y': '0' } },
                    'a:close': {},
                    'a:lnTo': { 'a:pt': { '@_x': '50', '@_y': '50' } },
                  },
                },
              },
            },
          },
        },
      },
    };
    const result = parseDiagramDrawing(xml);
    const cmds = (result.shapeTree[0] as any).shapeProperties.customGeometry.pathLst[0].commands;
    expect(cmds).toHaveLength(3);
    expect(cmds[0].type).toBe('moveTo');
    expect(cmds[1].type).toBe('close');
    expect(cmds[2].type).toBe('lineTo');
  });
});
