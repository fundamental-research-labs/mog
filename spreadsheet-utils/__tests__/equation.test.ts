/**
 * Equation Contracts Tests
 *
 * Tests for equation-related type guards, schema utilities, and templates.
 */

import type {
  DelimiterNode,
  FractionNode,
  MathNode,
  MathRun,
  MatrixNode,
  NaryNode,
  OMath,
  RadicalNode,
} from '@mog-sdk/contracts/equation/omml-ast';
import {
  isDelimiter,
  isFraction,
  isMathRun,
  isMatrix,
  isNary,
  isOMath,
  isRadical,
} from '@mog/math-engine';
import type { EquationTemplateCategory } from '@mog-sdk/contracts/equation/templates';
import {
  ALL_EQUATION_TEMPLATES,
  FRACTION_TEMPLATES,
  INTEGRAL_TEMPLATES,
  LARGE_OPERATOR_TEMPLATES,
  MATRIX_TEMPLATES,
  RADICAL_TEMPLATES,
  SCRIPT_TEMPLATES,
  getTemplatesByCategory,
} from '@mog/math-engine';
import type { EquationId } from '@mog-sdk/contracts/equation/types';
import type { EquationObject, FloatingObject } from '@mog-sdk/contracts/objects/floating-objects';
import { isEquationObject } from '@mog/spreadsheet-utils/objects/floating-objects';

// =============================================================================
// OMML AST Type Guards
// =============================================================================

