/**
 * Cell Text Style Tests
 *
 * Tests for the canonical cell styling source of truth.
 * Verifies that resolveCellTextStyle correctly derives complete styles from formats.
 */

import {
  DEFAULT_CELL_STYLE,
  resolveCellTextColor,
  resolveCellTextStyle,
} from '@mog/spreadsheet-utils/cells/cell-style';
import type { CellTextStyle } from '@mog-sdk/contracts/cells/cell-style';
import type { CellFormat } from '@mog-sdk/contracts/core';

describe('Cell Text Style', () => {
  describe('DEFAULT_CELL_STYLE', () => {
    it('should define all required defaults', () => {
      expect(DEFAULT_CELL_STYLE.fontSize).toBe(12);
      expect(DEFAULT_CELL_STYLE.fontFamily).toContain('Inter');
      expect(DEFAULT_CELL_STYLE.fontColor).toBe('#000000');
      expect(DEFAULT_CELL_STYLE.padding).toBe(4);
      expect(DEFAULT_CELL_STYLE.horizontalAlign).toBe('left');
      // Excel default vertical alignment is 'bottom'
      expect(DEFAULT_CELL_STYLE.verticalAlign).toBe('bottom');
    });

    it('should match Excel-like defaults', () => {
      // Default font size should be 12 (Excel default is 11, but we use 12 for readability)
      expect(DEFAULT_CELL_STYLE.fontSize).toBeGreaterThanOrEqual(11);
      expect(DEFAULT_CELL_STYLE.fontSize).toBeLessThanOrEqual(14);

      // Padding should be small but non-zero for readability
      expect(DEFAULT_CELL_STYLE.padding).toBeGreaterThan(0);
      expect(DEFAULT_CELL_STYLE.padding).toBeLessThanOrEqual(8);
    });
  });

  describe('resolveCellTextStyle', () => {
    describe('with undefined format', () => {
      it('should return all defaults', () => {
        const style = resolveCellTextStyle(undefined);

        expect(style.fontSize).toBe(DEFAULT_CELL_STYLE.fontSize);
        expect(style.fontFamily).toBe(DEFAULT_CELL_STYLE.fontFamily);
        expect(style.color).toBe(DEFAULT_CELL_STYLE.fontColor);
        expect(style.paddingX).toBe(DEFAULT_CELL_STYLE.padding);
        expect(style.textAlign).toBe(DEFAULT_CELL_STYLE.horizontalAlign);
        expect(style.verticalAlign).toBe(DEFAULT_CELL_STYLE.verticalAlign);
      });

      it('should have correct typography defaults', () => {
        const style = resolveCellTextStyle(undefined);

        expect(style.fontWeight).toBe('normal');
        expect(style.fontStyle).toBe('normal');
        expect(style.textDecoration).toBe('none');
        expect(style.lineHeight).toBe(1);
      });

      it('should have undefined background (transparent)', () => {
        const style = resolveCellTextStyle(undefined);
        expect(style.backgroundColor).toBeUndefined();
      });
    });

    describe('with empty format object', () => {
      it('should return all defaults', () => {
        const style = resolveCellTextStyle({});

        expect(style.fontSize).toBe(DEFAULT_CELL_STYLE.fontSize);
        expect(style.fontFamily).toBe(DEFAULT_CELL_STYLE.fontFamily);
        expect(style.fontWeight).toBe('normal');
        expect(style.fontStyle).toBe('normal');
      });
    });

    describe('font size', () => {
      it('should use format fontSize when provided', () => {
        const format: CellFormat = { fontSize: 18 };
        const style = resolveCellTextStyle(format);
        expect(style.fontSize).toBe(18);
      });

      it('should handle small font sizes', () => {
        const format: CellFormat = { fontSize: 8 };
        const style = resolveCellTextStyle(format);
        expect(style.fontSize).toBe(8);
      });

      it('should handle large font sizes', () => {
        const format: CellFormat = { fontSize: 72 };
        const style = resolveCellTextStyle(format);
        expect(style.fontSize).toBe(72);
      });
    });

    describe('font family', () => {
      it('should use format fontFamily when provided', () => {
        const format: CellFormat = { fontFamily: 'Arial' };
        const style = resolveCellTextStyle(format);
        expect(style.fontFamily).toBe('Arial');
      });

      it('should use format fontFamily with fallbacks', () => {
        const format: CellFormat = { fontFamily: 'Comic Sans MS, cursive' };
        const style = resolveCellTextStyle(format);
        expect(style.fontFamily).toBe('Comic Sans MS, cursive');
      });
    });

    describe('font weight (bold)', () => {
      it('should return bold when format.bold is true', () => {
        const format: CellFormat = { bold: true };
        const style = resolveCellTextStyle(format);
        expect(style.fontWeight).toBe('bold');
      });

      it('should return normal when format.bold is false', () => {
        const format: CellFormat = { bold: false };
        const style = resolveCellTextStyle(format);
        expect(style.fontWeight).toBe('normal');
      });
    });

    describe('font style (italic)', () => {
      it('should return italic when format.italic is true', () => {
        const format: CellFormat = { italic: true };
        const style = resolveCellTextStyle(format);
        expect(style.fontStyle).toBe('italic');
      });

      it('should return normal when format.italic is false', () => {
        const format: CellFormat = { italic: false };
        const style = resolveCellTextStyle(format);
        expect(style.fontStyle).toBe('normal');
      });
    });

    describe('text decoration', () => {
      it('should return underline when format.underlineType is true', () => {
        const format: CellFormat = { underlineType: 'single' };
        const style = resolveCellTextStyle(format);
        expect(style.textDecoration).toBe('underline');
      });

      it('should return line-through when format.strikethrough is true', () => {
        const format: CellFormat = { strikethrough: true };
        const style = resolveCellTextStyle(format);
        expect(style.textDecoration).toBe('line-through');
      });

      it('should combine underline and strikethrough', () => {
        const format: CellFormat = { underlineType: 'single', strikethrough: true };
        const style = resolveCellTextStyle(format);
        expect(style.textDecoration).toBe('underline line-through');
      });

      it('should return none when neither is set', () => {
        const format: CellFormat = { underlineType: 'none', strikethrough: false };
        const style = resolveCellTextStyle(format);
        expect(style.textDecoration).toBe('none');
      });
    });

    describe('text color', () => {
      it('should use format fontColor when provided', () => {
        const format: CellFormat = { fontColor: '#ff0000' };
        const style = resolveCellTextStyle(format);
        expect(style.color).toBe('#ff0000');
      });

      it('should handle named colors', () => {
        const format: CellFormat = { fontColor: 'red' };
        const style = resolveCellTextStyle(format);
        expect(style.color).toBe('red');
      });

      it('should handle rgba colors', () => {
        const format: CellFormat = { fontColor: 'rgba(255, 0, 0, 0.5)' };
        const style = resolveCellTextStyle(format);
        expect(style.color).toBe('rgba(255, 0, 0, 0.5)');
      });

      it('should resolve default black as automatic when a renderer default is provided', () => {
        for (const fontColor of ['#000000', '#000', 'rgb(0, 0, 0)']) {
          expect(resolveCellTextColor({ fontColor }, '#f4f7f5')).toBe('#f4f7f5');
          expect(resolveCellTextStyle({ fontColor }, undefined, '#f4f7f5').color).toBe('#f4f7f5');
        }
      });

      it('should preserve non-default explicit font colors with a renderer default', () => {
        expect(resolveCellTextColor({ fontColor: '#123456' }, '#f4f7f5')).toBe('#123456');
      });
    });

    describe('horizontal alignment', () => {
      it.each(['left', 'center', 'right'] as const)(
        'should use format horizontalAlign: %s',
        (align) => {
          const format: CellFormat = { horizontalAlign: align };
          const style = resolveCellTextStyle(format);
          expect(style.textAlign).toBe(align);
        },
      );
    });

    describe('vertical alignment', () => {
      it.each([
        ['top', 'top'],
        ['middle', 'middle'],
        ['bottom', 'bottom'],
      ] as const)('should map format verticalAlign %s to CSS %s', (align, expected) => {
        const format: CellFormat = { verticalAlign: align };
        const style = resolveCellTextStyle(format);
        expect(style.verticalAlign).toBe(expected);
      });
    });

    describe('background color', () => {
      it('should use format backgroundColor when provided', () => {
        const format: CellFormat = { backgroundColor: '#ffff00' };
        const style = resolveCellTextStyle(format);
        expect(style.backgroundColor).toBe('#ffff00');
      });

      it('should be undefined when not provided', () => {
        const format: CellFormat = {};
        const style = resolveCellTextStyle(format);
        expect(style.backgroundColor).toBeUndefined();
      });
    });

    describe('combined formatting', () => {
      it('should handle full format specification', () => {
        const format: CellFormat = {
          fontSize: 14,
          fontFamily: 'Arial',
          fontColor: '#333333',
          bold: true,
          italic: true,
          underlineType: 'single',
          strikethrough: false,
          horizontalAlign: 'center',
          verticalAlign: 'bottom',
          backgroundColor: '#f0f0f0',
        };

        const style = resolveCellTextStyle(format);

        expect(style.fontSize).toBe(14);
        expect(style.fontFamily).toBe('Arial');
        expect(style.color).toBe('#333333');
        expect(style.fontWeight).toBe('bold');
        expect(style.fontStyle).toBe('italic');
        expect(style.textDecoration).toBe('underline');
        expect(style.textAlign).toBe('center');
        expect(style.verticalAlign).toBe('bottom');
        expect(style.backgroundColor).toBe('#f0f0f0');
        // Padding should always come from defaults
        expect(style.paddingX).toBe(DEFAULT_CELL_STYLE.padding);
        expect(style.lineHeight).toBe(1);
      });
    });

    describe('return type completeness', () => {
      it('should always return all CellTextStyle properties', () => {
        const style = resolveCellTextStyle(undefined);

        // Type-safe property check
        const requiredKeys: (keyof CellTextStyle)[] = [
          'paddingX',
          'fontSize',
          'fontFamily',
          'fontWeight',
          'fontStyle',
          'color',
          'textDecoration',
          'textAlign',
          'verticalAlign',
          'lineHeight',
          'backgroundColor',
        ];

        for (const key of requiredKeys) {
          expect(style).toHaveProperty(key);
        }
      });
    });
  });
});
