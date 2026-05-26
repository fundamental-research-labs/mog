/**
 * Theme Fonts Tests
 *
 * Tests for theme font resolution functionality.
 * Verifies that fontTheme property in CellFormat correctly resolves
 * to the theme's major (headings) or minor (body) font.
 */

import type { CellFormat } from '@mog-sdk/contracts/core';
import type { ThemeDefinition } from '@mog-sdk/contracts/formatting/theme';
import {
  resolveAllThemeRefs,
  resolveThemeFont,
  resolveThemeFonts,
} from '@mog/spreadsheet-utils/formatting/theme';

// =============================================================================
// Test Fixtures
// =============================================================================

/** Office theme (default Excel theme) */
const officeTheme: ThemeDefinition = {
  id: 'office',
  name: 'Office',
  builtIn: true,
  colors: {
    dark1: '#000000',
    light1: '#ffffff',
    dark2: '#44546a',
    light2: '#e7e6e6',
    accent1: '#4472c4',
    accent2: '#ed7d31',
    accent3: '#a5a5a5',
    accent4: '#ffc000',
    accent5: '#5b9bd5',
    accent6: '#70ad47',
    hyperlink: '#0563c1',
    followedHyperlink: '#954f72',
  },
  fonts: {
    majorFont: 'Calibri Light',
    minorFont: 'Calibri',
  },
};

/** Slice theme (different fonts) */
const sliceTheme: ThemeDefinition = {
  id: 'slice',
  name: 'Slice',
  builtIn: true,
  colors: {
    dark1: '#000000',
    light1: '#ffffff',
    dark2: '#146194',
    light2: '#cfdce3',
    accent1: '#052f61',
    accent2: '#a50e82',
    accent3: '#14967c',
    accent4: '#6a9e1f',
    accent5: '#e87d37',
    accent6: '#c62324',
    hyperlink: '#052f61',
    followedHyperlink: '#6a9e1f',
  },
  fonts: {
    majorFont: 'Century Gothic',
    minorFont: 'Century Gothic',
  },
};

// =============================================================================
// Tests
// =============================================================================

describe('Theme Fonts', () => {
  describe('resolveThemeFont', () => {
    it('should resolve major font to theme majorFont', () => {
      expect(resolveThemeFont('major', officeTheme)).toBe('Calibri Light');
      expect(resolveThemeFont('major', sliceTheme)).toBe('Century Gothic');
    });

    it('should resolve minor font to theme minorFont', () => {
      expect(resolveThemeFont('minor', officeTheme)).toBe('Calibri');
      expect(resolveThemeFont('minor', sliceTheme)).toBe('Century Gothic');
    });
  });

  describe('resolveThemeFonts', () => {
    describe('with undefined format', () => {
      it('should return undefined', () => {
        expect(resolveThemeFonts(undefined, officeTheme)).toBeUndefined();
      });
    });

    describe('with no fontTheme', () => {
      it('should return format unchanged', () => {
        const format: CellFormat = { fontFamily: 'Arial', bold: true };
        const result = resolveThemeFonts(format, officeTheme);
        expect(result).toEqual(format);
      });

      it('should handle empty format', () => {
        const format: CellFormat = {};
        const result = resolveThemeFonts(format, officeTheme);
        expect(result).toEqual({});
      });
    });

    describe('with fontTheme: major', () => {
      it('should resolve to theme majorFont', () => {
        const format: CellFormat = { fontTheme: 'major' };
        const result = resolveThemeFonts(format, officeTheme);

        expect(result).toEqual({
          fontTheme: 'major',
          fontFamily: 'Calibri Light',
        });
      });

      it('should override existing fontFamily', () => {
        const format: CellFormat = { fontTheme: 'major', fontFamily: 'Arial' };
        const result = resolveThemeFonts(format, officeTheme);

        expect(result?.fontFamily).toBe('Calibri Light');
      });

      it('should preserve other format properties', () => {
        const format: CellFormat = {
          fontTheme: 'major',
          fontSize: 18,
          bold: true,
          fontColor: '#ff0000',
        };
        const result = resolveThemeFonts(format, officeTheme);

        expect(result).toEqual({
          fontTheme: 'major',
          fontFamily: 'Calibri Light',
          fontSize: 18,
          bold: true,
          fontColor: '#ff0000',
        });
      });
    });

    describe('with fontTheme: minor', () => {
      it('should resolve to theme minorFont', () => {
        const format: CellFormat = { fontTheme: 'minor' };
        const result = resolveThemeFonts(format, officeTheme);

        expect(result).toEqual({
          fontTheme: 'minor',
          fontFamily: 'Calibri',
        });
      });

      it('should use different theme fonts', () => {
        const format: CellFormat = { fontTheme: 'minor' };
        const result = resolveThemeFonts(format, sliceTheme);

        expect(result?.fontFamily).toBe('Century Gothic');
      });
    });

    describe('theme switching', () => {
      it('should resolve same format differently with different themes', () => {
        const format: CellFormat = { fontTheme: 'major' };

        const resultOffice = resolveThemeFonts(format, officeTheme);
        const resultSlice = resolveThemeFonts(format, sliceTheme);

        expect(resultOffice?.fontFamily).toBe('Calibri Light');
        expect(resultSlice?.fontFamily).toBe('Century Gothic');
      });
    });
  });

  describe('resolveAllThemeRefs', () => {
    it('should resolve both font and color theme references', () => {
      const format: CellFormat = {
        fontTheme: 'major',
        fontColor: 'theme:accent1',
      };

      const result = resolveAllThemeRefs(format, officeTheme);

      expect(result?.fontFamily).toBe('Calibri Light');
      expect(result?.fontColor).toBe('#4472c4');
    });

    it('should handle undefined format', () => {
      expect(resolveAllThemeRefs(undefined, officeTheme)).toBeUndefined();
    });

    it('should work with only font theme', () => {
      const format: CellFormat = { fontTheme: 'major' };
      const result = resolveAllThemeRefs(format, officeTheme);
      expect(result?.fontFamily).toBe('Calibri Light');
    });

    it('should work with only color theme', () => {
      const format: CellFormat = { fontColor: 'theme:accent1' };
      const result = resolveAllThemeRefs(format, officeTheme);
      expect(result?.fontColor).toBe('#4472c4');
    });

    it('should preserve non-theme properties', () => {
      const format: CellFormat = {
        fontTheme: 'minor',
        fontSize: 14,
        bold: true,
        backgroundColor: '#ff0000', // Non-theme color
      };

      const result = resolveAllThemeRefs(format, officeTheme);

      expect(result).toEqual({
        fontTheme: 'minor',
        fontFamily: 'Calibri',
        fontSize: 14,
        bold: true,
        backgroundColor: '#ff0000',
      });
    });
  });

  describe('integration with cell styling', () => {
    it('should allow theme fonts to work with cell text style resolution', () => {
      // This test verifies the architecture pattern:
      // resolveAllThemeRefs(format, theme) -> resolveCellTextStyle(resolved)
      const format: CellFormat = {
        fontTheme: 'major',
        fontSize: 18,
        bold: true,
      };

      const resolved = resolveAllThemeRefs(format, officeTheme);

      // Resolved format should have concrete fontFamily
      expect(resolved?.fontFamily).toBe('Calibri Light');
      expect(resolved?.fontSize).toBe(18);
      expect(resolved?.bold).toBe(true);
    });
  });
});