describe('OMML AST Type Guards', () => {
  describe('isOMath', () => {
    it('should return true for OMath nodes', () => {
      const node: OMath = {
        type: 'oMath',
        children: [],
      };
      expect(isOMath(node)).toBe(true);
    });

    it('should return false for non-OMath nodes', () => {
      const mathRun: MathRun = {
        type: 'r',
        text: 'x',
      };
      expect(isOMath(mathRun)).toBe(false);

      const fraction: FractionNode = {
        type: 'f',
        fractionType: 'bar',
        num: [],
        den: [],
      };
      expect(isOMath(fraction)).toBe(false);
    });
  });

  describe('isMathRun', () => {
    it('should return true for MathRun nodes', () => {
      const node: MathRun = {
        type: 'r',
        text: 'x',
      };
      expect(isMathRun(node)).toBe(true);
    });

    it('should return true for MathRun with properties', () => {
      const node: MathRun = {
        type: 'r',
        text: 'sin',
        rPr: {
          nor: true,
          sty: 'p',
        },
      };
      expect(isMathRun(node)).toBe(true);
    });

    it('should return false for non-MathRun nodes', () => {
      const fraction: FractionNode = {
        type: 'f',
        fractionType: 'bar',
        num: [],
        den: [],
      };
      expect(isMathRun(fraction)).toBe(false);
    });
  });

  describe('isFraction', () => {
    it('should return true for FractionNode nodes', () => {
      const node: FractionNode = {
        type: 'f',
        fractionType: 'bar',
        num: [],
        den: [],
      };
      expect(isFraction(node)).toBe(true);
    });

    it('should return true for all fraction types', () => {
      const barFraction: FractionNode = {
        type: 'f',
        fractionType: 'bar',
        num: [],
        den: [],
      };
      expect(isFraction(barFraction)).toBe(true);

      const skewedFraction: FractionNode = {
        type: 'f',
        fractionType: 'skw',
        num: [],
        den: [],
      };
      expect(isFraction(skewedFraction)).toBe(true);

      const linearFraction: FractionNode = {
        type: 'f',
        fractionType: 'lin',
        num: [],
        den: [],
      };
      expect(isFraction(linearFraction)).toBe(true);

      const noBarFraction: FractionNode = {
        type: 'f',
        fractionType: 'noBar',
        num: [],
        den: [],
      };
      expect(isFraction(noBarFraction)).toBe(true);
    });

    it('should return false for non-FractionNode nodes', () => {
      const radical: RadicalNode = {
        type: 'rad',
        degHide: true,
        deg: [],
        e: [],
      };
      expect(isFraction(radical)).toBe(false);
    });
  });

  describe('isRadical', () => {
    it('should return true for RadicalNode nodes', () => {
      const node: RadicalNode = {
        type: 'rad',
        degHide: true,
        deg: [],
        e: [],
      };
      expect(isRadical(node)).toBe(true);
    });

    it('should return true for n-th root (degHide: false)', () => {
      const nthRoot: RadicalNode = {
        type: 'rad',
        degHide: false,
        deg: [{ type: 'r', text: '3' }],
        e: [{ type: 'r', text: 'x' }],
      };
      expect(isRadical(nthRoot)).toBe(true);
    });

    it('should return false for non-RadicalNode nodes', () => {
      const fraction: FractionNode = {
        type: 'f',
        fractionType: 'bar',
        num: [],
        den: [],
      };
      expect(isRadical(fraction)).toBe(false);
    });
  });

  describe('isNary', () => {
    it('should return true for NaryNode nodes', () => {
      const node: NaryNode = {
        type: 'nary',
        chr: '\u2211', // Summation
        sub: [],
        sup: [],
        e: [],
      };
      expect(isNary(node)).toBe(true);
    });

    it('should return true for integrals', () => {
      const integral: NaryNode = {
        type: 'nary',
        chr: '\u222B', // Integral
        limLoc: 'subSup',
        sub: [{ type: 'r', text: '0' }],
        sup: [{ type: 'r', text: '1' }],
        e: [{ type: 'r', text: 'f(x)dx' }],
      };
      expect(isNary(integral)).toBe(true);
    });

    it('should return false for non-NaryNode nodes', () => {
      const mathRun: MathRun = {
        type: 'r',
        text: 'sum',
      };
      expect(isNary(mathRun)).toBe(false);
    });
  });

  describe('isMatrix', () => {
    it('should return true for MatrixNode nodes', () => {
      const node: MatrixNode = {
        type: 'm',
        mr: [[[]]],
      };
      expect(isMatrix(node)).toBe(true);
    });

    it('should return true for matrix with rows', () => {
      const matrix: MatrixNode = {
        type: 'm',
        mr: [
          [[{ type: 'r', text: 'a' }], [{ type: 'r', text: 'b' }]],
          [[{ type: 'r', text: 'c' }], [{ type: 'r', text: 'd' }]],
        ],
      };
      expect(isMatrix(matrix)).toBe(true);
    });

    it('should return false for non-MatrixNode nodes', () => {
      const delimiter: DelimiterNode = {
        type: 'd',
        begChr: '[',
        endChr: ']',
        e: [[]],
      };
      expect(isMatrix(delimiter)).toBe(false);
    });
  });

  describe('isDelimiter', () => {
    it('should return true for DelimiterNode nodes', () => {
      const node: DelimiterNode = {
        type: 'd',
        begChr: '(',
        endChr: ')',
        e: [[]],
      };
      expect(isDelimiter(node)).toBe(true);
    });

    it('should return true for different delimiter types', () => {
      const brackets: DelimiterNode = {
        type: 'd',
        begChr: '[',
        endChr: ']',
        e: [[{ type: 'r', text: 'x' }]],
      };
      expect(isDelimiter(brackets)).toBe(true);

      const braces: DelimiterNode = {
        type: 'd',
        begChr: '{',
        endChr: '}',
        e: [[{ type: 'r', text: 'y' }]],
      };
      expect(isDelimiter(braces)).toBe(true);

      const absoluteValue: DelimiterNode = {
        type: 'd',
        begChr: '|',
        endChr: '|',
        e: [[{ type: 'r', text: 'z' }]],
      };
      expect(isDelimiter(absoluteValue)).toBe(true);
    });

    it('should return false for non-DelimiterNode nodes', () => {
      const matrix: MatrixNode = {
        type: 'm',
        mr: [[[]]],
      };
      expect(isDelimiter(matrix)).toBe(false);
    });
  });

  describe('Type narrowing', () => {
    it('should allow accessing FractionNode-specific properties after type guard', () => {
      const node: MathNode = {
        type: 'f',
        fractionType: 'bar',
        num: [{ type: 'r', text: '1' }],
        den: [{ type: 'r', text: '2' }],
      };

      if (isFraction(node)) {
        // TypeScript should allow accessing these without error
        expect(node.fractionType).toBe('bar');
        expect(node.num).toHaveLength(1);
        expect(node.den).toHaveLength(1);
      }
    });

    it('should allow accessing NaryNode-specific properties after type guard', () => {
      const node: MathNode = {
        type: 'nary',
        chr: '\u2211',
        limLoc: 'undOvr',
        sub: [],
        sup: [],
        e: [],
      };

      if (isNary(node)) {
        expect(node.chr).toBe('\u2211');
        expect(node.limLoc).toBe('undOvr');
      }
    });
  });
});

