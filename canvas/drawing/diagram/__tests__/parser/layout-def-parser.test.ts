/**
 * Tests for Diagram Layout Definition Parser
 */
import { parseLayoutDefinition } from '../../src/parser/layout-def-parser';

describe('parseLayoutDefinition', () => {
  // =========================================================================
  // Basic Structure
  // =========================================================================

  it('should parse empty layout definition', () => {
    const xml = { 'dgm:layoutDef': { '@_uniqueId': 'urn:test' } };
    const result = parseLayoutDefinition(xml);
    expect(result.uniqueId).toBe('urn:test');
    expect(result.categories).toEqual([]);
    expect(result.rootLayoutNode.kind).toBe('layoutNode');
    expect(result.rootLayoutNode.children).toEqual([]);
  });

  it('should parse title and description from elements', () => {
    const xml = {
      'dgm:layoutDef': {
        '@_uniqueId': 'urn:test',
        'dgm:title': { '@_val': 'My Layout' },
        'dgm:desc': { '@_val': 'Description here' },
      },
    };
    const result = parseLayoutDefinition(xml);
    expect(result.title).toBe('My Layout');
    expect(result.desc).toBe('Description here');
  });

  it('should accept root element directly', () => {
    const xml = { '@_uniqueId': 'urn:direct' };
    const result = parseLayoutDefinition(xml);
    expect(result.uniqueId).toBe('urn:direct');
  });

  // =========================================================================
  // Categories
  // =========================================================================

  it('should parse categories', () => {
    const xml = {
      'dgm:layoutDef': {
        '@_uniqueId': 'urn:test',
        'dgm:catLst': {
          'dgm:cat': [
            { '@_type': 'list', '@_pri': 1000 },
            { '@_type': 'hierarchy', '@_pri': 2000 },
          ],
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    expect(result.categories).toHaveLength(2);
    expect(result.categories[0]).toEqual({ type: 'list', priority: 1000 });
    expect(result.categories[1]).toEqual({ type: 'hierarchy', priority: 2000 });
  });

  // =========================================================================
  // Algorithm Parsing
  // =========================================================================

  it('should parse algorithm with type and params', () => {
    const xml = {
      'dgm:layoutDef': {
        '@_uniqueId': 'urn:test',
        'dgm:layoutNode': {
          'dgm:alg': {
            '@_type': 'lin',
            'dgm:param': [
              { '@_type': 'linDir', '@_val': 'fromL' },
              { '@_type': 'horzAlign', '@_val': 'ctr' },
            ],
          },
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    const alg = result.rootLayoutNode.algorithm!;
    expect(alg.type).toBe('lin');
    expect(alg.params.linDir).toBe('fromL');
    expect(alg.params.horzAlign).toBe('ctr');
  });

  it('should handle all algorithm types', () => {
    const algTypes = [
      'composite',
      'lin',
      'snake',
      'cycle',
      'hierRoot',
      'hierChild',
      'pyra',
      'conn',
      'tx',
      'sp',
    ];
    for (const algType of algTypes) {
      const xml = {
        'dgm:layoutDef': {
          'dgm:layoutNode': {
            'dgm:alg': { '@_type': algType },
          },
        },
      };
      const result = parseLayoutDefinition(xml);
      expect(result.rootLayoutNode.algorithm!.type).toBe(algType);
    }
  });

  it('should default invalid algorithm type to composite', () => {
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          'dgm:alg': { '@_type': 'unknownAlg' },
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    expect(result.rootLayoutNode.algorithm!.type).toBe('composite');
  });

  // =========================================================================
  // Shape Parsing
  // =========================================================================

  it('should parse shape definition', () => {
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          'dgm:shape': {
            '@_type': 'roundRect',
            '@_rot': 90,
            '@_zOrderOff': 1,
            '@_hideGeom': '1',
            '@_lkTxEntry': '1',
            '@_blipPhldr': '0',
          },
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    const shape = result.rootLayoutNode.shape!;
    expect(shape.type).toBe('roundRect');
    expect(shape.rot).toBe(90);
    expect(shape.zOrderOff).toBe(1);
    expect(shape.hideGeom).toBe(true);
    expect(shape.lkTxEntry).toBe(true);
    expect(shape.blipPhldr).toBe(false);
  });

  it('should parse shape adjustments', () => {
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          'dgm:shape': {
            '@_type': 'roundRect',
            'dgm:adjLst': {
              'dgm:adj': [
                { '@_idx': 'adj1', '@_val': 16667 },
                { '@_idx': 'adj2', '@_val': 50000 },
              ],
            },
          },
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    expect(result.rootLayoutNode.shape!.adjustments).toEqual({
      adj1: 16667,
      adj2: 50000,
    });
  });

  // =========================================================================
  // PresOf Parsing
  // =========================================================================

  it('should parse presOf mapping', () => {
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          'dgm:presOf': {
            '@_axis': 'ch',
            '@_ptType': 'node',
            '@_cnt': 3,
            '@_st': 1,
            '@_step': 2,
            '@_hideLastTrans': '1',
          },
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    const presOf = result.rootLayoutNode.presOf!;
    expect(presOf.axis).toBe('ch');
    expect(presOf.ptType).toBe('node');
    expect(presOf.cnt).toBe(3);
    expect(presOf.st).toBe(1);
    expect(presOf.step).toBe(2);
    expect(presOf.hideLastTrans).toBe(true);
  });

  // =========================================================================
  // Constraint Parsing
  // =========================================================================

  it('should parse constraint list', () => {
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          'dgm:constrLst': {
            'dgm:constr': [
              { '@_type': 'w', '@_for': 'ch', '@_forName': 'node1', '@_val': 100, '@_op': 'equ' },
              { '@_type': 'h', '@_refType': 'w', '@_fact': 0.5, '@_refFor': 'self' },
            ],
          },
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    const constraints = result.rootLayoutNode.constraints!;
    expect(constraints).toHaveLength(2);

    expect(constraints[0].type).toBe('w');
    expect(constraints[0].for).toBe('ch');
    expect(constraints[0].forName).toBe('node1');
    expect(constraints[0].val).toBe(100);
    expect(constraints[0].op).toBe('equ');

    expect(constraints[1].type).toBe('h');
    expect(constraints[1].refType).toBe('w');
    expect(constraints[1].fact).toBe(0.5);
    expect(constraints[1].refFor).toBe('self');
  });

  it('should use constraint defaults', () => {
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          'dgm:constrLst': {
            'dgm:constr': { '@_type': 'w' },
          },
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    const c = result.rootLayoutNode.constraints![0];
    expect(c.for).toBe('self');
    expect(c.forName).toBe('');
    expect(c.refType).toBe('none');
    expect(c.refFor).toBe('self');
    expect(c.refForName).toBe('');
    expect(c.op).toBe('equ');
    expect(c.val).toBe(0);
    expect(c.fact).toBe(1);
    expect(c.ptType).toBe('all');
    expect(c.refPtType).toBe('all');
  });

  // =========================================================================
  // Rule Parsing
  // =========================================================================

  it('should parse rule list', () => {
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          'dgm:ruleLst': {
            'dgm:rule': {
              '@_type': 'primFontSz',
              '@_for': 'ch',
              '@_val': 5,
              '@_fact': 0.8,
              '@_max': 40,
            },
          },
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    const rules = result.rootLayoutNode.rules!;
    expect(rules).toHaveLength(1);
    expect(rules[0].type).toBe('primFontSz');
    expect(rules[0].for).toBe('ch');
    expect(rules[0].val).toBe(5);
    expect(rules[0].fact).toBe(0.8);
    expect(rules[0].max).toBe(40);
  });

  it('should default rule max to Number.MAX_SAFE_INTEGER', () => {
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          'dgm:ruleLst': {
            'dgm:rule': { '@_type': 'w' },
          },
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    expect(result.rootLayoutNode.rules![0].max).toBe(Number.MAX_SAFE_INTEGER);
  });

  // =========================================================================
  // Variable List
  // =========================================================================

  it('should parse variable list', () => {
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          'dgm:varLst': {
            'dgm:orgChart': { '@_val': '1' },
            'dgm:chMax': { '@_val': 5 },
            'dgm:chPref': { '@_val': 3 },
            'dgm:bulletEnabled': { '@_val': '1' },
            'dgm:dir': { '@_val': 'rev' },
            'dgm:hierBranch': { '@_val': 'hang' },
            'dgm:animOne': { '@_val': 'one' },
            'dgm:animLvl': { '@_val': 'lvl' },
            'dgm:resizeHandles': { '@_val': 'exact' },
          },
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    const varLst = result.rootLayoutNode.varLst!;
    expect(varLst.orgChart).toBe(true);
    expect(varLst.chMax).toBe(5);
    expect(varLst.chPref).toBe(3);
    expect(varLst.bulletEnabled).toBe(true);
    expect(varLst.dir).toBe('rev');
    expect(varLst.hierBranch).toBe('hang');
    expect(varLst.animOne).toBe('one');
    expect(varLst.animLvl).toBe('lvl');
    expect(varLst.resizeHandles).toBe('exact');
  });

  it('should use defaults for missing variables', () => {
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          'dgm:varLst': {},
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    const varLst = result.rootLayoutNode.varLst!;
    expect(varLst.orgChart).toBe(false);
    expect(varLst.chMax).toBe(-1);
    expect(varLst.dir).toBe('norm');
    expect(varLst.resizeHandles).toBe('rel');
  });

  // =========================================================================
  // ForEach Parsing
  // =========================================================================

  it('should parse forEach with children', () => {
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          'dgm:forEach': {
            '@_name': 'forEachNode',
            '@_axis': 'ch',
            '@_ptType': 'node',
            '@_cnt': 5,
            '@_st': 2,
            '@_step': 1,
            '@_hideLastTrans': '0',
            'dgm:layoutNode': { '@_name': 'innerNode' },
          },
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    const forEach = result.rootLayoutNode.children[0];
    expect(forEach.kind).toBe('forEach');
    if (forEach.kind === 'forEach') {
      expect(forEach.name).toBe('forEachNode');
      expect(forEach.axis).toBe('ch');
      expect(forEach.ptType).toBe('node');
      expect(forEach.cnt).toBe(5);
      expect(forEach.st).toBe(2);
      expect(forEach.step).toBe(1);
      expect(forEach.hideLastTrans).toBe(false);
      expect(forEach.children).toHaveLength(1);
    }
  });

  it('should parse forEach defaults', () => {
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          'dgm:forEach': {},
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    const forEach = result.rootLayoutNode.children[0];
    if (forEach.kind === 'forEach') {
      expect(forEach.name).toBe('');
      expect(forEach.ref).toBe('');
      expect(forEach.axis).toBe('ch');
      expect(forEach.ptType).toBe('all');
      expect(forEach.cnt).toBe(0);
      expect(forEach.st).toBe(1);
      expect(forEach.step).toBe(1);
      expect(forEach.hideLastTrans).toBe(true);
    }
  });

  // =========================================================================
  // Choose / If / Else Parsing
  // =========================================================================

  it('should parse choose with if and else clauses', () => {
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          'dgm:choose': {
            '@_name': 'myChoice',
            'dgm:if': [
              {
                '@_name': 'if1',
                '@_func': 'cnt',
                '@_op': 'gte',
                '@_val': '3',
                '@_axis': 'ch',
                '@_ptType': 'node',
                'dgm:layoutNode': { '@_name': 'manyNodes' },
              },
              {
                '@_name': 'if2',
                '@_func': 'var',
                '@_arg': 'dir',
                '@_op': 'equ',
                '@_val': 'norm',
              },
            ],
            'dgm:else': {
              '@_name': 'elseClause',
              'dgm:layoutNode': { '@_name': 'defaultNode' },
            },
          },
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    const choose = result.rootLayoutNode.children[0];
    expect(choose.kind).toBe('choose');
    if (choose.kind === 'choose') {
      expect(choose.name).toBe('myChoice');
      expect(choose.ifClauses).toHaveLength(2);

      const if1 = choose.ifClauses[0];
      expect(if1.name).toBe('if1');
      expect(if1.func).toBe('cnt');
      expect(if1.op).toBe('gte');
      expect(if1.val).toBe('3');
      expect(if1.axis).toBe('ch');
      expect(if1.ptType).toBe('node');
      expect(if1.children).toHaveLength(1);

      const if2 = choose.ifClauses[1];
      expect(if2.func).toBe('var');
      expect(if2.arg).toBe('dir');
      expect(if2.val).toBe('norm');

      expect(choose.elseClauses).not.toBeNull();
      expect(choose.elseClauses!.name).toBe('elseClause');
      expect(choose.elseClauses!.children).toHaveLength(1);
    }
  });

  it('should parse choose without else', () => {
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          'dgm:choose': {
            'dgm:if': {
              '@_func': 'cnt',
              '@_op': 'equ',
              '@_val': '1',
            },
          },
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    const choose = result.rootLayoutNode.children[0];
    if (choose.kind === 'choose') {
      expect(choose.elseClauses).toBeNull();
    }
  });

  // =========================================================================
  // Layout Node Properties
  // =========================================================================

  it('should parse layout node with styleLbl and moveWith', () => {
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          '@_name': 'root',
          '@_styleLbl': 'node1',
          '@_moveWith': 'parent',
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    expect(result.rootLayoutNode.name).toBe('root');
    expect(result.rootLayoutNode.styleLbl).toBe('node1');
    expect(result.rootLayoutNode.moveWith).toBe('parent');
  });

  // =========================================================================
  // Nested / Recursive Structures
  // =========================================================================

  it('should parse nested forEach inside choose', () => {
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          'dgm:choose': {
            'dgm:if': {
              '@_func': 'cnt',
              '@_op': 'gt',
              '@_val': '0',
              '@_axis': 'ch',
              'dgm:forEach': {
                '@_axis': 'ch',
                '@_ptType': 'node',
                'dgm:layoutNode': { '@_name': 'item' },
              },
            },
            'dgm:else': {},
          },
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    const choose = result.rootLayoutNode.children[0];
    if (choose.kind === 'choose') {
      const ifChildren = choose.ifClauses[0].children;
      expect(ifChildren).toHaveLength(1);
      expect(ifChildren[0].kind).toBe('forEach');
    }
  });

  it('should parse minVer and defStyle attributes', () => {
    const xml = {
      'dgm:layoutDef': {
        '@_uniqueId': 'urn:test',
        '@_minVer': 'http://schemas.openxmlformats.org/drawingml/2006/diagram',
        '@_defStyle': 'node1',
      },
    };
    const result = parseLayoutDefinition(xml);
    expect(result.minVer).toBe('http://schemas.openxmlformats.org/drawingml/2006/diagram');
    expect(result.defStyle).toBe('node1');
  });

  // =========================================================================
  // Sample Data
  // =========================================================================

  it('should parse sample data with useDefault', () => {
    const xml = {
      'dgm:layoutDef': {
        '@_uniqueId': 'urn:test',
        'dgm:sampData': { '@_useDef': '1' },
        'dgm:styleData': { '@_useDef': 'true' },
      },
    };
    const result = parseLayoutDefinition(xml);
    expect(result.sampData?.useDefault).toBe(true);
    expect(result.styleData?.useDefault).toBe(true);
  });

  it('should handle complex layout with multiple children types', () => {
    const xml = {
      'dgm:layoutDef': {
        '@_uniqueId': 'urn:complex',
        'dgm:layoutNode': {
          '@_name': 'root',
          'dgm:alg': { '@_type': 'composite' },
          'dgm:shape': { '@_type': 'rect' },
          'dgm:constrLst': {
            'dgm:constr': [
              { '@_type': 'w', '@_val': 100 },
              { '@_type': 'h', '@_val': 50 },
            ],
          },
          'dgm:layoutNode': { '@_name': 'static_child' },
          'dgm:forEach': {
            '@_axis': 'ch',
            'dgm:layoutNode': { '@_name': 'dynamic_child' },
          },
          'dgm:choose': {
            'dgm:if': { '@_func': 'cnt', '@_op': 'equ', '@_val': '0' },
          },
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    expect(result.rootLayoutNode.algorithm!.type).toBe('composite');
    expect(result.rootLayoutNode.shape!.type).toBe('rect');
    expect(result.rootLayoutNode.constraints).toHaveLength(2);
    // Should have 3 children: layoutNode, forEach, choose
    expect(result.rootLayoutNode.children).toHaveLength(3);
  });

  // =========================================================================
  // Document Order Preservation
  // =========================================================================

  it('should preserve document order: forEach before layoutNode', () => {
    // XML order: forEach, then layoutNode
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          '@_name': 'root',
          'dgm:forEach': {
            '@_name': 'loop1',
            '@_axis': 'ch',
          },
          'dgm:layoutNode': { '@_name': 'static1' },
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    const kids = result.rootLayoutNode.children;
    expect(kids).toHaveLength(2);
    expect(kids[0].kind).toBe('forEach');
    expect(kids[1].kind).toBe('layoutNode');
    if (kids[0].kind === 'forEach') {
      expect(kids[0].name).toBe('loop1');
    }
    if (kids[1].kind === 'layoutNode') {
      expect(kids[1].name).toBe('static1');
    }
  });

  it('should preserve document order: choose before forEach before layoutNode', () => {
    // XML order: choose, forEach, layoutNode
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          '@_name': 'root',
          'dgm:choose': {
            '@_name': 'cond1',
            'dgm:if': { '@_func': 'cnt', '@_op': 'equ', '@_val': '1' },
          },
          'dgm:forEach': {
            '@_name': 'loop1',
            '@_axis': 'ch',
          },
          'dgm:layoutNode': { '@_name': 'static1' },
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    const kids = result.rootLayoutNode.children;
    expect(kids).toHaveLength(3);
    expect(kids[0].kind).toBe('choose');
    expect(kids[1].kind).toBe('forEach');
    expect(kids[2].kind).toBe('layoutNode');
  });

  it('should preserve document order: layoutNode between two forEachs', () => {
    // XML order: forEach, layoutNode, forEach
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          '@_name': 'root',
          'dgm:forEach': [
            { '@_name': 'loop1', '@_axis': 'ch' },
            { '@_name': 'loop2', '@_axis': 'des' },
          ],
          'dgm:layoutNode': { '@_name': 'middle' },
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    const kids = result.rootLayoutNode.children;
    // fast-xml-parser groups same-name siblings into an array under one key,
    // so the two forEachs come before the layoutNode in key order
    expect(kids).toHaveLength(3);
    expect(kids[0].kind).toBe('forEach');
    expect(kids[1].kind).toBe('forEach');
    expect(kids[2].kind).toBe('layoutNode');
    if (kids[0].kind === 'forEach') expect(kids[0].name).toBe('loop1');
    if (kids[1].kind === 'forEach') expect(kids[1].name).toBe('loop2');
    if (kids[2].kind === 'layoutNode') expect(kids[2].name).toBe('middle');
  });

  it('should preserve document order inside forEach children', () => {
    // forEach containing: choose, then layoutNode
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          'dgm:forEach': {
            '@_axis': 'ch',
            'dgm:choose': {
              '@_name': 'innerChoice',
              'dgm:if': { '@_func': 'cnt', '@_op': 'gt', '@_val': '0' },
            },
            'dgm:layoutNode': { '@_name': 'innerNode' },
          },
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    const forEach = result.rootLayoutNode.children[0];
    expect(forEach.kind).toBe('forEach');
    if (forEach.kind === 'forEach') {
      expect(forEach.children).toHaveLength(2);
      expect(forEach.children[0].kind).toBe('choose');
      expect(forEach.children[1].kind).toBe('layoutNode');
    }
  });

  it('should preserve document order inside if clause children', () => {
    // if containing: layoutNode, then forEach
    const xml = {
      'dgm:layoutDef': {
        'dgm:layoutNode': {
          'dgm:choose': {
            'dgm:if': {
              '@_func': 'cnt',
              '@_op': 'gt',
              '@_val': '0',
              'dgm:layoutNode': { '@_name': 'first' },
              'dgm:forEach': { '@_name': 'second', '@_axis': 'ch' },
            },
          },
        },
      },
    };
    const result = parseLayoutDefinition(xml);
    const choose = result.rootLayoutNode.children[0];
    expect(choose.kind).toBe('choose');
    if (choose.kind === 'choose') {
      const ifChildren = choose.ifClauses[0].children;
      expect(ifChildren).toHaveLength(2);
      expect(ifChildren[0].kind).toBe('layoutNode');
      expect(ifChildren[1].kind).toBe('forEach');
    }
  });
});
