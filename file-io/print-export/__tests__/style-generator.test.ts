/**
 * StyleGenerator Unit Tests
 */

import type { CellBorders, CellFormat } from '@mog-sdk/contracts/core';
import { COL_HEADER_HEIGHT, ROW_HEADER_WIDTH } from '@mog-sdk/contracts/rendering';
import { DEFAULT_PRINT_OPTIONS, type PrintOptions } from '../src/contracts/types';
import { StyleGenerator, styleGenerator } from '../src/html/style-generator';

describe('StyleGenerator', () => {
  let generator: StyleGenerator;

  beforeEach(() => {
    generator = new StyleGenerator();
  });

  describe('formatToStyles', () => {
    it('should return empty object for undefined format', () => {
      expect(generator.formatToStyles(undefined)).toEqual({});
    });

    it('should return empty object for empty format', () => {
      expect(generator.formatToStyles({})).toEqual({});
    });

    it('should convert font family', () => {
      const format: CellFormat = { fontFamily: 'Arial' };
      const styles = generator.formatToStyles(format);
      expect(styles['font-family']).toBe('Arial');
    });

    it('should quote font family with spaces', () => {
      const format: CellFormat = { fontFamily: 'Times New Roman' };
      const styles = generator.formatToStyles(format);
      expect(styles['font-family']).toBe('"Times New Roman"');
    });

    it('should convert font size', () => {
      const format: CellFormat = { fontSize: 12 };
      const styles = generator.formatToStyles(format);
      expect(styles['font-size']).toBe('12pt');
    });

    it('should convert font color', () => {
      const format: CellFormat = { fontColor: '#FF0000' };
      const styles = generator.formatToStyles(format);
      expect(styles['color']).toBe('#FF0000');
    });

    it('should convert bold', () => {
      const format: CellFormat = { bold: true };
      const styles = generator.formatToStyles(format);
      expect(styles['font-weight']).toBe('bold');
    });

    it('should convert italic', () => {
      const format: CellFormat = { italic: true };
      const styles = generator.formatToStyles(format);
      expect(styles['font-style']).toBe('italic');
    });

    it('should convert underline', () => {
      const format: CellFormat = { underlineType: 'single' };
      const styles = generator.formatToStyles(format);
      expect(styles['text-decoration']).toBe('underline');
    });

    it('should convert strikethrough', () => {
      const format: CellFormat = { strikethrough: true };
      const styles = generator.formatToStyles(format);
      expect(styles['text-decoration']).toBe('line-through');
    });

    it('should combine underline and strikethrough', () => {
      const format: CellFormat = { underlineType: 'single', strikethrough: true };
      const styles = generator.formatToStyles(format);
      expect(styles['text-decoration']).toBe('underline line-through');
    });

    it('should convert background color', () => {
      const format: CellFormat = { backgroundColor: '#FFFF00' };
      const styles = generator.formatToStyles(format);
      expect(styles['background-color']).toBe('#FFFF00');
    });

    it('should convert horizontal alignment', () => {
      const alignments: Array<CellFormat['horizontalAlign']> = [
        'left',
        'center',
        'right',
        'justify',
      ];
      for (const align of alignments) {
        const format: CellFormat = { horizontalAlign: align };
        const styles = generator.formatToStyles(format);
        expect(styles['text-align']).toBe(align);
      }
    });

    it('should normalize centerContinuous to valid CSS', () => {
      const styles = generator.formatToStyles({ horizontalAlign: 'centerContinuous' });

      expect(styles['text-align']).toBe('center');
      expect(styles['text-align']).not.toBe('centerContinuous');
    });

    it('should convert vertical alignment', () => {
      const alignments: Array<CellFormat['verticalAlign']> = ['top', 'middle', 'bottom'];
      for (const align of alignments) {
        const format: CellFormat = { verticalAlign: align };
        const styles = generator.formatToStyles(format);
        expect(styles['vertical-align']).toBe(align);
      }
    });

    it('should convert wrap text', () => {
      const format: CellFormat = { wrapText: true };
      const styles = generator.formatToStyles(format);
      expect(styles['white-space']).toBe('pre-wrap');
      expect(styles['word-wrap']).toBe('break-word');
    });

    it('should set nowrap when wrapText is false', () => {
      const format: CellFormat = { wrapText: false };
      const styles = generator.formatToStyles(format);
      expect(styles['white-space']).toBe('nowrap');
      expect(styles['overflow']).toBe('hidden');
    });

    it('should convert indent', () => {
      const format: CellFormat = { indent: 2 };
      const styles = generator.formatToStyles(format);
      expect(styles['padding-left']).toBe('16px');
    });

    it('should handle complex format', () => {
      const format: CellFormat = {
        fontFamily: 'Calibri',
        fontSize: 14,
        fontColor: '#333333',
        bold: true,
        italic: true,
        backgroundColor: '#F0F0F0',
        horizontalAlign: 'center',
        verticalAlign: 'middle',
      };
      const styles = generator.formatToStyles(format);
      expect(styles['font-family']).toBe('Calibri');
      expect(styles['font-size']).toBe('14pt');
      expect(styles['color']).toBe('#333333');
      expect(styles['font-weight']).toBe('bold');
      expect(styles['font-style']).toBe('italic');
      expect(styles['background-color']).toBe('#F0F0F0');
      expect(styles['text-align']).toBe('center');
      expect(styles['vertical-align']).toBe('middle');
    });
  });

  describe('bordersToStyles', () => {
    it('should return empty object for undefined borders', () => {
      expect(generator.bordersToStyles(undefined)).toEqual({});
    });

    it('should convert thin border', () => {
      const borders: CellBorders = {
        top: { style: 'thin', color: '#000000' },
      };
      const styles = generator.bordersToStyles(borders);
      expect(styles['border-top']).toBe('1px solid #000000');
    });

    it('should convert medium border', () => {
      const borders: CellBorders = {
        right: { style: 'medium', color: '#FF0000' },
      };
      const styles = generator.bordersToStyles(borders);
      expect(styles['border-right']).toBe('2px solid #FF0000');
    });

    it('should convert thick border', () => {
      const borders: CellBorders = {
        bottom: { style: 'thick', color: '#0000FF' },
      };
      const styles = generator.bordersToStyles(borders);
      expect(styles['border-bottom']).toBe('3px solid #0000FF');
    });

    it('should convert dashed border', () => {
      const borders: CellBorders = {
        left: { style: 'dashed', color: '#00FF00' },
      };
      const styles = generator.bordersToStyles(borders);
      expect(styles['border-left']).toBe('1px dashed #00FF00');
    });

    it('should convert dotted border', () => {
      const borders: CellBorders = {
        top: { style: 'dotted', color: '#888888' },
      };
      const styles = generator.bordersToStyles(borders);
      expect(styles['border-top']).toBe('1px dotted #888888');
    });

    it('should convert double border', () => {
      const borders: CellBorders = {
        bottom: { style: 'double', color: '#000000' },
      };
      const styles = generator.bordersToStyles(borders);
      expect(styles['border-bottom']).toBe('3px double #000000');
    });

    it('should convert none border', () => {
      const borders: CellBorders = {
        top: { style: 'none' },
      };
      const styles = generator.bordersToStyles(borders);
      expect(styles['border-top']).toBe('none');
    });

    it('should use default color if not specified', () => {
      const borders: CellBorders = {
        top: { style: 'thin' },
      };
      const styles = generator.bordersToStyles(borders);
      expect(styles['border-top']).toBe('1px solid #000000');
    });

    it('should handle all four borders', () => {
      const borders: CellBorders = {
        top: { style: 'thin', color: '#111111' },
        right: { style: 'medium', color: '#222222' },
        bottom: { style: 'thick', color: '#333333' },
        left: { style: 'dashed', color: '#444444' },
      };
      const styles = generator.bordersToStyles(borders);
      expect(styles['border-top']).toBe('1px solid #111111');
      expect(styles['border-right']).toBe('2px solid #222222');
      expect(styles['border-bottom']).toBe('3px solid #333333');
      expect(styles['border-left']).toBe('1px dashed #444444');
    });
  });

  describe('normalizeColor', () => {
    it('should return transparent for empty color', () => {
      expect(generator.normalizeColor('')).toBe('transparent');
    });

    it('should pass through rgb colors', () => {
      expect(generator.normalizeColor('rgb(255, 0, 0)')).toBe('rgb(255, 0, 0)');
    });

    it('should pass through rgba colors', () => {
      expect(generator.normalizeColor('rgba(255, 0, 0, 0.5)')).toBe('rgba(255, 0, 0, 0.5)');
    });

    it('should pass through named colors', () => {
      expect(generator.normalizeColor('red')).toBe('red');
      expect(generator.normalizeColor('blue')).toBe('blue');
    });

    it('should expand 3-char hex to 6-char', () => {
      expect(generator.normalizeColor('#F00')).toBe('#FF0000');
      expect(generator.normalizeColor('#ABC')).toBe('#AABBCC');
    });

    it('should pass through 6-char hex', () => {
      expect(generator.normalizeColor('#FF0000')).toBe('#FF0000');
      expect(generator.normalizeColor('#AABBCC')).toBe('#AABBCC');
    });

    it('should convert 8-char hex (AARRGGBB) to rgba', () => {
      // Fully opaque
      expect(generator.normalizeColor('#FFFF0000')).toBe('rgba(255, 0, 0, 1.00)');
      // 50% transparent
      expect(generator.normalizeColor('#80FF0000')).toBe('rgba(255, 0, 0, 0.50)');
      // Fully transparent
      expect(generator.normalizeColor('#00FF0000')).toBe('rgba(255, 0, 0, 0.00)');
    });
  });

  describe('stylesToString', () => {
    it('should convert empty styles to empty string', () => {
      expect(generator.stylesToString({})).toBe('');
    });

    it('should convert single style', () => {
      expect(generator.stylesToString({ color: 'red' })).toBe('color: red');
    });

    it('should convert multiple styles', () => {
      const result = generator.stylesToString({
        color: 'red',
        'font-size': '12pt',
      });
      expect(result).toBe('color: red; font-size: 12pt');
    });
  });

  describe('cellToStyles', () => {
    it('should combine format and border styles', () => {
      const format: CellFormat = { bold: true, fontColor: '#FF0000' };
      const borders: CellBorders = { top: { style: 'thin', color: '#000000' } };

      const styles = generator.cellToStyles(format, borders);

      expect(styles['font-weight']).toBe('bold');
      expect(styles['color']).toBe('#FF0000');
      expect(styles['border-top']).toBe('1px solid #000000');
    });
  });

  describe('generatePrintStylesheet', () => {
    it('should generate stylesheet with gridlines', () => {
      const options: PrintOptions = {
        ...DEFAULT_PRINT_OPTIONS,
        showGridlines: true,
      };
      const css = generator.generatePrintStylesheet(options);

      expect(css).toContain('.print-table');
      expect(css).toContain('border: 1px solid #d0d0d0');
    });

    it('should generate stylesheet without gridlines', () => {
      const options: PrintOptions = {
        ...DEFAULT_PRINT_OPTIONS,
        showGridlines: false,
      };
      const css = generator.generatePrintStylesheet(options);

      expect(css).toContain('border: none');
    });

    it('should include header styles when showHeaders is true', () => {
      const options: PrintOptions = {
        ...DEFAULT_PRINT_OPTIONS,
        showHeaders: true,
      };
      const css = generator.generatePrintStylesheet(options);

      expect(css).toContain('.row-header');
      expect(css).toContain('.col-header');
    });

    it('should include @media print styles', () => {
      const css = generator.generatePrintStylesheet(DEFAULT_PRINT_OPTIONS);
      expect(css).toContain('@media print');
      expect(css).toContain('@page');
    });

    it('should include scale transform when scale is not 1.0', () => {
      const options: PrintOptions = {
        ...DEFAULT_PRINT_OPTIONS,
        scale: 0.8,
      };
      const css = generator.generatePrintStylesheet(options);

      expect(css).toContain('transform: scale(0.8)');
    });

    it('should not include scale transform when scale is 1.0', () => {
      const css = generator.generatePrintStylesheet(DEFAULT_PRINT_OPTIONS);
      expect(css).not.toContain('transform: scale(1)');
    });
  });

  describe('getDefaultCellStyles', () => {
    it('should return default styles', () => {
      const defaults = generator.getDefaultCellStyles();
      expect(defaults['font-family']).toBeDefined();
      expect(defaults['font-size']).toBeDefined();
      expect(defaults['vertical-align']).toBe('middle');
    });
  });

  describe('singleton instance', () => {
    it('should export a singleton instance', () => {
      expect(styleGenerator).toBeInstanceOf(StyleGenerator);
    });
  });

  describe('headerVisibility', () => {
    it('should use default header dimensions when headerVisibility is not provided', () => {
      const options: PrintOptions = {
        ...DEFAULT_PRINT_OPTIONS,
        showHeaders: true,
      };
      const css = generator.generatePrintStylesheet(options);

      expect(css).toContain(`width: ${ROW_HEADER_WIDTH}px`);
      expect(css).toContain(`min-width: ${ROW_HEADER_WIDTH}px`);
      expect(css).toContain(`height: ${COL_HEADER_HEIGHT}px`);
    });

    it('should use standard dimensions when both headers are visible', () => {
      const options: PrintOptions = {
        ...DEFAULT_PRINT_OPTIONS,
        showHeaders: true,
      };
      const css = generator.generatePrintStylesheet(options, {
        showRowHeaders: true,
        showColumnHeaders: true,
      });

      expect(css).toContain(`width: ${ROW_HEADER_WIDTH}px`);
      expect(css).toContain(`min-width: ${ROW_HEADER_WIDTH}px`);
      expect(css).toContain(`height: ${COL_HEADER_HEIGHT}px`);
    });

    it('should use 0px width when row headers are hidden', () => {
      const options: PrintOptions = {
        ...DEFAULT_PRINT_OPTIONS,
        showHeaders: true,
      };
      const css = generator.generatePrintStylesheet(options, {
        showRowHeaders: false,
        showColumnHeaders: true,
      });

      expect(css).toContain('width: 0px');
      expect(css).toContain('min-width: 0px');
      expect(css).toContain(`height: ${COL_HEADER_HEIGHT}px`);
    });

    it('should use 0px height when column headers are hidden', () => {
      const options: PrintOptions = {
        ...DEFAULT_PRINT_OPTIONS,
        showHeaders: true,
      };
      const css = generator.generatePrintStylesheet(options, {
        showRowHeaders: true,
        showColumnHeaders: false,
      });

      expect(css).toContain(`width: ${ROW_HEADER_WIDTH}px`);
      expect(css).toContain(`min-width: ${ROW_HEADER_WIDTH}px`);
      expect(css).toContain('height: 0px');
    });

    it('should use 0px for both dimensions when both headers are hidden', () => {
      const options: PrintOptions = {
        ...DEFAULT_PRINT_OPTIONS,
        showHeaders: true,
      };
      const css = generator.generatePrintStylesheet(options, {
        showRowHeaders: false,
        showColumnHeaders: false,
      });

      expect(css).toContain('width: 0px');
      expect(css).toContain('min-width: 0px');
      expect(css).toContain('height: 0px');
    });
  });
});