// =============================================================================
// isEquationObject Type Guard
// =============================================================================

describe('isEquationObject', () => {
  const createBaseObject = (type: string) => ({
    id: 'test-123',
    type,
    sheetId: 'sheet-1',
    containerId: 'sheet-1',
    position: {
      anchorType: 'oneCell' as const,
      from: { cellId: 'cell-1', xOffset: 0, yOffset: 0 },
      width: 200,
      height: 100,
    },
    anchor: {
      anchorType: 'oneCell' as const,
      from: { cellId: 'cell-1', xOffset: 0, yOffset: 0 },
      width: 200,
      height: 100,
    },
    zIndex: 1,
    locked: false,
    printable: true,
  });

  it('should return true for equation objects', () => {
    const equationObj: EquationObject = {
      ...createBaseObject('equation'),
      type: 'equation',
      equation: {
        id: 'eq-1' as EquationId,
        omml: '<m:oMath/>',
        style: {
          fontFamily: 'Cambria Math',
          fontSize: 11,
          color: '#000000',
          backgroundColor: 'transparent',
          justification: 'center',
          displayMode: true,
          smallFractions: false,
        },
      },
    };
    expect(isEquationObject(equationObj)).toBe(true);
  });

  it('should return false for picture objects', () => {
    const pictureObj: FloatingObject = {
      ...createBaseObject('picture'),
      type: 'picture',
      src: 'data:image/png;base64,...',
      originalWidth: 400,
      originalHeight: 300,
    };
    expect(isEquationObject(pictureObj)).toBe(false);
  });

  it('should return false for textbox objects', () => {
    const textboxObj: FloatingObject = {
      ...createBaseObject('textbox'),
      type: 'textbox',
      content: 'Hello World',
    };
    expect(isEquationObject(textboxObj)).toBe(false);
  });

  it('should return false for shape objects', () => {
    const shapeObj: FloatingObject = {
      ...createBaseObject('shape'),
      type: 'shape',
      shapeType: 'rect',
    };
    expect(isEquationObject(shapeObj)).toBe(false);
  });

  it('should return false for chart objects', () => {
    const chartObj: FloatingObject = {
      ...createBaseObject('chart'),
      type: 'chart',
      chartType: 'bar',
      anchorMode: 'oneCell',
      widthCells: 8,
      heightCells: 15,
      chartConfig: { series: [] },
    };
    expect(isEquationObject(chartObj)).toBe(false);
  });
});

// =============================================================================
// Equation Templates
// =============================================================================

describe('Equation Templates', () => {
  describe('getTemplatesByCategory', () => {
    it('should return fraction templates for fractions category', () => {
      const templates = getTemplatesByCategory('fractions');

      expect(templates.length).toBeGreaterThan(0);
      expect(templates.every((t) => t.category === 'fractions')).toBe(true);
    });

    it('should return radical templates for radicals category', () => {
      const templates = getTemplatesByCategory('radicals');

      expect(templates.length).toBeGreaterThan(0);
      expect(templates.every((t) => t.category === 'radicals')).toBe(true);
    });

    it('should return integral templates for integrals category', () => {
      const templates = getTemplatesByCategory('integrals');

      expect(templates.length).toBeGreaterThan(0);
      expect(templates.every((t) => t.category === 'integrals')).toBe(true);
    });

    it('should return large operator templates for large-operators category', () => {
      const templates = getTemplatesByCategory('large-operators');

      expect(templates.length).toBeGreaterThan(0);
      expect(templates.every((t) => t.category === 'large-operators')).toBe(true);
    });

    it('should return matrix templates for matrices category', () => {
      const templates = getTemplatesByCategory('matrices');

      expect(templates.length).toBeGreaterThan(0);
      expect(templates.every((t) => t.category === 'matrices')).toBe(true);
    });

    it('should return script templates for scripts category', () => {
      const templates = getTemplatesByCategory('scripts');

      expect(templates.length).toBeGreaterThan(0);
      expect(templates.every((t) => t.category === 'scripts')).toBe(true);
    });

    it('should return empty array for category with no templates', () => {
      // Recent category is dynamic and may be empty
      const templates = getTemplatesByCategory('recent');
      expect(Array.isArray(templates)).toBe(true);
      // Recent templates are user-specific and likely empty in built-in templates
      expect(templates.every((t) => t.category === 'recent')).toBe(true);
    });

    it('should filter correctly from ALL_EQUATION_TEMPLATES', () => {
      const categories: EquationTemplateCategory[] = [
        'fractions',
        'radicals',
        'integrals',
        'large-operators',
        'matrices',
        'scripts',
      ];

      for (const category of categories) {
        const filtered = getTemplatesByCategory(category);
        const expected = ALL_EQUATION_TEMPLATES.filter((t) => t.category === category);
        expect(filtered).toEqual(expected);
      }
    });
  });

  describe('Template structure validation', () => {
    it('should have valid FRACTION_TEMPLATES', () => {
      expect(FRACTION_TEMPLATES.length).toBeGreaterThan(0);

      for (const template of FRACTION_TEMPLATES) {
        expect(template.id).toBeTruthy();
        expect(template.name).toBeTruthy();
        expect(template.category).toBe('fractions');
        expect(template.latex).toBeTruthy();
        expect(Array.isArray(template.placeholders)).toBe(true);
      }
    });

    it('should have valid RADICAL_TEMPLATES', () => {
      expect(RADICAL_TEMPLATES.length).toBeGreaterThan(0);

      for (const template of RADICAL_TEMPLATES) {
        expect(template.id).toBeTruthy();
        expect(template.name).toBeTruthy();
        expect(template.category).toBe('radicals');
        expect(template.latex).toBeTruthy();
        expect(Array.isArray(template.placeholders)).toBe(true);
      }
    });

    it('should have valid INTEGRAL_TEMPLATES', () => {
      expect(INTEGRAL_TEMPLATES.length).toBeGreaterThan(0);

      for (const template of INTEGRAL_TEMPLATES) {
        expect(template.id).toBeTruthy();
        expect(template.name).toBeTruthy();
        expect(template.category).toBe('integrals');
        expect(template.latex).toBeTruthy();
        expect(Array.isArray(template.placeholders)).toBe(true);
      }
    });

    it('should have valid LARGE_OPERATOR_TEMPLATES', () => {
      expect(LARGE_OPERATOR_TEMPLATES.length).toBeGreaterThan(0);

      for (const template of LARGE_OPERATOR_TEMPLATES) {
        expect(template.id).toBeTruthy();
        expect(template.name).toBeTruthy();
        expect(template.category).toBe('large-operators');
        expect(template.latex).toBeTruthy();
        expect(Array.isArray(template.placeholders)).toBe(true);
      }
    });

    it('should have valid MATRIX_TEMPLATES', () => {
      expect(MATRIX_TEMPLATES.length).toBeGreaterThan(0);

      for (const template of MATRIX_TEMPLATES) {
        expect(template.id).toBeTruthy();
        expect(template.name).toBeTruthy();
        expect(template.category).toBe('matrices');
        expect(template.latex).toBeTruthy();
        expect(Array.isArray(template.placeholders)).toBe(true);
      }
    });

    it('should have valid SCRIPT_TEMPLATES', () => {
      expect(SCRIPT_TEMPLATES.length).toBeGreaterThan(0);

      for (const template of SCRIPT_TEMPLATES) {
        expect(template.id).toBeTruthy();
        expect(template.name).toBeTruthy();
        expect(template.category).toBe('scripts');
        expect(template.latex).toBeTruthy();
        expect(Array.isArray(template.placeholders)).toBe(true);
      }
    });

    it('should have unique template IDs', () => {
      const ids = ALL_EQUATION_TEMPLATES.map((t) => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('ALL_EQUATION_TEMPLATES', () => {
    it('should combine all template arrays', () => {
      const expectedLength =
        FRACTION_TEMPLATES.length +
        RADICAL_TEMPLATES.length +
        INTEGRAL_TEMPLATES.length +
        LARGE_OPERATOR_TEMPLATES.length +
        MATRIX_TEMPLATES.length +
        SCRIPT_TEMPLATES.length;

      expect(ALL_EQUATION_TEMPLATES.length).toBe(expectedLength);
    });

    it('should contain templates from all categories', () => {
      const categories = new Set(ALL_EQUATION_TEMPLATES.map((t) => t.category));

      expect(categories.has('fractions')).toBe(true);
      expect(categories.has('radicals')).toBe(true);
      expect(categories.has('integrals')).toBe(true);
      expect(categories.has('large-operators')).toBe(true);
      expect(categories.has('matrices')).toBe(true);
      expect(categories.has('scripts')).toBe(true);
    });
  });
});
